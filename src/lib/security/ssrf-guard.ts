import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

// ── SSRF guard for server-side fetches of user-supplied URLs ─────────────
//
// Used by any code path that fetches a URL supplied (directly or indirectly)
// by an authenticated user — e.g. the Analyzer's website-metadata lookup.
// Blocks requests to localhost, RFC1918 private ranges, link-local/cloud
// metadata addresses, and other non-public IP space.
//
// M-04 fix: this guard previously only validated the hostname's DNS
// resolution at call time without pinning the resolved IP for the
// subsequent fetch() — a DNS-rebinding attacker (resolve to a public IP for
// this check, then to a private IP moments later for the real request)
// could bypass it. `fetchPublicUrl()` below closes that gap: it validates
// the resolved address AND performs the actual HTTP request against that
// exact pinned IP (via a per-request undici Agent with a custom `lookup`),
// while still sending the correct Host header / TLS SNI for the original
// hostname. `assertPublicHttpUrl()` remains available as a validate-only
// helper for callers that build their own request pipeline.
// ───────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', '0.0.0.0', '::1', '::']);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true; // malformed -> fail closed

  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local fc00::/7

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> validate the embedded IPv4 address.
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice('::ffff:'.length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }

  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP literal -> fail closed
}

type ResolvedPublicUrl = {
  url: URL;
  /** The exact address that was validated as public and must be pinned for the real request. */
  address: string;
  family: 4 | 6;
};

/**
 * Validates `rawUrl` is safe to fetch server-side on behalf of a user and
 * returns the specific public address that was validated:
 *  - must be http:// or https://
 *  - hostname must not be a blocked literal (localhost, 0.0.0.0, ::1, ...)
 *  - the resolved/literal address must be public (not private/loopback/
 *    link-local/multicast/reserved)
 *
 * When the hostname resolves to multiple addresses, ALL of them are checked
 * (so a hostname that round-robins between a public and a private IP is
 * still rejected), but the FIRST address is the one returned/pinned, since
 * that's deterministically what Node's own resolver would connect to first.
 */
async function resolvePublicHttpUrl(rawUrl: string): Promise<ResolvedPublicUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Requests to local/internal hosts are not allowed');
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Requests to private/internal IP addresses are not allowed');
    }
    const family = isIP(hostname) as 4 | 6;
    return { url, address: hostname, family };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve host');
  }

  if (addresses.length === 0) {
    throw new Error('Could not resolve host');
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error('Requests to private/internal IP addresses are not allowed');
    }
  }

  const [first] = addresses;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * Throws if `rawUrl` is not safe to fetch server-side on behalf of a user.
 * Validate-only helper -- prefer `fetchPublicUrl()` below when you control
 * the actual request, since it also pins the validated IP and closes the
 * DNS-rebinding gap this function alone cannot.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  await resolvePublicHttpUrl(rawUrl);
}

/**
 * SSRF-safe fetch: validates `rawUrl` resolves to a public address AND pins
 * the actual HTTP(S) connection to that exact validated address, so a
 * DNS-rebinding attacker cannot swap in a private IP between the check and
 * the request. The Host header and TLS SNI still use the original hostname
 * (undici's connector derives those from the request URL, not from the
 * pinned `lookup` result), so this is transparent to the origin server.
 */
export async function fetchPublicUrl(rawUrl: string, init?: RequestInit): Promise<Response> {
  const { address, family } = await resolvePublicHttpUrl(rawUrl);

  const agent = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, family);
      },
    },
  });

  try {
    // undici's fetch accepts a `dispatcher` option (not part of the
    // standard fetch() signature) to control connection routing per-request.
    return await (undiciFetch as unknown as (
      input: string,
      requestInit?: RequestInit & { dispatcher?: Dispatcher },
    ) => Promise<Response>)(rawUrl, { ...init, dispatcher: agent });
  } finally {
    void agent.close().catch(() => undefined);
  }
}
