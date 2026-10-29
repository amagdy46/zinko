# Baseline before any production change

Taken on 2026-10-29 from this branch at `72063f4` (rules v11, decoders v4), before any change to
`vendors.json`, the capture contract or the decoders. Scrapling engine (`engine: scrapling`) for every
file, fixtures server from this worktree.

One file per fixture and page: `<site>__home.txt` (`/<site>/`) and `<site>__thank-you.txt`
(`/<site>/thank-you`). Each line is `<scenario>`, a tab, a status or `engine`/`page`/`consent`, a tab,
the rule id or value. Status lines only: no hit values, messages or evidence.

Reproduce one site against a running engine and fixtures server:

```sh
docs/plans/2026-10-28-more-vendors/baseline/capture.sh <out-dir> http://localhost:<engine> http://localhost:<fixtures> <site>...
diff -r <out-dir> docs/plans/2026-10-28-more-vendors/baseline
```

An engine takes one capture at a time (the script retries on 429), so run one engine per parallel
worker. `drift` and `flaky-meta` are in their initial state (no release POST).
