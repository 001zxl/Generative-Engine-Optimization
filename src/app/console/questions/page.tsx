import { PendingModule } from "@/components/pending-module";

export const metadata = { title: "问题库", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PendingModule
      title="问题库"
      question="客户真实会问 AI 哪些问题？其中哪些我们完全没有出现？"
      depends={[
        "Persona / 意图 / 漏斗阶段 / 地区 / 语言的分组",
        "Query Set 版本化与冻结（冻结版本不可直接编辑，只能新建版本）",
        "原始问题到各平台 Prompt 变体的映射",
        "冻结检测集与探索机会集的分离",
      ]}
      tables={["personas", "query_sets", "questions", "prompt_variants", "question_tags"]}
    />
  );
}
