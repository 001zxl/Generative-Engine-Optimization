#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证真实站点试点的数据是否已在运营台可见。"""
import json
import urllib.request
import sys

BASE = "http://localhost:3100"
RUN_ID = open("/tmp/pilot-run-id.txt").read().strip()


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "ignore")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


print("=== 运营台各模块是否反映真实试点数据 ===\n")
checks = [
    ("/console/brands", ["Pailian Aluminium", "pailian-aluminium.com", "HXM Aluminum", "派联铝业"]),
    ("/console/questions", ["Pailian · 海外买家监测集 V1", "500-unit trial order", "已冻结"]),
    ("/console/claims", ["ISO 9001", "500 件起订", "100,000", "GB5237-2017", "已批准"]),
    ("/console/sampling", ["Pailian · 2026-09 基线", "ChatGPT", "通义千问", "Which Chinese aluminum"]),
    ("/console/evaluation", ["无法计算", "品牌与竞品"]),
    ("/console/roadmap", ["已全部上线", "1 · 品牌与竞品"]),
]

allok = True
for path, probes in checks:
    st, html = get(path)
    missing = [p for p in probes if p not in html]
    ok = st == 200 and not missing
    allok = allok and ok
    print(f"  {'OK  ' if ok else 'FAIL'} {path:<24} HTTP {st}" + (f"   缺失: {missing}" if missing else ""))

print("\n=== 采样批次详情 ===")
st, html = get(f"/console/sampling?run={RUN_ID}")
import re

m = re.search(r"待采 (\d+) / 共 (\d+)", html)
print(f"  待采 / 总数: {m.group(1) + ' / ' + m.group(2) if m else '未解析到'}")
print(f"  渲染出的问题条目数: {html.count('保存回答')}")

print("\n=== 结果页（第 0 步诊断产物）===")
for path in ["/r/9zf66fwbmne2", "/r/b3mt3nh6escw"]:
    st, html = get(path)
    tool = "AI 爬虫检查" if "爬虫" in html else "内容可引用性"
    print(f"  {path}  HTTP {st}  {tool}")

print("\n" + ("全部通过" if allok else "有失败项"))
sys.exit(0 if allok else 1)
