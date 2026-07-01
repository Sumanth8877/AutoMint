# AutoMint — Fixes & Improvements Log

> Generated: 2026-07-01
> Agent: My First Agent (Gumloop)
> Repo: Sumanth8877/AutoMint

---

## 🔴 Critical Bug Fixes

### Bug #1 — Telegram: Plain URL paste silently ignored
- **File:** `src/lib/services/telegram.service.ts`
- **Problem:** When a user pasted a raw mint URL (no `/mint` prefix), `handleTelegramUpdate()` returned `{ handled: false }` with zero reply. The bot ghosted the user.
- **Fix:** Added URL detection branch — plain URLs starting with `http://` or `https://` are routed to `handleMintCommand()`. Non-URL text gets a helpful reply listing available commands.

### Bug #4 — Jina URL double-protocol
- **File:** `src/app/api/instant-mint/route.ts`
- **Problem:** `` `https://r.jina.ai/http://${url}` `` produced `https://r.jina.ai/http://https://...` for any HTTPS URL. The entire Jina fallback resolver was broken.
- **Fix:** Changed to `` `https://r.jina.ai/${url}` `` — Jina accepts the full URL directly.
- **Note:** Jina has since been removed from the codebase entirely (see below). This fix was the stepping stone.

### Bug #7 — ENDED mints create orphan pending tasks
- **File:** `src/app/api/mints/route.ts`
- **Problem:** When `mintState.status === 'ENDED'`, the POST handler fell through both `if` checks and returned `201 OK` with a `pending` task that had no QStash schedule and would never execute.
- **Fix:** Added explicit ENDED check before the LIVE/scheduling branches. Orphan task is cleaned up via `removeMintTask()`, and the API returns `422` with a clear error message.

---

## 🚀 New Feature: Tiered Mint Requirement Discovery

### `src/lib/services/mint-discovery.service.ts` (NEW)
Single unified discovery engine used by all 3 flows (Telegram, home page, mints page).

**Discovery chain:**
```
Tier 1  resolveMintIntent + fetchMintRequirements + getMintState  (always runs)
   ↓ any of: contractAddress, mintPrice, mintFunction, mintStartTime missing?
Tier 2  Firecrawl  (single scraper, 5s timeout)
   ↓ still missing contract address?
   throw error
```

**Extracts from page content:**
- contractAddress, chain, mintFunction, mintPrice
- maxPerWallet, maxPerTx
- mintStartTime, mintEndTime, mintPhases
- collectionName, totalSupply

**Wired into:**
- `mint-orchestrator.service.ts` (Telegram + mints page flow)
- `instant-mint/route.ts` (home page flow)
- `api/mints/route.ts` (mints page create task)

**Timeout safety:** Hard-capped at 7s (Vercel Hobby plan 10s limit). Returns whatever was found if timeout fires.

---

## 🟠 UX Improvements

### Wallet Success Feedback (U1)
- **File:** `src/app/(authenticated)/wallets/wallets-client.tsx`
- Added success toast messages on wallet add/edit/delete/set-default
- Auto-dismisses after 4 seconds
- Green success banner renders above the error banner

### Telegram Notification Filter (U2)
- **File:** `src/lib/services/telegram.service.ts`
- Only mint lifecycle notifications are sent: `mint_created`, `mint_started`/`mint_executing`, `mint_success`, `mint_failed`
- Filtered out: `risk_analysis_complete`, `high_risk_collection`, `wallet_balance_low`, `wallet_minted_nft`, `wallet_purchased_nft`, `copy_mint_triggered`
- Added `mint_created` and `mint_executing` notification types

### Failed Task Error Display (U3)
- **File:** `src/app/(authenticated)/mints/mints-client.tsx`
- Failed tasks now show the error reason from `riskReasons` on the task card
- Fallback message: "Execution failed — click retry to try again"

### Retry Button Styling (U4)
- **File:** `src/app/(authenticated)/mints/mints-client.tsx`
- Failed tasks show a `RotateCcw` (retry) icon instead of `Play`
- Warning color styling to distinguish retry from normal start

### Homepage Cleanup (#5, #6)
- **File:** `src/app/page.tsx`
- "Stage Analysis" button renamed to "Copy URL"
- Hardcoded mock Risk/Demand/Readiness metrics removed
- Hardcoded fake "Recent Analyses" collections removed

### Scheduled Time Display (#8)
- **File:** `src/app/(authenticated)/mints/mints-client.tsx`
- Upcoming mints now show their scheduled time on the task card
- Uses `task.scheduledTime` field from the API

### Manual Schedule Override (#9)
- **File:** `src/app/(authenticated)/mints/mints-client.tsx`
- Added optional `datetime-local` input to the Create Mint form
- User can set a custom schedule time; leave blank for auto-detection
- **Backend:** `src/app/api/mints/route.ts` accepts `scheduleTime` in POST body, prioritized over auto-detected times

---

## 🟡 Vercel Hobby Plan Fixes

### maxDuration Removed (was blocking deployment)
5 system routes had `maxDuration` values (60–120s) exceeding the Hobby plan 10s limit:

| Route | Was | Fixed |
|---|---|---|
| `system/dependency-audit/route.ts` | 60s | removed (uses 10s default) |
| `system/dependency-audit/stream/route.ts` | 120s | removed |
| `system/install-safe-updates/route.ts` | 120s | removed |
| `system/upgrade-branch/route.ts` | 120s | removed |
| `system/upgrade-report/route.ts` | 60s | removed |

### Cache Disabled for Wallet & Mint Mutations
- **Files:** `src/app/api/wallets/route.ts`, `src/app/api/mints/route.ts`
- `revalidate = 14400` (4-hour cache) removed → `force-dynamic` + `revalidate = 0`
- **Pages:** `wallets/page.tsx`, `mints/page.tsx` — same cache removal
- **Problem:** After adding/deleting a wallet or creating a mint task, the UI showed stale data until the 4-hour cache expired. A page reload was required to see changes.
- **Fix:** Mutations now invalidate the query cache immediately via `queryClient.invalidateQueries()`

### Discovery Timeout Wrapper
- **File:** `src/lib/services/mint-discovery.service.ts`
- Hard timeout of 7s (configurable via `options.maxTimeMs`)
- Inner Firecrawl timeout reduced to 5s
- Tier 2 skipped entirely if remaining budget < 1.5s

---

## 🔵 HIGH Issues Fixed

### H-1 — Missing DB Indexes
- **Files:** `src/drizzle/schema/index.ts`, `src/drizzle/migrations/0999_h1_add_hot_path_indexes.sql`
- **Problem:** `mintHistory`, `activities`, and `taskLogs` tables had no indexes on `userId`/`createdAt`. Every dashboard load, notification fetch, and task console poll triggered a full table scan.
- **Fix:** Added 7 composite indexes:

| Table | Index | Covers |
|---|---|---|
| `mint_history` | `idx_mint_history_user_id` | Dashboard 7-day chart filter |
| | `idx_mint_history_user_created_at` | History tab sort + filter |
| | `idx_mint_history_status` | Status-based queries |
| `activities` | `idx_activities_user_id` | Notification bell filter |
| | `idx_activities_user_created_at` | Notification bell sort |
| `task_logs` | `idx_task_logs_task_id` | Task console filter |
| | `idx_task_logs_task_id_created_at` | Task console sort |

- **Migration executed on Neon DB** — indexes are live and valid.

### H-2 — Task Console Hardcoded to Etherscan
- **File:** `src/components/ui/task-console.tsx`
- **Problem:** The "view on explorer" link always pointed to `etherscan.io`, returning 404 for Base, Polygon, and Arbitrum contracts.
- **Fix:** Added `EXPLORER_HOSTS` map + `explorerUrl()` helper. Chain prop determines the correct block explorer.

### H-3 — Arbitrum Missing from Wallet Explorer
- **File:** `src/app/(authenticated)/wallets/wallets-client.tsx`
- **Problem:** `Chain` type and `explorerHosts` map only had Ethereum/Base/Polygon. Arbitrum wallets showed a broken explorer link.
- **Fix:** Added `'arbitrum'` to `Chain` type, `arbiscan.io/address/` to `explorerHosts`, and "Arbitrum" to `chainOptions` dropdown.

### H-4 — Homepage Hardcoded Fake Stats
- **File:** `src/app/page.tsx`
- **Problem:** `stats[]` constant contained fake numbers (42.8K collections, 86% success rate, 2.7x ROI, 128 launchpads). `recent[]` constant contained fake collection names (Tensorian Seeds, Eclipse Foundry, Night Market Pass).
- **Fix:** Both constants and their JSX rendering removed.

---

## 🧹 Service Removals (by prior commit)

The following services were removed in a previous session (commit `5013b41`):

| Removed | Reason |
|---|---|
| **Jina AI** (`jina.provider.ts`) | Firecrawl covers all scraping needs with better structured output |
| **Browserbase** (`browserbase.provider.ts`, `lib/browserbase/client.ts`) | Free tier unusable; Firecrawl covers 95%+ of cases |
| **Dune Analytics** (`dune-analytics.service.ts`) | Moralis provides equivalent data faster via REST |
| **NFTScan** (`nftscan.service.ts`) | Moralis has broader chain support and cleaner API |

**Current stack:** Gemini AI + Firecrawl + Moralis + on-chain RPC (Viem)

---

## 📁 Files Changed (Complete List)

### New Files
| File | Purpose |
|---|---|
| `src/lib/services/mint-discovery.service.ts` | Tiered discovery engine (Firecrawl) |
| `src/drizzle/migrations/0999_h1_add_hot_path_indexes.sql` | Raw SQL migration for DB indexes |

### Modified Files
| File | Fixes |
|---|---|
| `src/lib/services/telegram.service.ts` | #1 URL paste, #2 notification filter, U2 mint_created |
| `src/app/api/instant-mint/route.ts` | #4 Jina URL, discovery wiring, syntax error |
| `src/app/api/mints/route.ts` | #7 ENDED orphan task, #9 scheduleTime override, cache disabled |
| `src/lib/services/mint-orchestrator.service.ts` | Discovery wiring, maxPerWallet/maxPerTx removed |
| `src/app/page.tsx` | #5 Copy URL, #6 mock metrics removed, H-4 fake stats |
| `src/app/(authenticated)/wallets/wallets-client.tsx` | U1 success toast, H-3 Arbitrum |
| `src/app/(authenticated)/mints/mints-client.tsx` | U3 error display, U4 retry styling, #8 scheduled time, #9 schedule override |
| `src/app/(authenticated)/mints/page.tsx` | Cache disabled |
| `src/app/(authenticated)/wallets/page.tsx` | Cache disabled |
| `src/app/api/wallets/route.ts` | Cache disabled |
| `src/components/ui/task-console.tsx` | H-2 chain-aware explorer |
| `src/drizzle/schema/index.ts` | H-1 DB indexes |
| `src/app/api/system/dependency-audit/route.ts` | Vercel maxDuration removed |
| `src/app/api/system/dependency-audit/stream/route.ts` | Vercel maxDuration removed |
| `src/app/api/system/install-safe-updates/route.ts` | Vercel maxDuration removed |
| `src/app/api/system/upgrade-branch/route.ts` | Vercel maxDuration removed |
| `src/app/api/system/upgrade-report/route.ts` | Vercel maxDuration removed |

---

## 🚀 Deployment Notes

1. **Vercel Hobby Plan** — all routes now use ≤10s timeout. Build should succeed.
2. **DB Migration** — indexes already created on Neon. No further action needed.
3. **Environment Variables** — only `FIRECRAWL_API_KEY` is needed for the discovery service. `JINA_API_KEY`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` are no longer referenced.
4. **PR #4** — branch `fix/critical-bugs-and-discovery` contains the same changes if you prefer to merge via PR.
