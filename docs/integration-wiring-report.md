# Frontend/Backend Wiring Report

## Verification Summary

- TypeScript: `npm.cmd run typecheck` passed.
- ESLint: `npm.cmd run lint` passed.
- Production build: `npm.cmd run build` passed after approving network access for `next/font` to fetch Geist assets.
- Browser smoke test: attempted after starting `npm.cmd run dev`, but the in-app browser and then shell commands failed with `windows sandbox failed: spawn setup refresh`. No browser-visible failure was observed; the environment blocked the verification tool before it could inspect the page.

## Fixed Issues

1. Mint task Start was stale wiring.
   - Before: UI button -> `/api/mints PATCH { action: "start" }` -> only changed status to `running`.
   - After: UI button -> route -> `executeMintTask()` -> blockchain simulation/execution service -> DB status update -> response includes updated task and execution result -> UI updates row and shows execution failure text when needed.

2. Mint cancel route had no UI.
   - Added a Cancel icon action in the Mints table.
   - Route path: UI -> `/api/mints PATCH { action: "cancel" }` -> `updateMintTaskStatus(..., "cancelled")` -> DB -> updated row in UI.

3. Mint retry/status claiming was too narrow.
   - `executeMintTask()` can now claim authenticated user-owned tasks in `pending`, `monitoring`, `ready`, `failed`, or `cancelled`.
   - It rejects already-running/completed tasks.

4. Analyzer request/error handling was inconsistent.
   - Analyzer client now uses shared `apiRequest`.
   - Analyzer API now uses `parseJsonBody`, returning a consistent `{ error }` payload for invalid JSON.

5. Homepage analyzer intake was disconnected.
   - The homepage input now passes `?input=` into `/analyzer`.
   - Analyzer is now split into a server `page.tsx` that awaits async `searchParams` per Next 16 and a client component that receives `initialInput`.

6. Clipboard actions lacked error states.
   - Homepage Paste/Stage Analysis and authenticated Analyzer Paste now catch clipboard failures and render inline errors.

7. Notification/search direct fetches had duplicated response parsing.
   - App shell search and notifications now use `apiRequest` for consistent non-2xx handling.

8. Create flows were missing activity updates or stale returned rows.
   - `addMintTask()` logs `task_created`.
   - `executeMintTask()` logs task start.
   - `addCollection()` logs `collection_added`.
   - Collection POST now returns the metadata-synced row when sync succeeds.

9. Duplicate detection ignored chain.
   - Wallet duplicate checks are now per user + address + chain.
   - Collection duplicate checks are now per user + contract + chain.

10. Unused reload helpers caused lint warnings.
   - Removed unused `loadWallets`, `loadCollections`, and `loadData` functions.

## Wiring Matrix

| Surface | UI | Event | Handler | API | Route | Service | Database | Response | UI Update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public homepage Paste | Paste button | click | `pasteUrl` | Clipboard API | n/a | n/a | n/a | clipboard text or browser error | fills input or shows inline error |
| Public homepage Stage Analysis | Stage Analysis button | click | `copyUrl` | Clipboard API | n/a | n/a | n/a | success/error | copied state or inline error |
| Public homepage Analyze | Analyze link/form submit | click/Enter | `submitAnalysis` or Link | n/a | `/analyzer?input=...` page | n/a | n/a | route render | Analyzer input prefilled |
| Analyzer Analyze | Analyze buttons/form | click/submit | `analyze` | `POST /api/analyzer` | `src/app/api/analyzer/route.ts` | resolve intent, metadata, mint state, requirements, ABI discovery | blockchain reads only | analyzer result or `{ error }` | cards/scores/logs render or error shown |
| Analyzer Paste | Paste button | click | `pasteUrl` | Clipboard API | n/a | n/a | n/a | clipboard text or browser error | fills input or shows inline error |
| Global search | Search input | change/Enter | debounced effect / `navigateToSearchResult` | `GET /api/search?q=` | `src/app/api/search/route.ts` | direct Drizzle query | wallets, collections, mint_tasks | `{ results }` | dropdown results, errors, navigation |
| Notifications | Bell button | click | `openNotifications` | `GET /api/activities` | `src/app/api/activities/route.ts` | direct Drizzle query | activities | `{ activities }` | popover list/loading/error |
| Wallet list | Wallets page mount | effect | initial loader | `GET /api/wallets` | `src/app/api/wallets/route.ts` | `getUserWallets` | wallets | `{ wallets }` | cards/empty state |
| Add Wallet | Add Wallet modal form | submit | `submitWallet` | `POST /api/wallets` | `src/app/api/wallets/route.ts` | `createWallet` | wallets, wallet_permissions, activities | `{ wallet }` | appends row, resets form, closes modal |
| Refresh Wallet Balance | Refresh icon | click | `refreshBalance` | `GET /api/blockchain/balance` | `src/app/api/blockchain/balance/route.ts` | `getWalletBalance` | blockchain read only | `{ balance }` | balance map updates or error |
| Copy Wallet | Copy icon | click | `copyAddress` | Clipboard API | n/a | n/a | n/a | success/error | clipboard write or page error |
| Open Wallet Explorer | External link icon | click | `openExplorer` | browser navigation | external explorer | n/a | n/a | new tab | opens explorer or error for unsupported chain |
| Delete Wallet | Trash icon | click | `deleteWallet` | `DELETE /api/wallets` | `src/app/api/wallets/route.ts` | `removeWallet` | wallets, activities | `{ success: true }` | removes wallet and cached balance |
| Collection list | Collections page mount | effect | initial loader | `GET /api/collections` | `src/app/api/collections/route.ts` | `getUserCollections` | collections | `{ collections }` | cards/empty state |
| Add Collection | Add Collection modal form | submit | `submitCollection` | `POST /api/collections` | `src/app/api/collections/route.ts` | `addCollection` | collections, activities | `{ collection }` | appends synced row, resets form, closes modal |
| Delete Collection | Trash icon | click | `deleteCollection` | `DELETE /api/collections` | `src/app/api/collections/route.ts` | `removeCollection` | collections | `{ success: true }` | removes card |
| Mint list | Mints page mount | effect | initial loader | `GET /api/mints`, `/api/wallets`, `/api/collections` | route handlers | `getUserMintTasks`, `getUserWallets`, `getUserCollections` | mint_tasks, wallets, collections | `{ tasks }`, `{ wallets }`, `{ collections }` | table/dropdowns render |
| Create Mint | New Mint modal form | submit | `submitMint` | `POST /api/mints` | `src/app/api/mints/route.ts` | `addMintTask` | mint_tasks, activities | `{ task }` | prepends task, resets form, closes modal |
| Start/Retry Mint | Play icon | click | `startTask` | `PATCH /api/mints` | `src/app/api/mints/route.ts` | `executeMintTask`, `getMintTaskById` | mint_tasks, mint_history, activities | `{ task, result }` | row updates; execution error shown if result failed |
| Cancel Mint | XCircle icon | click | `cancelTask` | `PATCH /api/mints` | `src/app/api/mints/route.ts` | `updateMintTaskStatus` | mint_tasks, activities | `{ task }` | row updates to cancelled |
| Delete Mint | Trash icon | click | `deleteTask` | `DELETE /api/mints` | `src/app/api/mints/route.ts` | `removeMintTask` | mint_tasks | `{ success: true }` | removes row |
| Queue Settings | Queue Settings button | click | `setQueueOpen(true)` | none | none | none | none | n/a | informational modal opens/closes |
| Settings items | Settings row buttons | click | `setActiveSetting` | none | none | none | none | n/a | informational modal opens/closes |
| Mobile nav | Menu/close/nav links | click | local state / Link | none | Next navigation | n/a | n/a | route render | drawer opens/closes |

## Remaining Notes

- Dashboard, Analytics, and History are mostly static dashboards today. They render links/modals but are not yet API-backed operational views.
- Queue Settings and Settings modals intentionally do not mutate because no persistence endpoints exist yet; they now behave as explicit informational modals rather than silent fake actions.
- Monitoring API routes exist, but no current frontend page consumes them in this codebase.
