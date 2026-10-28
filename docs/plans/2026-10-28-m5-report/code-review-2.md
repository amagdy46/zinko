# M5 code review 2, Tasks 9–16 (GPT-6.1 Sol, high) — verdict: fix first

All five findings of review 1 are fixed. No public-route authorization, caching or token-exposure defect found. Better Auth's deletion hooks run outside its adapter transaction; no separate-connection self-deadlock. The publication-hash change after a model-version bump is a documented deviation.

1. **Should fix — publication can miss concurrent edits.** `report-data.ts:267`: `max(updatedAt)` plus a row count misses an earlier-timestamped update that commits after a newer update to another row, so a snapshot can freeze stale notes, exclusions or triage with matching stamps. Fix: fingerprint the relevant rows' values, or a serialized revision counter.
2. **Should fix — concurrent organization deletions can erase cleanup work.** `report-publish-data.ts:191`: two requests pass authorization; the second collector clears the first's outbox entries after the source rows cascaded, orphaning logos. Fix: idempotent inserts, never clear the outbox there.
3. **Should fix — "Never" creates a 30-day link.** `share-dialog.tsx:92`: `?.days ?? 30` replaces the valid `null`. Fix: tell a missing option from a null `days`.
4. **Should fix — CSV escaping misses full-width prefixes.** `csv.ts:2`: `＝`, `＋`, `－`, `＠` pass through (OWASP CSV injection). Fix: extend the set and verify the import.
5. **Should fix — CSV counts labels, not pages.** `register-data.ts:146`: Detailed `/product?id=1` and `?id=2` collapse to one label; journey labels inflate counts. Fix: count distinct affected URLs, independently of display labels.
