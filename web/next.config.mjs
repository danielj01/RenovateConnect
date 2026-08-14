// Security headers for the marketing/web app (Vercel). The API (Render) has
// its own equivalent set via Helmet — this closes the same gap here, since
// the two are separate services and neither's headers cover the other.
//
// script-src/style-src need 'unsafe-inline': Next.js's own App Router emits
// inline hydration/RSC-payload <script> tags (confirmed by inspecting the
// deployed HTML — 6 of them, unrelated to the JSON-LD structured-data script,
// which also needs this) and a handful of elements carry inline style=. A
// stricter nonce-based CSP is possible via middleware but wasn't worth the
// risk of silently breaking hydration without a way to verify it in a real
// browser from here — this still blocks loading any script/style from an
// unauthorized origin, which is the main thing CSP is for.
//
// connect-src allows the API domain: the browser calls it directly for the
// waitlist form, the guest estimate upload, and business/shared-estimate
// fetches (components/WaitlistForm.tsx, EstimateClient.tsx, lib/api.ts).
// img-src allows *.amazonaws.com: business logos/portfolio photos are S3-hosted.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.amazonaws.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api.renovateconnect.com",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      // Apple requires the Associated Domains file at this exact path. We serve
      // it from a route handler (app/api/aasa) so the appID can come from env.
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/api/aasa',
      },
    ];
  },
  // We render profile/portfolio images with plain <img>, not next/image, so the
  // Image Optimizer (and its remotePatterns DoS surface) is intentionally unused.
};

export default nextConfig;
