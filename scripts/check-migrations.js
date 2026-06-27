#!/usr/bin/env node
/**
 * scripts/check-migrations.js
 *
 * Guards against duplicate Drizzle migration prefixes (for example two files
 * named 0017_*.sql). Duplicate prefixes are a maintenance hazard: Drizzle
 * applies them both, but tooling may behave unexpectedly when two migrations
 * share the same sequence number.
 *
 * Usage:
 *   node scripts/check-migrations.js
 */

async function main() {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const migrationsDir = path.join(__dirname, '..', 'src', 'drizzle', 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found - skipping check.');
    process.exit(0);
  }

  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));

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
    console.log(`No duplicate migration prefixes found (${files.length} migrations checked).`);
    process.exit(0);
  }

  console.error('Duplicate migration prefixes detected:');
  for (const [prefix, group] of duplicates) {
    console.error(`\n  Prefix ${prefix}:`);
    for (const file of group) {
      console.error(`    ${file}`);
    }
  }

  console.error('\nRename one of the duplicates to the next available sequence number.');
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
