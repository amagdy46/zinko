# Review r9 (Sol, 2026-10-31)

Verdict: **ready after fixes**. Task 3a remains ready to implement independently.

1. P2 (Decision 8, witness filter): the injected-page rule restricts candidates to the configured start URL plus the test IDs, but main's `cellKeyOf` (`apps/web/src/lib/compare.ts:93`) resolves an injected run to its configured page when `clickIdPages` is present. Case: pages `/` and `/checkout?market=uk`, checkout in `clickIdPages`; A fails checkout, B passes, C reuses A, D passes: the SQL excludes B, so D against C wrongly reports Fixed. Fix: branch on the candidate audit's stored config; with `clickIdPages` present match the resolved configured page plus the test IDs; legacy configs keep start-page semantics. Extend probe 12 with checkout as a non-start key page.
