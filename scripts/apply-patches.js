#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * apply-patches.js — postinstall script
 *
 * Patches eslint-plugin-react bundled inside eslint-config-next to support
 * ESLint 10 (which removed context.getFilename()).
 *
 * Safe to run repeatedly — checks for the patch marker before applying.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(
  __dirname,
  '../node_modules/eslint-config-next/node_modules/eslint-plugin-react/lib/util/version.js'
);

if (!fs.existsSync(TARGET)) {
  console.log('[apply-patches] Nested eslint-plugin-react not found — skipping.');
  process.exit(0);
}

const ORIGINAL = "contextOrFilename.getFilename()";
const PATCHED  = "(contextOrFilename.getFilename ? contextOrFilename.getFilename() : contextOrFilename.filename)";
const MARKER   = "/* eslint10-compat */";

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[apply-patches] Already patched — skipping.');
  process.exit(0);
}

if (!src.includes(ORIGINAL)) {
  console.log('[apply-patches] Pattern not found — may already be fixed upstream. Skipping.');
  process.exit(0);
}

src = src.replace(ORIGINAL, PATCHED + ' ' + MARKER);
fs.writeFileSync(TARGET, src, 'utf8');
console.log('[apply-patches] Patched eslint-plugin-react for ESLint 10.');
