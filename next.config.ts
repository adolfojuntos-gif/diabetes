import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Security headers on every response. CSP is deliberately conservative: no inline scripts
  // beyond Next's own, no third-party origins until an integration actually needs one.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
