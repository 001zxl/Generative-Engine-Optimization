/**
 * 内容可引用性检查的单测。
 *
 * 重点是**样板文误判**这个真实缺陷：真实站点（pailian-aluminium.com）的首页
 * 唯一被判定为「可整段摘录的摘要」的段落，是页脚的
 * "Copyright © ... All rights reserved." —— 该项拿了满分 100。
 * 一个明显错误的满分，比低分更危险。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isBoilerplateParagraph } from "../src/lib/checks/citability.ts";

test("页脚/法务类样板文必须被识别", () => {
  const boiler = [
    "Copyright © Pailian Aluminium Profile Company Ltd All rights reserved.",
    "© 2026 Example Corp. All Rights Reserved.",
    "We use cookies to improve your experience.",
    "Read our Privacy Policy and Terms of Service.",
    "Subscribe to our newsletter",
    "版权所有 某某铝业有限公司 备案号 粤ICP备12345678号",
    "关注我们 微信公众号",
    "Skip to main content",
  ];
  for (const b of boiler) {
    assert.equal(isBoilerplateParagraph(b), true, `应判定为样板文：${b}`);
  }
});

test("真正的可引用陈述不应被误杀", () => {
  const real = [
    "我们为欧洲中小品牌提供铝合金型材定制加工服务，标准件 500 件起订，常规交期 12 个工作日。",
    "The company operates a 100,000 square meter production base with 25 automatic extrusion lines.",
    "标准规格 500 件起订，定制开模 3000 件起订，打样周期 7 个工作日。",
  ];
  for (const r of real) {
    assert.equal(isBoilerplateParagraph(r), false, `不应判定为样板文：${r}`);
  }
});

test("无句末标点的短句一律排除（避免把导航项当摘要）", () => {
  assert.equal(isBoilerplateParagraph("Products"), true);
  assert.equal(isBoilerplateParagraph("Aluminium Extrusion Profiles"), true);
  assert.equal(isBoilerplateParagraph("Home > Products > Extrusion"), true);
});

test("空段落排除", () => {
  assert.equal(isBoilerplateParagraph(""), true);
  assert.equal(isBoilerplateParagraph("   "), true);
});
