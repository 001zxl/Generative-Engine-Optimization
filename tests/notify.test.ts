/**
 * 线索通知的单测。
 *
 * 加通知之前，线索只是入库 —— 不提醒任何人。对"投放→线索"的生意来说，
 * 这等于线索会被漏掉。这组断言固定住三件事：
 *   1. 按渠道构造正确的请求体（钉钉/企微/飞书/Slack 的 JSON 结构互不兼容）
 *   2. 未配置时明确告警，而不是静默什么都不做
 *   3. 通知失败必须返回可记录的错误，且绝不抛异常影响线索保存
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectChannel, buildPayload, notifyLead, isNotifyConfigured } from "../src/lib/notify.ts";

const LEAD = {
  leadId: "lead_test",
  email: "buyer@example-eu.com",
  company: "Nordic AB",
  website: "nordic.example",
  message: "我们在 AI 里搜不到自己",
  source: "result:citability",
  selfReportedSource: "ai_answer",
  createdAt: "2026-09-20T12:00:00.000Z",
};

test("按 URL 识别渠道", () => {
  assert.equal(detectChannel("https://oapi.dingtalk.com/robot/send?access_token=x"), "dingtalk");
  assert.equal(detectChannel("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x"), "wecom");
  assert.equal(detectChannel("https://open.feishu.cn/open-apis/bot/v2/hook/x"), "feishu");
  assert.equal(detectChannel("https://hooks.slack.com/services/x"), "slack");
  assert.equal(detectChannel("https://my-own-endpoint.example/hook"), "generic");
});

test("各渠道请求体结构正确（不能混用）", () => {
  const dt = buildPayload("dingtalk", LEAD) as { msgtype: string; text: { content: string } };
  assert.equal(dt.msgtype, "text");
  assert.ok(dt.text.content.includes("buyer@example-eu.com"));
  assert.ok(dt.text.content.includes("24 小时内跟进"), "提醒文案要含跟进要求");

  const wc = buildPayload("wecom", LEAD) as { msgtype: string; text: { content: string } };
  assert.equal(wc.msgtype, "text");

  const fs = buildPayload("feishu", LEAD) as { msg_type: string; content: { text: string } };
  assert.equal(fs.msg_type, "text", "飞书用 msg_type 而非 msgtype");
  assert.ok(fs.content.text.includes("buyer@example-eu.com"));

  const sl = buildPayload("slack", LEAD) as { text: string };
  assert.ok(typeof sl.text === "string");

  const gen = buildPayload("generic", LEAD) as Record<string, unknown>;
  assert.equal(gen.type, "lead");
  assert.equal(gen.leadId, "lead_test", "通用端点要带结构化字段，便于对接 CRM");
});

test("未配置 webhook：明确返回未配置，而不是假装成功", async () => {
  const prev = process.env.LEAD_NOTIFY_WEBHOOK;
  delete process.env.LEAD_NOTIFY_WEBHOOK;
  assert.equal(isNotifyConfigured(), false);
  const r = await notifyLead(LEAD);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, "not_configured");
  if (prev !== undefined) process.env.LEAD_NOTIFY_WEBHOOK = prev;
});

test("通知失败返回错误且不抛异常（线索保存不受影响）", async () => {
  const prev = process.env.LEAD_NOTIFY_WEBHOOK;
  // 指向一个必定连不上的地址
  process.env.LEAD_NOTIFY_WEBHOOK = "http://127.0.0.1:9/definitely-not-listening";
  const r = await notifyLead(LEAD);
  assert.equal(r.ok, false, "必须返回失败");
  assert.ok(r.error && r.error.length > 0, "必须给出可记录的错误原因");
  assert.equal(r.channel, "generic");
  if (prev !== undefined) process.env.LEAD_NOTIFY_WEBHOOK = prev;
  else delete process.env.LEAD_NOTIFY_WEBHOOK;
});
