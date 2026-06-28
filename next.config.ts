import type { NextConfig } from 'next';

// ── Security headers ──────────────────────────────────────────────────────────
//
// C-1 fix: comprehensive HTTP security headers on every response.
//
// CSP NOTE FOR CLERK:
//   Clerk's browser SDK makes fetch() calls to two types of domains:
//     1. The Frontend API — derived from the publishable key:
//          pk_live_abc123... → https://abc123.clerk.accounts.dev  (prod)
//          pk_test_abc123... → https://abc123.clerk.accounts.dev  (dev)
//        We cannot predict this domain statically, so we allow the entire
//        *.clerk.accounts.dev subdomain.
//     2. Clerk's CDN/API — https://api.clerk.com, https://clerk.com
//   Both must be in connect-src and script-src or auth will hang loading.
// ─────────────────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';

// ── script-src ────────────────────────────────────────────────────────────────
// Clerk's @clerk/nextjs package bundles its JS into the Next.js output, so
// 'self' covers the main Clerk SDK. However Clerk also lazy-loads scripts from
// its CDN for the hosted sign-in/sign-up UI and the account portal.
const scriptSrc = [
  "'self'",
  // Clerk lazy-loaded scripts (hosted sign-in modal, account portal)
  'https://*.clerk.accounts.dev',
  'https://*.clerk.com',
  'https://clerk.com',
  // Next.js dev HMR needs eval and inline in dev mode.
  // NOTE: Clerk's hosted UI requires 'unsafe-inline' for scripts in production,
  // so 'unsafe-inline' is kept in prod (a nonce-based CSP would require dropping
  // it, which breaks Clerk). No per-request nonce is used.
  ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : ["'unsafe-inline'"]),  // Clerk requires unsafe-inline in prod
].join(' ');

// ── connect-src ───────────────────────────────────────────────────────────────
// Every fetch() / XHR from the browser. Clerk's browser SDK calls its
// Frontend API (*.clerk.accounts.dev) on every page load to hydrate session.
const connectSrc = [
  "'self'",
  // Clerk Frontend API (e.g. abc123.clerk.accounts.dev) — REQUIRED for auth
  'https://*.clerk.accounts.dev',
  'https://*.clerk.com',
  'https://clerk.com',
  'https://api.clerk.com',
  // Sentry error reporting
  'https://*.sentry.io',
  'https://sentry.io',
  // Upstash Redis (server-side only, but included defensively)
  'https://*.upstash.io',
  // Neon DB (server-side only)
  'https://*.neon.tech',
  // External RPC providers (used from browser on infra test page)
  'https://*.alchemy.com',
  'https://eth.llamarpc.com',
  // Next.js dev HMR WebSocket
  ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
].join(' ');

// ── img-src ───────────────────────────────────────────────────────────────────
const imgSrc = [
  "'self'",
  'data:',
  'blob:',
  // Clerk user avatar CDN
  'https://img.clerk.com',
  'https://*.clerk.com',
  // OpenSea / NFT image CDNs
  'https://*.seadn.io',
  'https://*.opensea.io',
  'https://ipfs.io',
  'https://*.ipfs.io',
].join(' ');

// ── frame-src ─────────────────────────────────────────────────────────────────
// Clerk renders the sign-in/account portal in an iframe from its own domain.
const frameSrc = [
  'https://*.clerk.accounts.dev',
  'https://*.clerk.com',
  'https://clerk.com',
  'https://accounts.google.com',
].join(' ');

const csp = [
  `default-src 'self'`,
  `script-src ${scriptSrc}`,
  `connect-src ${connectSrc}`,
  `img-src ${imgSrc}`,
  `font-src 'self' data:`,
  `frame-src ${frameSrc}`,
  // style-src: 'unsafe-inline' required by Tailwind CSS v4 (inline styles)
  `style-src 'self' 'unsafe-inline'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options',          value: 'DENY' },
  { key: 'X-Content-Type-Options',   value: 'nosniff' },
  { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  },
  ...(isDev ? [] : [{
    key:   'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  }]),
  { key: 'Content-Security-Policy',  value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
