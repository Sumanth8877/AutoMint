#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/update-knowledge-base.js
//
// Auto-generates the "Current Capabilities" section of AUTOMINT_GUIDE.md
// by reading the actual codebase. Run this after adding new features:
//
//   node scripts/update-knowledge-base.js
//
// NOTE: the comment below claiming this runs "automatically by the GitHub
// Action on every push to main" is stale -- this repository currently has
// no .github/workflows directory at all, so nothing runs it, or any of
// `npm run lint` / `npm run typecheck` / `npm test`, automatically. Run
// this script manually after adding new features until CI is added.
// Human-written sections (marked with <!-- MANUAL -->) are never touched.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const GUIDE_PATH = path.join(ROOT, 'AUTOMINT_GUIDE.md');
const AI_SERVICE = path.join(ROOT, 'src/lib/services/ai-interpreter.service.ts');
const API_DIR    = path.join(ROOT, 'src/app/api');
const SERVICES_DIR = path.join(ROOT, 'src/lib/services');

// ── 1. Extract tools from ai-interpreter.service.ts ──────────────────────────

function extractTools(fileContent) {
  const tools = [];

  // Match: { type: 'function', function: { name: 'xxx', description: "yyy", parameters: { ... required: [...] } } }
  const toolRegex =
    /\{\s*type:\s*'function',\s*function:\s*\{\s*name:\s*'(\w+)',\s*description:\s*"([^"]+)",\s*parameters:\s*\{[^}]*properties:\s*\{([^}]*)\}(?:[^}]*required:\s*(\[[^\]]*\]))?/gs;

  let match;
  while ((match = toolRegex.exec(fileContent)) !== null) {
    const name        = match[1];
    const description = match[2];
    const propsRaw    = match[3] ?? '';
    const requiredRaw = match[4] ?? '[]';

    // Extract parameter names
    const paramNames = [];
    const paramRe = /(\w+):\s*\{[^}]*type:\s*'(\w+)'[^}]*description:\s*'([^']+)'/g;
    let pm;
    while ((pm = paramRe.exec(propsRaw)) !== null) {
      paramNames.push({ name: pm[1], type: pm[2], desc: pm[3] });
    }

    // Extract required params
    const required = (requiredRaw.match(/'(\w+)'/g) ?? []).map(s => s.replace(/'/g, ''));

    tools.push({ name, description, params: paramNames, required });
  }

  return tools;
}

// ── 2. Discover API routes ────────────────────────────────────────────────────

function discoverApiRoutes(apiDir) {
  const routes = [];

  function walk(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
        const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
        const methods = [];
        if (/export async function GET/i.test(content))    methods.push('GET');
        if (/export async function POST/i.test(content))   methods.push('POST');
        if (/export async function PUT/i.test(content))    methods.push('PUT');
        if (/export async function PATCH/i.test(content))  methods.push('PATCH');
        if (/export async function DELETE/i.test(content)) methods.push('DELETE');
        if (methods.length > 0) {
          routes.push({ path: `/api${prefix}`, methods });
        }
      }
    }
  }

  walk(apiDir, '');
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

// ── 3. Discover service files ─────────────────────────────────────────────────

function discoverServices(servicesDir) {
  if (!fs.existsSync(servicesDir)) return [];
  return fs.readdirSync(servicesDir)
    .filter(f => f.endsWith('.service.ts'))
    .map(f => f.replace('.service.ts', ''))
    .sort();
}

// ── 4. Build the auto-generated markdown section ──────────────────────────────

function buildAutoSection(tools, routes, services) {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`<!-- AUTO-GENERATED: Do not edit this section manually. -->`);
  lines.push(`<!-- Run \`node scripts/update-knowledge-base.js\` to regenerate. -->`);
  lines.push(`<!-- Last generated: ${now} -->`);
  lines.push(``);
  lines.push(`## AUTO-GENERATED: Current AI Tools (${tools.length} total)`);
  lines.push(``);
  lines.push(`> This section is auto-generated from \`src/lib/services/ai-interpreter.service.ts\`.`);
  lines.push(`> Every tool listed here is available via natural language in the web chat and Telegram.`);
  lines.push(``);

  // Group tools by category (infer from name prefix)
  const categories = {};
  for (const tool of tools) {
    const category = inferCategory(tool.name);
    if (!categories[category]) categories[category] = [];
    categories[category].push(tool);
  }

  for (const [cat, catTools] of Object.entries(categories)) {
    lines.push(`### ${cat}`);
    lines.push(``);
    lines.push(`| Tool | Description | Required params |`);
    lines.push(`|------|-------------|-----------------|`);
    for (const t of catTools) {
      const req = t.required.length > 0 ? t.required.join(', ') : '—';
      lines.push(`| \`${t.name}\` | ${t.description} | ${req} |`);
    }
    lines.push(``);
  }

  lines.push(`## AUTO-GENERATED: API Routes (${routes.length} endpoints)`);
  lines.push(``);
  lines.push(`> All routes require authentication. Dynamic segments shown as [param].`);
  lines.push(``);
  lines.push(`| Route | Methods |`);
  lines.push(`|-------|---------|`);
  for (const r of routes) {
    lines.push(`| \`${r.path}\` | ${r.methods.join(', ')} |`);
  }
  lines.push(``);

  lines.push(`## AUTO-GENERATED: Backend Services (${services.length} services)`);
  lines.push(``);
  lines.push(`> These services power the platform. Each maps to one or more AI tools.`);
  lines.push(``);
  for (const s of services) {
    lines.push(`- \`${s}.service.ts\``);
  }
  lines.push(``);
  lines.push(`<!-- END AUTO-GENERATED -->`);

  return lines.join('\n');
}

function inferCategory(toolName) {
  if (/wallet|balance/.test(toolName))          return '💳 Wallets & Balances';
  if (/whale|watch|activity/.test(toolName))    return '🐋 Whale Tracking';
  if (/copy.?mint|copy_mint/.test(toolName))    return '📋 Copy-Mint Rules';
  if (/^mint_|active_mint|cancel|retry|diagnose/.test(toolName)) return '🚀 Minting';
  if (/analyz|contract/.test(toolName))         return '🔍 Contract Analyzer';
  if (/collection|discover|floor/.test(toolName)) return '🖼️ Collections';
  if (/analytics|history|logs|activities/.test(toolName)) return '📊 Analytics & History';
  if (/monitor/.test(toolName))                 return '👁️ Monitoring';
  if (/setting|execution|notification|email|integrations|usage/.test(toolName)) return '⚙️ Settings';
  if (/system|status|gas|reset|search/.test(toolName)) return '🛠️ System & Utilities';
  return '🔧 Other';
}

// ── 5. Splice into AUTOMINT_GUIDE.md ─────────────────────────────────────────

function updateGuide(guide, autoSection) {
  const AUTO_START = '<!-- AUTO-GENERATED:';
  const AUTO_END   = '<!-- END AUTO-GENERATED -->';

  const startIdx = guide.indexOf(AUTO_START);
  const endIdx   = guide.indexOf(AUTO_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing auto-generated section
    return (
      guide.slice(0, startIdx).trimEnd() +
      '\n\n' +
      autoSection +
      '\n' +
      guide.slice(endIdx + AUTO_END.length).trimStart()
    );
  } else {
    // Append at the end
    return guide.trimEnd() + '\n\n---\n\n' + autoSection + '\n';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('📖 AutoMint Knowledge Base Updater');
  console.log('   Reading codebase...\n');

  // Read source files
  const aiServiceContent = fs.existsSync(AI_SERVICE)
    ? fs.readFileSync(AI_SERVICE, 'utf-8')
    : '';

  const tools    = extractTools(aiServiceContent);
  const routes   = discoverApiRoutes(API_DIR);
  const services = discoverServices(SERVICES_DIR);

  console.log(`   ✓ Found ${tools.length} AI tools`);
  console.log(`   ✓ Found ${routes.length} API routes`);
  console.log(`   ✓ Found ${services.length} services`);

  // Build auto section
  const autoSection = buildAutoSection(tools, routes, services);

  // Read and update guide
  const guide = fs.existsSync(GUIDE_PATH)
    ? fs.readFileSync(GUIDE_PATH, 'utf-8')
    : '# AutoMint Guide\n\n';

  const updated = updateGuide(guide, autoSection);
  fs.writeFileSync(GUIDE_PATH, updated, 'utf-8');

  console.log(`\n   ✅ AUTOMINT_GUIDE.md updated (${updated.length} chars)`);
  console.log(`   📁 ${GUIDE_PATH}`);
}

main();
