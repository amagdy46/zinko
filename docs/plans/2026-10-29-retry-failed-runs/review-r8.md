# Review r8 (Sol, 2026-10-31)

Verdict: **ready after fixes**. Reviewed cad454f..52cdc47.

1. P2 (Decision 8, witness filter): splitting injected pages at `?` does not preserve cell identity. `normalizePages` keeps configured query parameters and `cellKeyOf` uses the configured start URL for injected runs. For `/checkout?market=uk` the proposed prefix is `/checkout`; comparing it with the cell page excludes a valid witness (A fails, B passes, C reuses A, D passes → D vs C wrongly Fixed). Stripping both sides lets different query pages consume the budget. Fix: derive the SQL candidate page with the same configured-page semantics as `cellKeyOf`, keeping configured query parameters; add probes for a valid injected witness on a query-bearing page and overflow from a different query page.

Round-7 issues otherwise resolved at design level: heartbeat (independently committed, fenced, before attempt work); witness budget/stamp (shared candidate filtering, subject to the fix above; admitted rows with different itineraries are fingerprinted); fallback deletion (detach and cleanup intent committed before deleting objects).

**Task 3a is ready to implement now, independently.**

Optional polish: update Task 4 probes 5 and 10 (still describe deletion before the row update); remove the duplicated fence paragraph.
