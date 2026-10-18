import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Secure-form pages carry private links: never cached, never indexed, never framed, and the link is not leaked through the Referer header.
  async headers() {
    const privatePage = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [{ source: "/f/:path*", headers: privatePage }, { source: "/pay/:path*", headers: privatePage }];   // payment links are private links too
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
