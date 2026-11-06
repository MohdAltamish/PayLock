// Decision J: the browser talks only to /api/* on this origin; Next proxies to
// the API so cookies stay first-party. compress:false keeps SSE unbuffered.
const API_URL = process.env.API_URL ?? "http://localhost:4000";
const dev = process.env.NODE_ENV !== "production";

// PayPal JS SDK v6 needs these origins (script, popup/modal frames, API calls, images).
const paypal = "https://www.sandbox.paypal.com https://*.paypal.com https://*.paypalobjects.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval' " : ""}${paypal}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${paypal}`,
  `connect-src 'self' ${paypal}`,
  `frame-src ${paypal}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
export default {
  compress: false,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@paylock/schemas"],
  // Workspace packages use NodeNext-style ".js" specifiers for ".ts" sources.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Demo deliverables are fetched by the Verifier; keep them simple and cacheable.
        source: "/demo/deliverables/:slug",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};
