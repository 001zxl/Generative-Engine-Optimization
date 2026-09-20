import { PendingModule } from "@/components/pending-module";

export const metadata = { title: "事实与证据", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PendingModule
      title="事实与证据"
      question="AI 回答里关于我们的陈述，哪些是错的？我们的对外陈述有没有证据支撑？"
      depends={[
        "品牌 Claim 的创建、审核与版本化",
        "证据绑定（文件、URL、案例、认证、数据）与证据等级",
        "事实冲突检测与过期提醒",
        "AI 回答的事实一致性核验（与已批准 Claim 比对）",
      ]}
      tables={["claims", "claim_versions", "evidences", "claim_evidence_links", "prohibited_phrases", "review_decisions"]}
    />
  );
}
