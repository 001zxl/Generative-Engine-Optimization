/**
 * 登录节流的单测。
 *
 * 这里的断言源于一个真实的绕过：旧实现用客户端可提交的隐藏字段 `hint` 作计数键，
 * 攻击者每次改一个值就能获得全新计数器，节流形同虚设。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createThrottleState,
  evaluateAttempt,
  noteFailure,
  noteSuccess,
  DEFAULT_THROTTLE,
} from "../src/lib/auth-throttle.ts";

const T0 = 1_700_000_000_000;

test("单个 IP 连续失败达到上限后被锁", () => {
  const st = createThrottleState();
  for (let i = 0; i < DEFAULT_THROTTLE.maxPerIp; i++) {
    assert.equal(evaluateAttempt(st, "ipA", T0 + i).allowed, true, `第 ${i + 1} 次应放行`);
    noteFailure(st, "ipA", T0 + i);
  }
  const v = evaluateAttempt(st, "ipA", T0 + 100);
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "ip");
  assert.ok(v.retryAfterSec > 0);
});

test("换 IP 不能绕过全局上限（这就是旧实现被绕过的点）", () => {
  const st = createThrottleState();
  // 模拟攻击者不断变换来源：每个 IP 只失败 1 次，但总量累积
  let blockedAt = -1;
  for (let i = 0; i < DEFAULT_THROTTLE.maxGlobal + 5; i++) {
    const v = evaluateAttempt(st, `ip-${i}`, T0 + i);
    if (!v.allowed) {
      blockedAt = i;
      assert.equal(v.reason, "global", "应由全局层拦下");
      break;
    }
    noteFailure(st, `ip-${i}`, T0 + i);
  }
  assert.equal(blockedAt, DEFAULT_THROTTLE.maxGlobal, `应在第 ${DEFAULT_THROTTLE.maxGlobal} 次之后被全局拦下`);
});

test("窗口过期后自动解锁", () => {
  const st = createThrottleState();
  for (let i = 0; i < DEFAULT_THROTTLE.maxPerIp; i++) noteFailure(st, "ipA", T0);
  assert.equal(evaluateAttempt(st, "ipA", T0 + 1000).allowed, false);
  assert.equal(evaluateAttempt(st, "ipA", T0 + DEFAULT_THROTTLE.windowMs + 1).allowed, true, "窗口过后应放行");
});

test("登录成功清掉该 IP 的计数，但不清全局计数", () => {
  const st = createThrottleState();
  for (let i = 0; i < 5; i++) noteFailure(st, "ipA", T0 + i);
  noteSuccess(st, "ipA");
  assert.equal(evaluateAttempt(st, "ipA", T0 + 10).allowed, true);

  // 全局计数保留 —— 否则攻击者只要偶尔成功一次就能重置全局画像
  assert.equal(st.global.length, 5, "全局计数不应被成功登录清空");
});

test("不同 IP 互不影响（按 IP 层）", () => {
  const st = createThrottleState();
  for (let i = 0; i < DEFAULT_THROTTLE.maxPerIp; i++) noteFailure(st, "ipA", T0 + i);
  assert.equal(evaluateAttempt(st, "ipA", T0 + 20).allowed, false);
  assert.equal(evaluateAttempt(st, "ipB", T0 + 20).allowed, true, "另一 IP 不应被牵连");
});

test("计数键来自服务端信息，无法由客户端伪造", () => {
  // 结构性断言：evaluateAttempt 的第一个参数是服务端计算的 key，
  // 函数签名里不存在任何来自 FormData 的字段。
  const st = createThrottleState();
  const v1 = evaluateAttempt(st, "server-derived-a", T0);
  const v2 = evaluateAttempt(st, "server-derived-b", T0);
  assert.equal(v1.allowed, true);
  assert.equal(v2.allowed, true);
  // 同一个 key 才会共享配额
  noteFailure(st, "server-derived-a", T0);
  assert.equal(st.perIp.get("server-derived-a")?.length, 1);
  assert.equal(st.perIp.get("server-derived-b"), undefined, "未失败过的 key 不应留下条目");

  // 只读判断不得写入空条目 —— 否则伪造来源会让表无界增长（内存耗尽）
  const st2 = createThrottleState();
  for (let i = 0; i < 2000; i++) evaluateAttempt(st2, `spoofed-${i}`, T0);
  assert.equal(st2.perIp.size, 0, "仅判断过、未失败的 key 不应进入表");
});
