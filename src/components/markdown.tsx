import Link from "next/link";
import {
  parseMarkdown,
  isExternalHref,
  type Block,
  type InlineNode,
  type HeadingLevel,
} from "@/lib/markdown";

/**
 * Markdown 渲染（服务端组件，无客户端 JS）。
 *
 * 安全边界全在 `@/lib/markdown` 的解析器里：它只产出已知类型的节点，
 * 这里再按类型映射成元素。因此不存在 dangerouslySetInnerHTML 的直通路径 ——
 * 正文里写 `<script>` 只会显示成这段文字本身。
 */

const HEADING_CLASS: Record<HeadingLevel, string> = {
  2: "pt-4 text-xl font-semibold tracking-tight sm:text-2xl",
  3: "pt-3 text-lg font-semibold",
  4: "pt-2 text-base font-semibold",
};

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === "text") return <span key={i}>{node.value}</span>;
        if (node.type === "code") {
          return (
            <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
              {node.value}
            </code>
          );
        }
        if (node.type === "strong") {
          return (
            <strong key={i} className="font-semibold">
              <Inline nodes={node.children} />
            </strong>
          );
        }
        const external = isExternalHref(node.href);
        const className = "text-primary underline underline-offset-2 break-words";
        // 站内链接用 Link 保持同页跳转；外站才新开标签页并带 rel
        return external ? (
          <a key={i} href={node.href} className={className} target="_blank" rel="noopener noreferrer">
            <Inline nodes={node.children} />
          </a>
        ) : (
          <Link key={i} href={node.href} className={className}>
            <Inline nodes={node.children} />
          </Link>
        );
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "heading") {
    const Tag = `h${block.level}` as "h2" | "h3" | "h4";
    return (
      <Tag className={HEADING_CLASS[block.level]}>
        <Inline nodes={block.children} />
      </Tag>
    );
  }
  if (block.type === "paragraph") {
    return (
      <p className="break-words">
        <Inline nodes={block.children} />
      </p>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={`ml-5 space-y-1.5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline nodes={item} />
          </li>
        ))}
      </Tag>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            {block.header.map((cell, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-semibold"
                style={{ textAlign: block.align[i] }}
              >
                <Inline nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top" style={{ textAlign: block.align[c] }}>
                  <Inline nodes={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source ?? "");
  return (
    <div className={`space-y-5 leading-8 ${className}`}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
