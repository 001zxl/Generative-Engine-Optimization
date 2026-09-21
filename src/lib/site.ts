import "server-only";

/**
 * 站点配置（**仅服务端**）。
 *
 * ⚠️ 这个文件曾被一个 `"use client"` 组件（site-header.tsx）引用，
 * 后果是 Next 把 `process.env.X` **在构建时静态内联** —— 改了 .env 不重新构建就不生效。
 * 实测：修改 CONTACT_EMAIL 后重启服务，页面上仍显示旧邮箱。
 *
 * 更危险的变体：如果被客户端引用的模块里读了密钥，密钥会被打进客户端包。
 *
 * 现在加了 `import "server-only"`：任何客户端组件再引用本文件都会**直接构建失败**，
 * 这类问题从"靠人记得"变成"编译期不可能"。
 *
 * 需要给客户端组件传值的，由服务端组件以 props 传入（见 site-header / console-nav）。
 */
/** 站点级配置：canonical / OpenGraph / sitemap 全部由 APP_BASE_URL 派生（换域名不动代码） */

export const site = {
  name: process.env.SITE_NAME ?? "GEO 可见度实验室",
  baseUrl: (process.env.APP_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, ""),
  contactEmail: process.env.CONTACT_EMAIL ?? "hello@example.com",
  tagline: "让品牌更容易被 AI 搜索、理解和引用",
};

export function abs(path: string): string {
  return `${site.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
