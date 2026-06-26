#!/usr/bin/env node
/**
 * scripts/check-migrations.js
 *
 * Guards against duplicate Drizzle migration prefixes (e.g. two files named
 * 0017_*.sql). Duplicate prefixes are a maintenance hazard: Drizzle applies
 * them both, but tooling (drizzle-kit studio, drizzle-kit migrate --dry-run)
 * may behave unexpectedly when two migrations share the same sequence number.
 *
 * Usage:
 *   node scripts/check-migrations.js
 *
 * Exit codes:
 *   0 — no duplicates found
 *   1 — one or more duplicate prefixes detected (prints offending files)
 *
 * Add to CI:
 *   - name: Check for duplicate migrations
 *     run: node scripts/check-migrations.js
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'drizzle', 'migrations');

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.log('No migrations directory found — skipping check.');
  process.exit(0);
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

// Group by numeric prefix (e.g. "0017" from "0017_add_clerk_index.sql")
const byPrefix = {};
for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) continue;
  const prefix = match[1];
  if (!byPrefix[prefix]) byPrefix[prefix] = [];
  byPrefix[prefix].push(file);
}

const duplicates = Object.entries(byPrefix).filter(([, group]) => group.length > 1);

if (duplicates.length === 0) {
  console.log(`✅  No duplicate migration prefixes found (${files.length} migrations checked).`);
  process.exit(0);
}

console.error('❌  Duplicate migration prefixes detected:');
for (const [prefix, group] of duplicates) {
  console.error(`\n  Prefix ${prefix}:`);
  for (const file of group) {
    console.error(`    ${file}`);
  }
}
console.error('\nRename one of the duplicates to the next available sequence number.');
process.exit(1);
