# Review r1 (Sol, 2026-10-29)

Verdict: **rethink**. Retrying only failed cells is sound; reopening a settled audit is not.

1. P1: retrying an older audit A after a later audit B or a re-check C gives A observations newer than B and C while readers order by `audit.createdAt`; B's "What changed" and C's confirmations become wrong, and A disappears from `earlierAudits` while active.
2. P1: `readStamp` and `comparisonStampOf` fingerprint `finishedAt`, which in-place retry keeps; a report built before a retry passes validation afterwards with stale results.
3. P1: "never worse" fails at the capture/persist boundary: `fail` deletes derived rows, `capture` returns `Stored` for any key, and the new capture is visible beside old rows until persist commits.
4. P1: the existing re-run guard keys on `baseline_audit_id`, so it does not exclude a retry of A; `reopenForRetry` does not check for a running re-run or re-check.
5. P2: no reconciliation for a crash between reopen and workflow launch, or for a workflow that fails terminally: the audit stays active and holds a cap slot.
6. P2: progress cannot be derived (selected runs keep settled statuses).
7. P2: Alternative B (a new full audit that copies reusable captures and captures only failed cells) was rejected on a wrong reproducibility argument: derived rows can be rebuilt from a copied capture with stable timestamps.

Recommended answers: seeded new full audit; BotBlocked excluded in v1; re-evaluate all captures under current rules with provenance disclosed; report discloses the capture date range and reused captures (model version bump, legacy rendering; CSV the same); cap reasonable; single-run retry deferred; any member may retry; `<uuid>-r1` ids valid on Cloudflare but deployed behaviour needs a cloud probe.
