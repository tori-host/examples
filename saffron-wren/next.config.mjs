// The headers every response carries, pages, API, static files and 404s
// alike. The Content-Security-Policy is not here: it holds a fresh nonce for
// each request, so proxy.js writes it.

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md into your copy.
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The pages on tori.host are the ones meant to be found; this copy is not.
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ]
  },
}

export default nextConfig
