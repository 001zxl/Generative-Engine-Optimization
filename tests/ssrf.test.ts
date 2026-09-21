/**
 * SSRF 防护的单元测试。
 *
 * 这是安全关键逻辑，重点验证两件事：
 *  1. 默认配置下，内网/环回/链路本地/基准测试网段全部被拒；
 *  2. 启用 EXTRA_TRUSTED_CIDRS 逃生口后，**只有**指定网段被放行，
 *     真正的内网地址仍然被拒（这是最容易写错、后果最严重的一点）。
 *
 * 运行：pnpm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, ipv6ToBytes, resolveAndValidate } from "../src/lib/net/fetch-page.ts";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.EXTRA_TRUSTED_CIDRS;
  if (value === undefined) delete process.env.EXTRA_TRUSTED_CIDRS;
  else process.env.EXTRA_TRUSTED_CIDRS = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.EXTRA_TRUSTED_CIDRS;
    else process.env.EXTRA_TRUSTED_CIDRS = prev;
  }
}

test("默认（未配置逃生口）：公网地址放行", () => {
  withEnv(undefined, () => {
    for (const ip of ["1.1.1.1", "172.66.147.243", "203.119.238.116", "8.8.8.8"]) {
      assert.equal(isBlockedAddress(ip), false, `${ip} 应放行`);
    }
  });
});

test("默认：内网/环回/链路本地全部拒绝", () => {
  withEnv(undefined, () => {
    const blocked = [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254", // 云元数据服务，最经典的 SSRF 目标
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // 组播
      "198.18.0.1", // RFC 2544 基准测试段
      "198.19.255.255",
      "192.0.2.1", // TEST-NET-1（文档网段，不可路由）
      "198.51.100.1", // TEST-NET-2
      "203.0.113.1", // TEST-NET-3
      "192.88.99.1", // 6to4 中继
    ];
    for (const ip of blocked) {
      assert.equal(isBlockedAddress(ip), true, `${ip} 应被拒绝`);
    }
  });
});

test("默认：非法输入按不安全处理", () => {
  withEnv(undefined, () => {
    for (const ip of ["", "not-an-ip", "999.1.1.1", "1.2.3"]) {
      assert.equal(isBlockedAddress(ip), true, `${ip} 应被拒绝`);
    }
  });
});

test("默认：IPv6 环回与唯一本地地址被拒，IPv4 映射地址按 IPv4 判定", () => {
  withEnv(undefined, () => {
    assert.equal(isBlockedAddress("::1"), true);
    assert.equal(isBlockedAddress("::"), true);
    assert.equal(isBlockedAddress("fe80::1"), true);
    assert.equal(isBlockedAddress("fc00::1"), true);
    assert.equal(isBlockedAddress("fd12:3456::1"), true);
    assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true, "IPv4 映射的环回地址必须被拒");
    assert.equal(isBlockedAddress("2001:4860:4860::8888"), false, "公网 IPv6 应放行");
  });
});

test("逃生口：只放行指定网段，真正的内网仍然被拒（关键回归）", () => {
  withEnv("198.18.0.0/15", () => {
    // 放行
    assert.equal(isBlockedAddress("198.18.0.1"), false, "198.18.0.0/15 内应放行");
    assert.equal(isBlockedAddress("198.19.255.255"), false, "198.18.0.0/15 内应放行");
    assert.equal(isBlockedAddress("1.1.1.1"), false, "公网仍应放行");

    // 绝不能因为开了逃生口就放行这些
    assert.equal(isBlockedAddress("127.0.0.1"), true, "环回必须仍然被拒");
    assert.equal(isBlockedAddress("10.0.0.1"), true, "私网必须仍然被拒");
    assert.equal(isBlockedAddress("192.168.1.1"), true, "私网必须仍然被拒");
    assert.equal(isBlockedAddress("172.16.0.1"), true, "私网必须仍然被拒");
    assert.equal(isBlockedAddress("169.254.169.254"), true, "云元数据地址必须仍然被拒");
    assert.equal(isBlockedAddress("198.20.0.1"), false, "网段外的公网地址正常放行（边界确认）");
    assert.equal(isBlockedAddress("198.17.255.255"), false, "紧邻网段下方的公网地址不受影响");
  });
});

test("逃生口：支持多个网段与 /32", () => {
  withEnv("198.18.0.0/15, 203.0.113.7/32", () => {
    assert.equal(isBlockedAddress("198.18.5.5"), false);
    assert.equal(isBlockedAddress("203.0.113.7"), false);
    assert.equal(isBlockedAddress("203.0.113.8"), true, "/32 之外的邻居不应被放行");
  });
});

test("逃生口：非法条目被忽略，不影响默认防护", () => {
  withEnv("garbage, 10.0.0.0/99, 198.18.0.0/15", () => {
    assert.equal(isBlockedAddress("198.18.0.1"), false, "合法条目仍应生效");
    assert.equal(isBlockedAddress("10.0.0.1"), true, "非法条目不应意外放行私网");
  });
});

/* =========================================================================
 * IPv6：曾经的字符串前缀匹配漏检 9 类地址
 *
 * 旧实现用 startsWith("fe80") 判断链路本地，而 fe80::/10 覆盖 fe80–febf；
 * 更严重的是 ::ffff:7f00:1（127.0.0.1 的十六进制 IPv4 映射）漏过，
 * 等于 SSRF 防护被完整绕过。现在改为解析成字节做 CIDR 位运算。
 * ========================================================================= */

test("IPv6 保留网段：按 CIDR 判定，不再靠字符串前缀", () => {
  const blocked = [
    "::1",
    "::",
    "fe80::1",
    "fe90::1", // ← 旧实现漏检
    "fea0::1", // ← 旧实现漏检
    "febf::1", // ← 旧实现漏检
    "fc00::1",
    "fd00::1",
    "2001:db8::1",
    "100::1",
    "2001::1",
    "ff02::1",
  ];
  for (const ip of blocked) assert.equal(isBlockedAddress(ip), true, `${ip} 应被拦截`);

  // 非保留地址不应被误杀
  for (const ip of ["2001:4860:4860::8888", "2606:4700::1111", "fec0::1"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} 应放行`);
  }
});

test("IPv4 映射 / NAT64 / 6to4：必须提取内嵌 IPv4 再判定（关键回归）", () => {
  // 十六进制形式的 127.0.0.1 —— 旧实现完全漏过
  assert.equal(isBlockedAddress("::ffff:7f00:1"), true, "::ffff:7f00:1 = 127.0.0.1");
  assert.equal(isBlockedAddress("::ffff:a00:1"), true, "::ffff:a00:1 = 10.0.0.1");
  assert.equal(isBlockedAddress("::ffff:c0a8:101"), true, "::ffff:c0a8:101 = 192.168.1.1");
  assert.equal(isBlockedAddress("::ffff:a9fe:a9fe"), true, "映射形式的云元数据地址");
  assert.equal(isBlockedAddress("64:ff9b::7f00:1"), true, "NAT64 内嵌环回");
  assert.equal(isBlockedAddress("2002:7f00:1::1"), true, "6to4 内嵌环回");

  // 内嵌公网地址不应被误杀
  assert.equal(isBlockedAddress("::ffff:808:808"), false, "映射形式的 8.8.8.8");
  assert.equal(isBlockedAddress("64:ff9b::808:808"), false, "NAT64 内嵌公网");
});

test("IPv6 解析器：压缩写法、zone id、方括号、尾部点分", () => {
  assert.deepEqual(Array.from(ipv6ToBytes("::1")!.slice(0, 15)), Array(15).fill(0));
  assert.equal(ipv6ToBytes("::1")![15], 1);
  assert.equal(ipv6ToBytes("::ffff:127.0.0.1")!.length, 16);
  assert.equal(ipv6ToBytes("[::1]")![15], 1, "方括号形式应可解析");
  assert.equal(ipv6ToBytes("fe80::1%en0")![1], 0x80, "带 zone id 应可解析");
  assert.equal(ipv6ToBytes("::ffff:7f00:1")![12], 0x7f, "十六进制映射应解析出 0x7f");
  assert.equal(ipv6ToBytes("不是IP"), null);
  assert.equal(ipv6ToBytes("1:2:3"), null, "组数不足应返回 null");
});

/* =========================================================================
 * DNS 重绑定（TOCTOU）：解析与校验必须是一次
 * ========================================================================= */

test("解析+校验：字面量 IP、本机名与内网后缀一律拒绝", async () => {
  for (const h of ["127.0.0.1", "10.1.2.3", "::1", "localhost", "app.localhost", "db.internal", "x.local"]) {
    const r = await resolveAndValidate(h);
    assert.equal(r.ok, false, `${h} 应被拒绝`);
  }
});

test("解析+校验：返回的地址就是要连接的目标（消除二次解析）", async () => {
  const r = await resolveAndValidate("example.com");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.target.address.length > 0, "必须给出确定的连接地址");
    assert.equal(isBlockedAddress(r.target.address), false, "返回的地址必须是通过校验的");
    assert.ok(r.target.family === 4 || r.target.family === 6);
  }
});

test("解析+校验：不存在的域名给出可读错误", async () => {
  const r = await resolveAndValidate("this-domain-should-not-exist-9f8a7b6c5d4e.invalid");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /无法解析/);
});
