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
