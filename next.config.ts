import type { NextConfig } from 'next';

// ── Security headers ──────────────────────────────────────────────────────────
//
// Applied to every response via the `headers()` hook. Clerk's hosted JS and
// the Clerk Dashboard iframe require specific CSP allowances; everything else
// is restricted to same-origin or named trusted sources.
//
// Adjust the `connectSrc` list if you add a new external API call from the
// browser (server-to-server calls are unaffected by CSP).
// ─────────────────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';

// Clerk requires: its own CDN (clerk.*.com / *.clerk.com), accounts.google.com
// for social login, and 'unsafe-inline' + 'unsafe-eval' only in dev for HMR.
const scriptSrc = [
  "'self'",
  // Clerk hosted JS
  'https://clerk.automint.app',
  'https://*.clerk.com',
  'https://clerk.*.com',
  // Next.js dev HMR / eval (dev only)
  ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
].join(' ');

const connectSrc = [
  "'self'",
  // Clerk API
  'https://clerk.automint.app',
  'https://*.clerk.com',
  'https://clerk.*.com',
  // Sentry
  'https://*.sentry.io',
  'https://sentry.io',
  // Upstash (Redis) – server-side only, but include in case of client fetch
  'https://*.upstash.io',
  // Neon DB – server-side only
  'https://*.neon.tech',
  // External RPC providers accessed from the browser (infra test page)
  'https://*.alchemy.com',
  'https://eth.llamarpc.com',
  // Next.js dev HMR websocket
  ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
].join(' ');

const imgSrc = [
  "'self'",
  'data:',
  'blob:',
  // Clerk avatar CDN
  'https://img.clerk.com',
  'https://*.clerk.com',
  // OpenSea / NFT image CDNs (used in collection and analyzer views)
  'https://*.seadn.io',
  'https://*.opensea.io',
  'https://ipfs.io',
  'https://*.ipfs.io',
].join(' ');

const fontSrc = ["'self'", 'data:'].join(' ');

const frameSrc = [
  // Clerk hosted sign-in modal / Clerk Dashboard iframe
  'https://clerk.automint.app',
  'https://*.clerk.com',
  'https://clerk.*.com',
  'https://accounts.google.com',
].join(' ');

const csp = [
  `default-src 'self'`,
  `script-src ${scriptSrc}`,
  `connect-src ${connectSrc}`,
  `img-src ${imgSrc}`,
  `font-src ${fontSrc}`,
  `frame-src ${frameSrc}`,
  // style-src: 'unsafe-inline' is required by Tailwind CSS (inline styles
  // generated at build time). Nonces are not yet viable with Tailwind v4.
  `style-src 'self' 'unsafe-inline'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  // Upgrade HTTP to HTTPS in production
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  // Prevent clickjacking — no iframe embedding anywhere
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Control referrer info sent to third-party sites
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features not used by the app
  {
    key: 'Permissions-Policy',
    value: [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'bluetooth=()',
    ].join(', '),
  },
  // HSTS — only in production (avoids breaking local dev HTTPS)
  ...(isDev ? [] : [{
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  }]),
  // Content-Security-Policy
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
