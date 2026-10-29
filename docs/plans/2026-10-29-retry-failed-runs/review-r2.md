# Review r2 (Sol, 2026-10-29)

Verdict: **ready after fixes**. A new full audit that reuses captures is the right foundation. Round-1 findings are mostly resolved (the original stays immutable; stamps, derived rows, progress, guards and admission are fine; carry-over is correct with the original as baseline), but launch-gap and terminal-workflow recovery are not moot.

1. P1: capture identity alone does not fix chronology. A fails, B later passes, retry C reuses A's failing capture: `compareAudits` reports C against B as Regressed (probe confirmed). Expose capture time with `captureId`; an observation older than the baseline's must not imply a new failure, fix or regression; deduplicate before history windows; extend `comparisonStampOf` to the same inputs; handle re-checks made between the original capture and the retry.
2. P1: root provenance is not the copy source. Resolve the immediate source through `retry_of_audit_id` plus `CellKey` and copy its owned keys; the root id is capture identity only and need not exist.
3. P1: the copy step needs a crash-safe protocol: snapshot source metadata durably, write screenshot then capture, recover a complete destination before requiring the source, delete partial destinations before falling back (normal `capture()` trusts an existing key), preserve the original timestamp, settle exhausted step errors; crash probes at each boundary.
4. P1: `MIN_REUSABLE_ENGINE` compares third-party engine strings. Use a Zinko-owned capture format/capability version (or check required facts after decoding); `run.engine` can be null for `PersistFailure`.
5. P1: bumping `REPORT_MODEL_VERSION` to 7 drops 6 from the accepted versions; keep 6 explicitly. `LEAF_VALIDATORS` live in `report-projection.ts`; update the sample model explicitly.
6. P2: same capture does not mean Unchanged across contexts (re-decoding, sibling-derived banner detection, changed measured hosts, `tagSideOf`/`diffTags`). Keep compatibility checks; separate reinterpretation from a site change.
7. P2: persistence-only recovery must be eligible (zero-browser retry); exclude failed or unevaluated origins in v1 or design their baseline.
8. P2: capture range from runs that own captures only (`fail-<n>` sets `finished_at` without one); UTC days; durable wording; CSV values on ordinary and fixed rows via `csvFile`/`csvCell`.

Answers: duplicate objects yes (measure capture and screenshot); capability version, not library versions; refusals keep the ordinary path in v1; newer-audit warning stays non-blocking once 1 is fixed; BotBlocked opt-in deferred; add a deployed smoke gate (large copies, replay after interruption, deletion independence). Split Task 4 (copy recovery / workflow integration) and Task 5 (chronology / presentation); 7–9 days is optimistic.
