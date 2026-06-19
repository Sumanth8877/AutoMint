# AutoMint Frontend Audit

## Scope

Reviewed the application frontend across `src/app`, `src/components`, `src/lib`, and `src/app/globals.css` against the full redesign brief.

## Findings

1. Layout architecture
   The previous experience read as a developer prototype: weak hierarchy, uneven whitespace, and disconnected page composition. The current redesign introduces a persistent authenticated app shell, a constrained 1280px content area, a dedicated 1440px public header shell, and dense dashboard grids.

2. Design consistency
   The visual system now uses shared Tailwind v4 theme tokens for background, surfaces, elevation, borders, status colors, text, and muted copy. Remaining legacy utility colors should continue to be replaced with tokens as files are touched.

3. Component duplication
   Shared primitives now exist for `Card`, `Button`, `Input`, `Badge`, `MetricCard`, `PageHeader`, `Panel`, `Skeleton`, and empty states. Future work should avoid route-local card/button variants unless a route has a distinct interaction need.

4. UX decisions
   The homepage now prioritizes the core product promise and direct analysis. The dashboard is organized around operational tasks: portfolio, execution, wallet health, risk, watchlist, recent activity, and system status. Analyzer is the flagship workflow and should remain API-backed rather than static.

5. Responsive behavior
   The authenticated shell includes a desktop sidebar and mobile drawer. Page grids use responsive tracks and stable card sizing. Tables and dense rows should continue to be checked on small screens because mint/wallet identifiers can be long.

6. Accessibility
   Global focus-visible styles are present, icon-only controls use labels, and navigation has landmarks. Form labels and error states should be kept explicit as workflows become more interactive.

7. Performance
   Server Components are used by default, with Client Components only where interactivity is required. Route-level loading UI and a small transition wrapper keep navigation feedback lightweight. Avoid moving data-heavy services into client bundles.

8. Technical debt
   Several backend/service files had permissive `any` casts and unused placeholders. These have been tightened so lint can act as a quality gate again.

## Recommended Follow-Ups

- Replace mock dashboard datasets with authenticated API reads.
- Add real empty states to every data-backed page as those pages move off fixtures.
- Add integration tests around Analyzer URL resolution and collection metadata failures.
- Add visual regression screenshots for dashboard, analyzer, and mobile navigation.
