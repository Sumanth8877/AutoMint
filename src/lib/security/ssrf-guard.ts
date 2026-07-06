import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// ── SSRF guard for server-side fetches of user-supplied URLs ──────────────
//
// Used by any code path that fetches a URL supplied (directly or indirectly)
// by an authenticated user — e.g. the Analyzer's website-metadata lookup.
// Blocks requests to localhost, RFC1918 private ranges, link-local/cloud
// metadata addresses, and other non-public IP space.
//
// NOTE: This validates the hostname's DNS resolution at call time. It does
// NOT pin the resolved IP for the subsequent fetch(), so a sufficiently
// motivated attacker using DNS-rebinding (resolve to a public IP for this
// check, then to a private IP a moment later for the real request) could
// still bypass it in theory. That level of protection would require routing
// the fetch through a custom dispatcher that connects to the pinned IP
// directly. This guard blocks the overwhelming majority of real-world SSRF
// payloads (literal private IPs, localhost, cloud metadata endpoints) with
// minimal complexity.
// ────────────────────────────────────────────────────────────────────────

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

/**
 * Throws if `rawUrl` is not safe to fetch server-side on behalf of a user:
 *  - must be http:// or https://
 *  - hostname must not be a blocked literal (localhost, 0.0.0.0, ::1, ...)
 *  - all resolved addresses (or the literal IP, if one was given) must be
 *    public (not private/loopback/link-local/multicast/reserved)
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
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
    return;
  }

  let addresses: Array<{ address: string }>;
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
}
