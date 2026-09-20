"use client";

import { useEffect } from "react";

/**
 * 结果页浏览埋点。
 *
 * 没有这一步，运营台就无法区分"结果页被打开了"和"检查跑完了"——
 * 前者才是判断诊断报告有没有被真正阅读的关键（也是线索转化的分母）。
 * 只上报一次，不携带任何个人信息。
 */
export function PageView({ toolRunId, path }: { toolRunId?: string; path?: string }) {
  useEffect(() => {
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "page_view", path: path ?? window.location.pathname, toolRunId }),
      keepalive: true,
    }).catch(() => {});
  }, [toolRunId, path]);

  return null;
}
