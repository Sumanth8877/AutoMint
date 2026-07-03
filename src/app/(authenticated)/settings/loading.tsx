/**
 * Instant loading skeleton for /settings/* routes.
 * Next.js renders this immediately on navigation while server components
 * (auth, syncUser, page) finish — kills the perceived "click then wait" lag.
 */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-hover" />
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-surface-hover" />
      </div>

      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-surface-hover p-5"
          >
            <div className="h-5 w-48 animate-pulse rounded bg-surface-hover" />
            <div className="mt-3 space-y-2">
              <div className="h-4 w-full max-w-md animate-pulse rounded bg-surface-hover" />
              <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-surface-hover" />
            </div>
            <div className="mt-5 h-10 w-full animate-pulse rounded-lg bg-surface-hover" />
          </div>
        ))}
      </div>
    </div>
  );
}
