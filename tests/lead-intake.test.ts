import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLeadEmail, isReservedEmail } from "../src/lib/lead-intake.ts";

/**
 * 线索邮箱校验。
 *
 * 背景：端到端测试往试点库写过 19 条 buyer@example-eu.com 的假线索，
 * 报表上看起来像「已经有 19 个客户」。这些用例守住入口。
 */

test("正常邮箱通过", () => {
  for (const email of ["anna@nordic-profiles.se", "a.b+tag@company.co.uk", "x@y.io"]) {
    assert.equal(checkLeadEmail(email).ok, true, email);
  }
});

test("保留示例域名被拒，并说明是测试数据而非格式错误", () => {
  for (const email of ["buyer@example.com", "buyer@example.org", "x@example.net", "a@foo.test", "b@bar.invalid"]) {
    const v = checkLeadEmail(email);
    assert.equal(v.ok, false, email);
    assert.equal(v.ok === false && v.reason, "reserved", email);
    assert.match(v.ok === false ? v.message : "", /保留|示例/, email);
  }
});

test("格式校验优先于保留域名判定", () => {
  // c@localhost 既是保留域名又缺少点号。先报「格式错误」是对的顺序：
  // 用户第一件要做的事是把邮箱写完整，而不是纠结域名含义。
  assert.equal(isReservedEmail("c@localhost"), true);
  const v = checkLeadEmail("c@localhost");
  assert.equal(v.ok === false && v.reason, "format");
});

test("格式错误与保留域名给不同提示（真实用户要知道怎么改）", () => {
  const bad = checkLeadEmail("not-an-email");
  const reserved = checkLeadEmail("buyer@example.com");
  assert.equal(bad.ok === false && bad.reason, "format");
  assert.equal(reserved.ok === false && reserved.reason, "reserved");
  assert.notEqual(bad.ok === false ? bad.message : "", reserved.ok === false ? reserved.message : "");
});

test("子域名同样按保留处理", () => {
  assert.equal(isReservedEmail("a@mail.example.com"), true);
  assert.equal(isReservedEmail("a@deep.sub.test"), true);
});

test("形似但不相同的域名不得误伤", () => {
  // example-eu.com / examples.com / mytest.com 都是正常可注册域名，
  // 误判会让真实客户提交失败 —— 这比放过一条测试数据更糟。
  for (const email of ["buyer@example-eu.com", "a@examples.com", "b@mytest.com", "c@testify.io", "d@invalidmail.com"]) {
    assert.equal(isReservedEmail(email), false, email);
    assert.equal(checkLeadEmail(email).ok, true, email);
  }
});

test("大小写与结尾点号不影响判定", () => {
  assert.equal(isReservedEmail("Buyer@Example.COM"), true);
  assert.equal(isReservedEmail("buyer@example.com."), true);
});

test("空值与无 @ 输入按格式错误处理", () => {
  for (const email of [null, undefined, "", "noatsign", "@example.com"]) {
    const v = checkLeadEmail(email);
    assert.equal(v.ok, false, String(email));
    assert.equal(v.ok === false && v.reason, "format", String(email));
  }
});
