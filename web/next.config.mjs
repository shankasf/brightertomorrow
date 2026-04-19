/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
    ];
  },
};
export default nextConfig;
