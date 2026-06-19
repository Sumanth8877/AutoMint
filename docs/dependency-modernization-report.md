# Dependency Modernization Report

Date: 2026-06-19

## Summary

- The app is already on the current stable Next.js and React lines: Next.js 16.2.9 and React 19.2.7.
- `npm audit` reports 0 known vulnerabilities.
- Removed unused Sentry integration from the dependency graph before the final lockfile sync; the tracked package baseline now contains no `@sentry/nextjs` dependency or Sentry stub.
- Added a Node engine guard matching Next.js 16 requirements: `node >=20.9.0`.
- Verified lint, typecheck, production build, audit, and local HTTP response.

## Dependency Inventory

| Package | Current | Latest stable checked | Registry modified | Status | Security | Breaking-change risk | Upgrade complexity |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| `@clerk/nextjs` | 7.5.6 | 7.5.6 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `@neondatabase/serverless` | 1.1.0 | 1.1.0 | 2026-04-17 | Maintained | No advisories | Low | Low |
| `@upstash/redis` | 1.38.0 | 1.38.0 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `drizzle-orm` | 0.45.2 | 0.45.2 | 2026-06-17 | Maintained | No advisories | Low | Low |
| `framer-motion` | 12.40.0 | 12.40.0 | 2026-06-17 | Maintained | No advisories | Low | Low |
| `lucide-react` | 1.21.0 | 1.21.0 | 2026-06-18 | Maintained | No advisories | Low | Low |
| `next` | 16.2.9 | 16.2.9 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `react` | 19.2.7 | 19.2.7 | 2026-06-18 | Maintained | No advisories | Low | Low |
| `react-dom` | 19.2.7 | 19.2.7 | 2026-06-18 | Maintained | No advisories | Low | Low |
| `server-only` | 0.0.1 | 0.0.1 | 2022-09-03 | Stable utility | No advisories | Low | Low |
| `viem` | 2.52.2 | 2.52.2 | 2026-06-04 | Maintained | No advisories | Low | Low |
| `@tailwindcss/postcss` | 4.3.1 | 4.3.1 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `@types/node` | 20.19.43 | 26.0.0 | 2026-06-19 | Maintained | No advisories | Medium: runtime-type mismatch | Deferred |
| `@types/react` | 19.2.17 | 19.2.17 | 2026-06-05 | Maintained | No advisories | Low | Low |
| `@types/react-dom` | 19.2.3 | 19.2.3 | 2025-11-12 | Maintained | No advisories | Low | Low |
| `drizzle-kit` | 0.31.10 | 0.31.10 | 2026-06-17 | Maintained | No advisories | Low | Low |
| `eslint` | 9.39.4 | 10.5.0 | 2026-06-12 | Maintained | No advisories | High: major tooling line | Deferred |
| `eslint-config-next` | 16.2.9 | 16.2.9 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `tailwindcss` | 4.3.1 | 4.3.1 | 2026-06-19 | Maintained | No advisories | Low | Low |
| `typescript` | 5.9.3 | 6.0.3 | 2026-06-18 | Maintained | No advisories | High: compiler major line | Deferred |

## Unused And Redundant Packages

- `@sentry/nextjs` was unused by imports and not present in the final dependency graph.
- No duplicate top-level UI, auth, database, Redis, blockchain, or animation libraries were found.
- `npm ls` reports several `@emnapi`/`@napi-rs`/`@tybys` packages as extraneous, but lockfile context shows they are bundled optional dependencies of Tailwind's oxide wasm package.

## Framework Audit

- Next.js App Router file structure is current.
- `src/proxy.ts` uses the Next.js 16 proxy convention.
- Dynamic route handler params are already promise-based.
- DB and Redis clients are lazy, server-only singletons.
- Tailwind v4 PostCSS setup is current.
- Clerk auth is enforced in the authenticated layout and in API route handlers.
- Drizzle schema and service usage typecheck under strict TypeScript.
- Viem client typing is compatible with the current `PublicClient<HttpTransport, Chain>` surface.

## Verification

- `npm install`: passed
- `npm audit --json`: 0 vulnerabilities
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- `npm test --if-present`: no test script present
- `GET http://localhost:3000`: 200 OK

## Performance Snapshot

- Production compile: 3.6s
- TypeScript during build: 7.2s
- Static generation: 25 routes in 378ms
- Dependency graph after cleanup: 502 total audited packages

No reliable pre-change build baseline was available in the working tree, so only the verified post-modernization metrics are recorded.

## Remaining Risks

- `@types/node`, `eslint`, and `typescript` have newer major lines. They were intentionally deferred because Next.js 16.2.9, eslint-config-next 16.2.9, and the declared runtime should be validated against those majors before adopting them.
- No automated unit/integration test suite is defined.
- Browser visual verification was attempted but the in-app browser runtime failed to start due to the environment sandbox.
