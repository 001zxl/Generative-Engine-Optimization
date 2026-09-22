/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // node:sqlite 是 Node 内置模块，必须留在服务端运行时，不能被前端打包
  serverExternalPackages: [],
  // 浏览器惯例会额外请求 /favicon.ico；我们没有二进制 .ico，
  // 重写到已声明的 icon.svg，避免每个页面都产生一个 404 控制台错误。
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
