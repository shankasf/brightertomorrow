/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  devIndicators: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "brightertomorrowtherapy.com" },
      { protocol: "https", hostname: "**.brightertomorrowtherapy.com" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/ai/:path*",
        destination: `${process.env.AI_SERVICE_URL || "http://127.0.0.1:8001"}/:path*`,
      },
      // admin.brightertomorrowtherapy.cloud serves the same Next.js app as the
      // public site, but visitors hitting the root or any non-/admin URL there
      // should land on the admin app, not the marketing site.
      {
        source: "/",
        has: [{ type: "host", value: "admin.brightertomorrowtherapy.cloud" }],
        destination: "/admin",
      },
      {
        source: "/:path((?!admin|_next|favicon|api).*)",
        has: [{ type: "host", value: "admin.brightertomorrowtherapy.cloud" }],
        destination: "/admin/:path",
      },
    ];
  },
};
export default nextConfig;
