import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/**": ["./certs/supabase-root-2021.crt"] },
  serverExternalPackages: [
    "pg",
    "@electric-sql/pglite",
    "@langfuse/otel",
    "@opentelemetry/sdk-trace-node",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
        ],
      },
    ];
  },
};
export default config;
