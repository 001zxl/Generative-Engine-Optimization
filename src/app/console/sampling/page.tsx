import { PendingModule } from "@/components/pending-module";

export const metadata = { title: "采样与评估", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PendingModule
      title="采样与评估"
      question="AI 主要引用哪些来源？我们和竞品在不同平台、不同问题上的可见度差多少？"
      depends={[
        "Sampling Run / Task 的创建与幂等键",
        "手工粘贴录入与 CSV 导入（MVP 阶段不做自动抓取）",
        "提及、位置、竞品、引用、情感与事实一致性的抽取",
        "低置信度样本的人工复核",
        "可重算的指标快照（提及率 / 首推率 / Share of Voice / 自有域引用率）",
      ]}
      tables={[
        "engines",
        "sampling_runs",
        "response_samples",
        "response_citations",
        "response_mentions",
        "evaluation_results",
        "human_reviews",
        "metric_snapshots",
      ]}
    />
  );
}
