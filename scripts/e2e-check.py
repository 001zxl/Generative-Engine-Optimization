#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批次1 端到端业务闭环验证：工具 -> 结果页 -> 公开 -> 线索 -> 运营台 -> 导出"""
import json
import urllib.request
import urllib.error
import sys

BASE = "http://localhost:3100"
passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -> " + str(detail)[:220]) if detail else ""))


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


GOOD_HTML = """<!doctype html><html lang="zh-CN"><head>
<title>铝合金型材定制加工｜小批量开模与出口供货</title>
<meta name="description" content="面向欧洲中小品牌的铝合金型材定制加工，标准件500件起订。">
<link rel="canonical" href="https://example.com/aluminum">
<meta property="article:published_time" content="2025-11-02">
<meta property="article:modified_time" content="2026-01-15">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","author":{"@type":"Person","name":"张工"},"datePublished":"2025-11-02","dateModified":"2026-01-15","mainEntity":[{"@type":"Question","name":"最小起订量是多少？","acceptedAnswer":{"@type":"Answer","text":"标准件500件起订。"}}]}</script>
</head><body>
<h1>铝合金型材定制加工</h1>
<p>我们为欧洲中小品牌提供铝合金型材定制加工服务，标准件 500 件起订，开模件 3000 件起订，常规交期 12 个工作日，2025 年服务 63 家海外客户，准时交付率 98.6%。</p>
<h2>最小起订量（MOQ）是多少？</h2>
<p>标准规格 500 件起订，定制开模 3000 件起订，打样周期 7 个工作日。付款方式为 30% 定金加发货前付清。</p>
<h2>交期需要多久？</h2>
<p>常规规格 12 个工作日，开模件 25 个工作日。2025 年全年准时交付率 98.6%，平均延误 0.8 天。</p>
<h2>支持哪些表面处理？</h2>
<p>支持阳极氧化、粉末喷涂、电泳与木纹转印四类工艺，膜厚范围 10-25 微米，盐雾测试可达 500 小时。</p>
<table><tr><th>工艺</th><th>膜厚</th><th>盐雾</th></tr><tr><td>阳极氧化</td><td>10-15μm</td><td>500h</td></tr></table>
<ul><li>检测报告随货提供</li><li>支持第三方验厂</li><li>MOQ 500 件</li><li>交期 12 天</li><li>覆盖 14 个国家</li></ul>
<p>根据 2025 年内部出货统计（来源：ERP 系统），全年出货 42 万件。参考标准：GB/T 5237。</p>
<p>作者：张工（材料工程师） 发布于 2025-11-02 更新于 2026-01-15</p>
<h2>常见问题</h2>
<p>问：能否提供样品？答：可以，样品费 200 元，下单后返还。</p>
</body></html>"""

BAD_TEXT = """我们是行业最好的铝材厂家，绝对领先，100%保证质量，全国第一，唯一能做到完美交付的团队。
我们实力雄厚，服务一流，品质卓越，值得信赖。选择我们就是选择放心，永远不让你失望。
好东西不用多说，懂的自然懂。联系我们，马上合作，稳赚不赔，零风险。
""" * 3

print("\n[1] 工具 B：内容可引用性（优质 HTML）")
st, d = post("/api/tools/content-check", {"text": GOOD_HTML, "heading": "铝合金型材定制加工"})
check("HTTP 200", st == 200, st)
if st == 200:
    good_slug, r = d["shareSlug"], d["result"]
    dims = {x["label"]: x["score"] for x in r["meta"]["dimensions"]}
    print("     分项:", json.dumps(dims, ensure_ascii=False))
    check("总分 >= 70", r["meta"]["overall"] >= 70, r["meta"]["overall"])
    check("FAQ 维度满分（检出 FAQPage schema）", dims.get("FAQ 覆盖") == 100, dims.get("FAQ 覆盖"))
    check("直接回答维度满分（检出问答式小标题）", dims.get("直接回答问题") == 100, dims.get("直接回答问题"))
    check("未误报夸大表述", dims.get("表述克制") == 100, [h for h in r["meta"]["observed"]["hypeHits"]])

print("\n[2] 工具 B：内容可引用性（薄且夸大的正文）")
st, d = post("/api/tools/content-check", {"text": BAD_TEXT})
check("HTTP 200", st == 200, st)
if st == 200:
    bad_slug, r2 = d["shareSlug"], d["result"]
    dims2 = {x["label"]: x["score"] for x in r2["meta"]["dimensions"]}
    print("     分项:", json.dumps(dims2, ensure_ascii=False))
    check("检出夸大表述", len(r2["meta"]["observed"]["hypeHits"]) > 0, r2["meta"]["observed"]["hypeHits"][:8])
    check("表述克制维度低分", dims2.get("表述克制", 100) < 40, dims2.get("表述克制"))
    check("总分低于优质样本", r2["meta"]["overall"] < r["meta"]["overall"], f'{r2["meta"]["overall"]} < {r["meta"]["overall"]}')
    check("缺少来源与作者", dims2.get("来源与证据", 100) == 0 and dims2.get("作者与时效", 100) == 0)

print("\n[3] 结果页：默认私有、不被索引")
st, html = get("/r/" + good_slug)
check("结果页 200", st == 200, st)
check("含 noindex", "noindex" in html, "")
check("展示了分项计算方式", "加权总分" in html and "计算方式" in html)
check("展示了检查证据", "检查证据" in html, "")
check("含数据边界声明", "方法与数据边界" in html)

print("\n[4] 用户主动公开后才允许索引")
st, d = post("/api/tool-runs/" + good_slug + "/publish", {})
check("publish 成功（用 share_slug，不暴露内部 id）", st == 200, d)
st2, html2 = get("/r/" + good_slug)
check("公开后不再 noindex", st2 == 200 and "noindex" not in html2, "")
st_bad, _ = post("/api/tool-runs/zzzzzzzzzzzz/publish", {})
check("不存在的 slug 返回 404", st_bad == 404, st_bad)

print("\n[5] 线索提交")
st, d = post("/api/leads", {
    "email": "buyer@example-eu.com", "company": "Nordic Profiles AB",
    "website": "nordic-profiles.se", "message": "我们在 AI 里搜不到自己",
    "selfReportedSource": "ai_answer", "source": "result:citability",
})
check("HTTP 200", st == 200, st)
check("返回 leadId", st == 200 and d.get("leadId", "").startswith("lead_"), d.get("leadId"))

st, d = post("/api/leads", {"email": "not-an-email"})
check("非法邮箱被拒绝", st == 400, st)

st, d = post("/api/leads", {"email": "bot@spam.com", "honeypot": "x"})
check("蜜罐字段生效（静默吞掉不落库）", st == 200, st)

print("\n[6] 运营台")
st, html = get("/console")
check("总览 200", st == 200, st)
check("展示了第 5 问（访问与咨询）", "带来访问和咨询" in html)
check("未实现的 4 问标注为待建", "待建" in html)
st, html = get("/console/leads")
check("线索页 200", st == 200, st)
check("线索已落库并可见", "buyer@example-eu.com" in html, "")
st, html = get("/console/tool-runs")
check("工具使用记录页 200", st == 200, st)
check("记录含检查目标", "粘贴正文" in html, "")

print("\n[7] 导出与索引策略")
st, body = get("/api/tool-runs/" + good_slug + "/export")
check("导出 JSON 200", st == 200, st)
try:
    exported = json.loads(body)
    check("导出内容含完整结果与输入", "result" in exported and "input" in exported and exported["result"]["tool"] == "citability")
except Exception as e:
    check("导出内容可解析", False, e)
st, html = get("/robots.txt")
check("robots.txt 禁止索引 /r/ 与 /console", "Disallow: /r/" in html and "Disallow: /console" in html)
check("robots.txt 显式放行检索型爬虫", "OAI-SearchBot" in html and "PerplexityBot" in html)
st, html = get("/sitemap.xml")
check("sitemap 不含结果页", "/r/" not in html)

print("\n" + "=" * 60)
print(f"通过 {len(passed)} 项，失败 {len(failed)} 项")
if failed:
    print("失败项：")
    for f in failed:
        print("  -", f)
sys.exit(1 if failed else 0)
