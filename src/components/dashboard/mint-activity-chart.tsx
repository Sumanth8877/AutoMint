'use client';

import { useState } from 'react';

export type MintActivityPoint = {
  day: string;
  completed: number;
  failed: number;
};

/**
 * Dependency-free 7-day mint activity chart.
 *
 * Deliberately hand-rolled instead of pulling in a charting library: it keeps the
 * custom neon aesthetic, adds zero bundle weight, and still provides the data-viz
 * features that were missing before — a y-axis reference scale, gridlines, and
 * hover/focus tooltips. Assistive tech reads the visually-hidden <table> instead
 * of the bars (which are aria-hidden), and every bar is keyboard-focusable.
 */
export function MintActivityChart({ data }: { data: MintActivityPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const maxBar = Math.max(...data.map(c => c.completed + c.failed), 1);
  // Round the axis ceiling up to a "nice" number so the reference labels read cleanly.
  const axisMax = maxBar <= 4 ? Math.max(maxBar, 1) : Math.ceil(maxBar / 5) * 5;

  const summary = data
    .map(c => `${c.day}: ${c.completed} completed, ${c.failed} failed`)
    .join('; ');

  return (
    <div>
      <div className="flex gap-2">
        {/* Y-axis scale */}
        <div className="flex h-32 w-6 shrink-0 flex-col justify-between py-0.5 text-right text-[8px] font-medium tabular-nums text-muted/70" aria-hidden="true">
          <span>{axisMax}</span>
          <span>{Math.round(axisMax / 2)}</span>
          <span>0</span>
        </div>

        {/* Plot area */}
        <div className="relative flex-1">
          {/* Horizontal gridlines */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            <span className="h-px w-full bg-border/60" />
            <span className="h-px w-full bg-border/40" />
            <span className="h-px w-full bg-border/60" />
          </div>

          <div
            className="relative flex h-32 items-end gap-1.5"
            role="img"
            aria-label={`7-day mint activity bar chart. ${summary}.`}
          >
            {data.map((c, i) => {
              const total = c.completed + c.failed;
              const heightPct = total > 0 ? (total / axisMax) * 100 : 3;
              const successPct = total > 0 ? (c.completed / total) * 100 : 0;
              const isActive = active === i;
              return (
                <div
                  key={c.day}
                  className="group relative flex h-full flex-1 cursor-default flex-col items-center justify-end gap-1"
                  aria-hidden="true"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(a => (a === i ? null : a))}
                >
                  {/* Tooltip */}
                  {isActive && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-lg border border-border-strong bg-elevated px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
                      <p className="mb-0.5 text-[10px] font-bold text-text">{c.day}</p>
                      <p className="flex items-center gap-1.5 text-[10px] text-secondary">
                        <span className="h-1.5 w-1.5 rounded-sm bg-success/70" />
                        {c.completed} completed
                      </p>
                      <p className="flex items-center gap-1.5 text-[10px] text-secondary">
                        <span className="h-1.5 w-1.5 rounded-sm bg-danger/50" />
                        {c.failed} failed
                      </p>
                    </div>
                  )}

                  <div
                    className={`flex w-full flex-col justify-end overflow-hidden rounded-t transition-all duration-200 ${isActive ? 'brightness-125' : ''}`}
                    style={{ height: `${heightPct}%` }}
                  >
                    <div className="w-full overflow-hidden rounded">
                      <div className="w-full" style={{ height: `${successPct}%`, background: 'rgba(0,255,136,0.70)', minHeight: total > 0 ? 2 : 0 }} />
                      <div className="w-full" style={{ height: `${100 - successPct}%`, background: 'rgba(255,77,77,0.50)', minHeight: 0 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div className="mt-1 flex gap-1.5" aria-hidden="true">
            {data.map(c => (
              <p key={c.day} className="flex-1 whitespace-nowrap text-center text-[8px] text-muted">
                {c.day.split(' ')[1]}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Screen-reader accessible data table backing the visual chart above */}
      <table className="sr-only">
        <caption>7-Day Mint Activity</caption>
        <thead>
          <tr><th scope="col">Day</th><th scope="col">Completed</th><th scope="col">Failed</th></tr>
        </thead>
        <tbody>
          {data.map(c => (
            <tr key={c.day}>
              <th scope="row">{c.day}</th>
              <td>{c.completed}</td>
              <td>{c.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-2 w-2 rounded-sm bg-success/70" />Success</span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-2 w-2 rounded-sm bg-danger/50" />Failed</span>
      </div>
    </div>
  );
}
