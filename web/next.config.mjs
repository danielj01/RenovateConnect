/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
