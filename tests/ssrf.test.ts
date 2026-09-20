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
import { isBlockedAddress } from "../src/lib/net/fetch-page.ts";

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
