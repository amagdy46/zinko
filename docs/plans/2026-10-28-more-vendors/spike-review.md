# Spike gate review (Sol, 2026-10-29)

Reviewed `72063f4..a9ea480` (Tasks 0 and 1). Verdict: **proceed after fixes**.

1. High: domain-wide interception (`vendors.json`) blocks legitimate dependencies on `linkedin.com`, `reddit.com`, `bing.com` (Maps), `pinimg.com` (images), and the documents of those sites themselves. Restrict interception to the observed tracking, config and sync hosts and paths; handle audited first-party origins; probe representative documents, embeds and assets on both engines.
2. High: no post-Task-0 regression run. Rerun `baseline/capture.sh` (55 fixtures, both pages, all scenarios, Scrapling) and diff every status, consent outcome and capture failure; add a Playwright baseline before and after; reset `drift` and `flaky-meta` the same way; include the dependency probes; explain every difference.
3. Medium: Pinterest's checkout sample is `/v3/` under a stub config; the path seen under real local blocking is `/user/`. Keep the observed `/user/` checkout sample (and a missing-ID variant), label stub-config samples, keep page view unverified and out of Task 2's expectations, and decide how two endpoints become one event in a stateless decoder.
4. Medium: Microsoft denied: top-level `msclkid` is omitted, but the `p` page URL still carries it. State exactly what was omitted and that no `_uet*` cookie was seen in a fresh denied context; keep that observation apart from the `asc=D` exemption; PII and URL checks stay active.
5. Medium: Reddit: `esurl` keeps the origin, so `location-mismatch` applies. Project `esurl` to `page_location`, include Reddit in host-match expectations, keep general PII evaluation.

Satisfactory: host lists and SDK patterns identical in both files (Pinterest `ct/lib/*.js` is a directory wildcard: document it); endpoint-copy guard passes (it does not check the vendor mirror); 14 samples parse, no real-person data; preserve exact snippets, SDK versions or hashes and commands as evidence. `TEST_CLICK_IDS`, per-vendor dedup ids, Task 6a and the versioned boundary are consistent with r1 and r2.

## Round 2 (Sol, 2026-10-29)

Verdict: **proceed after fixes**; Task 2 waits for 1 and 2.

1. Medium: `apps/browser/scrapling/capture.py` ~344–356 decodes only gzip; brotli or deflate SDK responses reach Chromium compressed (probe: `route.fulfill` does not decode them), and truncated gzip raises `EOFError`/`zlib.error`, not caught by `except OSError`, leaving the request unresolved. Normalise SDK encodings once (preferably in the Node SDK proxy), abort cleanly on decode failure, probe identity, gzip, brotli, deflate and truncated gzip on both engines.
2. Medium: Pinterest: ignoring `/v3/` loses inspection data (`ad.loc`, `pd.epik`) that PII, location and click-ID checks read. Separate event counting from request inspection (inspect `/v3/` without counting it twice), or limit the supported coverage and Task 2 expectations; real-config behaviour stays unverified.
3. Low: keep the two original flaky Playwright outputs beside the reruns and describe the result as "two initial differences; targeted reruns matched".

Satisfactory: mirrors identical, no observed tracking host missing, whole-host SDK hosts justified; gzip decoded once per path, framing headers stripped, first-party resources bypass the SDK path; Microsoft and Reddit corrections. The regression supports unchanged rule statuses, not byte-identical captures.
