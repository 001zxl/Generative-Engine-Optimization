import { PendingModule } from "@/components/pending-module";

export const metadata = { title: "品牌与竞品", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PendingModule
      title="品牌与竞品"
      question="品牌目前在哪些问题中出现？哪些竞品比品牌出现得更多？"
      depends={["品牌实体与别名的一致性维护", "竞品库与别名匹配规则", "多平台采样后才能计算 Share of Voice"]}
      tables={["brands", "brand_aliases", "competitors", "business_lines"]}
    />
  );
}
