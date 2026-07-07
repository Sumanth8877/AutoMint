# AutoMint — Complete User Guide & Knowledge Base

> This file is the AI's reference book. The AI reads it at runtime and uses it to answer
> questions, explain features, and guide users through any task. Edit this file to improve
> the AI's knowledge — no code changes needed.

---

## 1. What Is AutoMint?

AutoMint is an intelligent NFT minting platform that gives you full control over NFT minting
across Ethereum, Base, Polygon, and Arbitrum. It combines:

- **AI-powered control** — talk to it in plain English via Telegram or the web chat
- **Smart contract analysis** — risk scoring, ABI discovery, rug/honeypot detection
- **Whale tracking** — monitor whale wallets and auto-copy their mints
- **Automated minting** — queue mints from any URL, schedule them, retry on failure
- **Analytics** — success rates, gas spent, mint history, collection floor prices

---

## 2. Wallets

### What wallets are supported?
AutoMint supports EVM wallets on: **Ethereum, Base, Polygon, Arbitrum**.

### How to add a wallet
1. Go to **Wallets** page → click **Add Wallet**
2. Or tell the AI: `"Add my wallet 0x123..."`
3. Or via Telegram: `/wallet add 0x123...`

### Wallet fields
| Field | Description |
|-------|-------------|
| Address | EVM address (0x...) |
| Chain | ethereum / base / polygon / arbitrum |
| Balance | Auto-fetched ETH balance |
| Default | The wallet used for minting unless specified |
| Funded | Whether balance > 0 |

### AI commands for wallets
- `"Show my wallets"` → lists all wallets with balances
- `"Check my Ethereum balance"` → balance on specific chain
- `"Set 0x123... as default"` → changes default wallet
- `"Refresh my wallet balance"` → re-fetches on-chain balance
- `"Remove wallet 0x123..."` → deletes wallet (asks for confirmation)
- `"Rename my wallet to defi1"` → updates wallet label

### Common issues
- **"No wallet found"** — you need to add a wallet first
- **Balance shows 0** — try `"Refresh my balance"` to re-fetch on-chain
- **Wrong chain** — make sure you specify the chain when adding

---

## 3. Minting

### What is a mint?
A mint is the process of purchasing/creating an NFT from a smart contract. AutoMint handles
the entire process: contract analysis → gas estimation → transaction broadcast.

### How to mint
1. **From the web** → go to **Analyzer** page → paste URL or contract address → click Mint
2. **AI command**: `"Mint this URL: https://..."` or `"Mint 2 from 0x1234..."`
3. **Telegram**: `/mint https://...`

### Mint statuses
| Status | Meaning |
|--------|---------|
| `pending` | Queued, waiting to execute |
| `monitoring` | Watching for mint window to open |
| `ready` | About to execute |
| `running` | Transaction being broadcast |
| `completed` | Successfully minted ✅ |
| `failed` | Transaction failed ❌ |
| `cancelled` | Manually cancelled |

### AI commands for minting
- `"Mint from https://..."` → queues a mint task
- `"Show my active mints"` → lists pending/running mints
- `"Cancel mint [task ID]"` → cancels a pending mint
- `"Retry my failed mint"` → requeues a failed task
- `"Show my mint history"` → all past mints with results
- `"Why did my last mint fail?"` → diagnoses failure reason

### Mint settings (Gas Strategy)
| Strategy | Description |
|----------|-------------|
| `slow` | Low gas, may miss fast mints |
| `normal` | Balanced — good for most mints |
| `fast` | Higher gas, better success rate |
| `aggressive` | Max gas, for competitive mints |

To change: `"Set my gas strategy to fast"` or via **Settings → Execution**.

### Risk threshold
AutoMint automatically scores contracts 0–100 for risk:
- 0–30: Low risk ✅
- 31–60: Medium risk ⚠️
- 61–100: High risk 🔴

Default: mints with score > 75 are blocked. To change: `"Set my risk threshold to 60"`.

---

## 4. Contract Analyzer

### What does the Analyzer do?
It runs a full analysis pipeline on any NFT contract or mint URL:
- **Contract type detection** — ERC-721, ERC-1155, ERC-2309, Seadrop
- **Risk scoring** — rug pull indicators, honeypot checks, ownership analysis
- **ABI discovery** — finds the correct mint function and parameters
- **Gas estimation** — estimates cost at current network conditions
- **Social detection** — finds Twitter, Discord, website links

### How to use
1. **Web**: go to **Analyzer** page → paste URL or address
2. **AI**: `"Analyze this contract: 0x1234..."` or `"Check if this is risky: https://..."`

### What URLs are accepted?
- Direct contract address: `0x1234...`
- OpenSea collection URL: `https://opensea.io/collection/...`
- Launchpad URLs: most major platforms supported
- Explorer URLs: `https://etherscan.io/address/0x...`

### Reading the analysis result
- **Risk score** — lower is safer
- **Mint function** — which function AutoMint will call
- **Max supply / minted** — how many have been minted
- **Price per mint** — cost in ETH
- **Flags** — specific risk signals found (e.g. "owner can pause", "proxy contract")

---

## 5. Whale Tracker

### What is whale tracking?
You can watch specific wallet addresses. When they mint NFTs, you get notified — and
optionally, AutoMint automatically copies their mint for you.

### How to watch a wallet
- AI: `"Watch wallet 0xabc... on Ethereum"`
- AI: `"Track this whale: 0xabc... — name it Alpha Whale"`
- Telegram: `/watch 0xabc...`
- Web: **Whale Tracker** page → Add Wallet

### Whale activity
- AI: `"Show me recent whale activity"`
- AI: `"What has 0xabc... been minting?"`
- Web: **Whale Tracker** page → Activity tab

### Copy-mint rules
A copy-mint rule automatically mints for YOU when a watched wallet mints.

#### Creating a copy-mint rule
```
"Watch 0xabc... and copy-mint if they mint more than 2 times under $5"
"Create copy-mint rule for 0xabc... with max price 0.002 ETH, quantity 1, auto-mint on"
```

#### Copy-mint rule fields
| Field | Description | Default |
|-------|-------------|---------|
| walletAddress | The whale to monitor | required |
| maxPrice | Max mint price in ETH (e.g. 0.002 = ~$5) | no limit |
| quantity | How many YOU mint when triggered | 1 |
| minMintCount | How many times whale must mint before triggering | 1 |
| autoMint | true = execute immediately, false = notify only | false |
| riskThreshold | Max risk score allowed for the copy | 75 |

#### USD to ETH conversion (approx)
- $5 = 0.002 ETH
- $10 = 0.004 ETH
- $25 = 0.01 ETH
- $50 = 0.02 ETH
- $100 = 0.04 ETH
(Based on 1 ETH ≈ $2500)

---

## 6. Collections

### What are collections?
Collections are NFT projects you're tracking. AutoMint maintains floor prices and
lets you discover new ones.

### AI commands
- `"Show my collections"` → lists tracked collections with floor prices
- `"Find the CryptoPunks collection"` → discovers via OpenSea
- `"Refresh floor price for [collection]"` → fetches latest floor
- `"Remove [collection] from my list"` → deletes from tracking

---

## 7. Analytics

### What analytics are available?
- **Mint success rate** — % of mints that completed successfully
- **Gas spent** — total ETH spent on gas
- **Mint count by chain** — breakdown by Ethereum/Base/Polygon/Arbitrum
- **Recent activity** — timeline of all mint events

### AI commands
- `"Show my analytics"` → full dashboard summary
- `"How much gas have I spent?"` → gas cost breakdown
- `"What's my success rate?"` → success/failure ratio

---

## 8. Monitoring

### Website monitoring
AutoMint can monitor websites for mint launches (new mint pages appearing).

- AI: `"Monitor this website for mints: https://..."`
- AI: `"Show my monitored websites"`
- AI: `"Remove monitoring for https://..."`
- AI: `"Show recent monitoring events"`

---

## 9. Settings

### Execution settings
Control how AutoMint executes mints:
- **Gas strategy**: slow / normal / fast / aggressive
- **Risk threshold**: 0–100 (mints above this score are blocked)
- **Auto-detect socials**: whether to fetch Twitter/Discord during analysis
- **Slippage tolerance**: for DEX-based mints

AI: `"Show my execution settings"` or `"Update my gas strategy to aggressive"`

### Notification settings
- **Telegram notifications**: on/off for each event type
- **Email notifications**: summary emails for completions/failures

AI: `"Turn off mint failure notifications"` or `"Show my notification settings"`

### AI provider settings
AutoMint supports two AI providers:
- **Gemini** (Google) — primary, frontier intelligence
- **Nara Router** (Mistral) — fallback, fast and reliable

If one provider is down, AutoMint automatically switches to the other.
Set your API keys in **Settings → AI Keys**.

AI: `"Which AI model am I using?"` or `"Switch to Gemini 2.5 Pro"`

---

## 10. System Status

### Checking system health
- AI: `"Check system status"` → shows all service health
- AI: `"Is everything working?"` → quick health summary
- Web: **Settings → System** page

### Services monitored
- Database connectivity
- Redis (event bus)
- Blockchain RPC providers
- AI provider availability
- Alchemy webhook status

---

## 11. Search

AutoMint has full-text search across all your data.

- AI: `"Search for 0xabc..."` → finds wallets, collections, mints matching the query
- AI: `"Find all mints from last week"` → searches mint history
- Web: search bar in the top navigation

---

## 12. Common Workflows

### Workflow: Mint an NFT from a URL
```
1. "Analyze https://mint.example.com"
2. Review risk score and mint price
3. "Mint 1 from https://mint.example.com"
4. "Show my active mints" — check status
```

### Workflow: Set up whale copy-minting
```
1. "Watch wallet 0xKnownWhale... and name it Alpha"
2. "Show me Alpha's recent activity"
3. "Create copy-mint rule for Alpha: max $10, quantity 1, auto-mint on"
4. "Show my copy-mint rules" — verify
```

### Workflow: Find and track a collection
```
1. "Find the Azuki collection on OpenSea"
2. "Add it to my collections"
3. "What's the current floor price for Azuki?"
```

### Workflow: Diagnose a failed mint
```
1. "Show my recent failed mints"
2. "Why did mint [ID] fail?"
3. "Retry failed mint [ID]"
```

### Workflow: Check wallet health
```
1. "Show all my wallets"
2. "Refresh my Ethereum balance"
3. "What's my gas estimate for a normal mint?"
```

---

## 13. Telegram Bot Commands

In addition to natural language, these slash commands work:
| Command | Action |
|---------|--------|
| `/start` | Begin setup |
| `/mint <url>` | Queue a mint |
| `/watch <address>` | Watch a wallet |
| `/status` | Active mints + system status |
| `/cancel` | Cancel latest pending mint |
| `/settings` | View current settings |
| `/model` | View/change AI model |
| `/help` | Show all commands |

---

## 14. Troubleshooting

### "AI features not configured"
→ Add a Gemini or Nara API key in **Settings → AI Keys**

### "No wallet found"
→ Go to **Wallets** page and add a wallet first

### Mint keeps failing
→ Try: `"Diagnose my last failed mint"` — AI will explain the specific reason
→ Common causes: out of gas, mint sold out, wrong network, contract paused

### Analyzer can't find mint function
→ The contract may use an unusual ABI. Try providing the contract address directly.

### Whale tracker not showing activity
→ Alchemy webhooks may need reconnecting. Check **Settings → System → Alchemy**

### Balance not updating
→ Tell the AI: `"Refresh my wallet balance"` to force an on-chain fetch

---

## 15. Chains Supported

| Chain | ID | Symbol |
|-------|----|--------|
| Ethereum | 1 | ETH |
| Base | 8453 | ETH |
| Polygon | 137 | MATIC |
| Arbitrum | 42161 | ETH |

---

## 16. Glossary

| Term | Definition |
|------|-----------|
| ABI | Application Binary Interface — defines contract functions |
| Copy-mint | Automatically mimicking a whale's mint action |
| Floor price | Lowest listed price for an NFT in a collection |
| Gas | Fee paid to the network to execute a transaction |
| Honeypot | Scam contract that lets you buy but not sell |
| Rug pull | Project where creators abandon and take funds |
| Seadrop | OpenSea's on-chain mint protocol |
| Whale | Large holder/active NFT trader worth following |

---

*Last updated: AutoMint v1 — edit this file to keep the AI's knowledge current.*

---

<!-- AUTO-GENERATED: Do not edit this section manually. -->
<!-- Run `node scripts/update-knowledge-base.js` to regenerate. -->
<!-- Last generated: 2026-07-07 -->

## AUTO-GENERATED: Current AI Tools (4 total)

> This section is auto-generated from `src/lib/services/ai-interpreter.service.ts`.
> Every tool listed here is available via natural language in the web chat and Telegram.

### 💳 Wallets & Balances

| Tool | Description | Required params |
|------|-------------|-----------------|
| `get_wallets` | List all of the user's wallets with addresses, chains, and balances. | — |
| `get_wallet_balance` | Check the ETH balance of the user's wallet on a specific chain. | — |

### ⚙️ Settings

| Tool | Description | Required params |
|------|-------------|-----------------|
| `get_execution_settings` | Get the user's current execution settings: gas strategy, risk analysis toggle, safe mode, price limits. | — |
| `get_notification_settings` | Get user's notification settings for email and Telegram alerts. | — |

## AUTO-GENERATED: API Routes (53 endpoints)

> All routes require authentication. Dynamic segments shown as [param].

| Route | Methods |
|-------|---------|
| `/api/activities` | GET |
| `/api/ai/chat` | POST |
| `/api/ai/knowledge` | GET, POST |
| `/api/ai/status` | GET |
| `/api/analytics` | GET |
| `/api/analyzer` | POST |
| `/api/analyzer/history` | GET |
| `/api/analyzer/stream` | POST |
| `/api/blockchain/balance` | GET |
| `/api/blockchain/collection` | GET |
| `/api/blockchain/gas` | GET |
| `/api/blockchain/mint-status` | GET |
| `/api/collections` | GET, POST, DELETE |
| `/api/collections/[id]/refresh-floor` | POST |
| `/api/copy-mint/rules` | GET, POST |
| `/api/copy-mint/rules/[id]` | PATCH, DELETE |
| `/api/discovery` | POST |
| `/api/events/stream` | GET |
| `/api/health` | GET |
| `/api/history` | GET, PATCH |
| `/api/mints` | GET, POST, PATCH, DELETE |
| `/api/mints/[id]/logs` | GET |
| `/api/mints/fanout` | POST |
| `/api/monitoring/events` | GET |
| `/api/monitoring/websites` | GET, POST |
| `/api/monitoring/websites/[id]` | DELETE |
| `/api/onboarding/complete` | GET, POST |
| `/api/recovery/mint` | GET, POST |
| `/api/search` | GET |
| `/api/settings/ai-keys` | GET, POST |
| `/api/settings/email-notifications` | GET, PATCH |
| `/api/settings/integrations` | GET, POST |
| `/api/settings/profile` | DELETE |
| `/api/settings/reset-data` | DELETE |
| `/api/settings/usage` | GET |
| `/api/system/alchemy-webhook` | GET, POST, DELETE |
| `/api/system/apply-analyzer-migration` | GET, POST |
| `/api/system/apply-collections-migration` | GET, POST |
| `/api/system/email-preview` | GET |
| `/api/system/keepalive` | GET, POST |
| `/api/system/status` | GET |
| `/api/telegram/link-token` | GET |
| `/api/telegram/webhook` | GET, POST |
| `/api/user/reset-data` | POST |
| `/api/wallets` | GET, POST, DELETE |
| `/api/wallets/[id]` | PATCH, DELETE |
| `/api/wallets/[id]/default` | PATCH |
| `/api/watched-wallets` | GET, POST |
| `/api/watched-wallets/[id]` | PATCH, DELETE |
| `/api/webhooks/alchemy/contract` | POST |
| `/api/webhooks/alchemy/wallet` | POST |
| `/api/webhooks/qstash` | POST |
| `/api/whale-tracker/activity` | GET |

## AUTO-GENERATED: Backend Services (46 services)

> These services power the platform. Each maps to one or more AI tools.

- `account-deletion.service.ts`
- `ai-interpreter.service.ts`
- `alchemy-webhook.service.ts`
- `analytics.service.ts`
- `analyzer.service.ts`
- `analyzer-cache.service.ts`
- `analyzer-data.service.ts`
- `analyzer-market-intelligence.service.ts`
- `analyzer-resolver.service.ts`
- `collection.service.ts`
- `copy-mint.service.ts`
- `discovery.service.ts`
- `email-notification.service.ts`
- `event-bus.service.ts`
- `execution-settings.service.ts`
- `goplus-security.service.ts`
- `honeypot.service.ts`
- `integration-settings.service.ts`
- `knowledge-base.service.ts`
- `mint.service.ts`
- `mint-abi-discovery.service.ts`
- `mint-calldata.service.ts`
- `mint-discovery.service.ts`
- `mint-fanout.service.ts`
- `mint-lock.service.ts`
- `mint-monitor.service.ts`
- `mint-orchestrator.service.ts`
- `mint-recovery.service.ts`
- `mint-requirements.service.ts`
- `mint-state.service.ts`
- `moralis.service.ts`
- `native-price.service.ts`
- `nonce-allocator.service.ts`
- `private-mempool.service.ts`
- `provider-health.service.ts`
- `qstash.service.ts`
- `risk.service.ts`
- `rpc-manager.service.ts`
- `rpc-provider-settings.service.ts`
- `scheduled-risk-check.service.ts`
- `seadrop.service.ts`
- `system-status.service.ts`
- `task-log.service.ts`
- `telegram.service.ts`
- `wallet.service.ts`
- `wallet-tracker.service.ts`

<!-- END AUTO-GENERATED -->
