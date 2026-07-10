"use client";

import dynamic from "next/dynamic";

// Audit fix: lazy-load the chart component to reduce initial bundle size.
// The chart (125 lines with SVG rendering) is only needed on the dashboard
// and can be code-split without affecting first paint.
const MintActivityChart = dynamic(
  () => import("@/components/dashboard/mint-activity-chart").then((m) => m.MintActivityChart),
  {
    loading: () => (
      <div className="flex h-48 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    ),
    ssr: true,
  },
);

export default MintActivityChart;
