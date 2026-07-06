/**
 * Audit finding (Medium) — SSRF in analyzer website-metadata discovery.
 *
 * Verifies assertPublicHttpUrl() rejects the common SSRF payload shapes
 * (localhost, loopback, RFC1918 private ranges, link-local / cloud metadata,
 * non-http(s) schemes) while allowing ordinary public URLs through.
 */

import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl } from '../ssrf-guard';

async function expectRejected(url: string) {
  await expect(assertPublicHttpUrl(url)).rejects.toThrow();
}

async function expectAllowed(url: string) {
  await expect(assertPublicHttpUrl(url)).resolves.toBeUndefined();
}

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expectRejected('file:///etc/passwd');
    await expectRejected('ftp://example.com/file');
    await expectRejected('gopher://example.com');
  });

  it('rejects malformed URLs', async () => {
    await expectRejected('not a url');
    await expectRejected('');
  });

  it('rejects localhost and loopback literals', async () => {
    await expectRejected('http://localhost/');
    await expectRejected('http://localhost:3000/internal');
    await expectRejected('http://127.0.0.1/');
    await expectRejected('http://127.1.2.3/');
    await expectRejected('http://[::1]/');
  });

  it('rejects RFC1918 private ranges', async () => {
    await expectRejected('http://10.0.0.5/');
    await expectRejected('http://172.16.0.1/');
    await expectRejected('http://172.31.255.255/');
    await expectRejected('http://192.168.1.1/');
  });

  it('rejects link-local / cloud metadata addresses', async () => {
    await expectRejected('http://169.254.169.254/latest/meta-data/');
    await expectRejected('http://169.254.0.1/');
  });

  it('rejects 0.0.0.0 and unspecified addresses', async () => {
    await expectRejected('http://0.0.0.0/');
    await expectRejected('http://[::]/');
  });

  it('rejects CGNAT and reserved/multicast ranges', async () => {
    await expectRejected('http://100.64.0.1/');
    await expectRejected('http://224.0.0.1/');
    await expectRejected('http://240.0.0.1/');
  });

  it('rejects IPv4-mapped IPv6 private addresses', async () => {
    await expectRejected('http://[::ffff:127.0.0.1]/');
    await expectRejected('http://[::ffff:10.0.0.1]/');
  });

  it('allows ordinary public IPv4 literals', async () => {
    await expectAllowed('http://8.8.8.8/');
    await expectAllowed('https://1.1.1.1/');
  });

  it('allows ordinary public hostnames (DNS-resolved)', async () => {
    // opensea.io resolves to Cloudflare-fronted public IPs.
    await expectAllowed('https://opensea.io/');
  });
});
