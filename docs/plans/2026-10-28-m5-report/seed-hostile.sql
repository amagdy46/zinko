-- HOSTILE TEST DATA, not a real capture. Rewrites one real fixture audit so that every field a
-- report must not print holds a canary (a string containing CANARY, an email or a phone number).
-- Usage: psql <url> -v audit=<audit id> -f seed-hostile.sql      (the audit must have finished runs)
-- Re-running is safe. Use a scratch audit: it overwrites the audit's pages, its runs' page URLs and
-- failure text, every check result message, and adds hits to its first captured run.
-- Not seedable from SQL: cookie names (they live in the stored capture.json, not in the database).
--
-- Expected under Standard (Task 4 onward): `grep -ci` for CANARY, canary%40, 7911 and 4155550100 is 0
-- on the draft JSON, the snapshot, the public HTML, the PDF text and the CSV. Under Detailed only the
-- entered paths without query or fragment, and Meta and TikTok IDs that match their vendor formats,
-- may appear (see "Disclosure projection" in plan.md).
\set ON_ERROR_STOP on
begin;

-- Pages: the start page stays; four hostile ones follow (a name, a reset token, a journey step with a
-- query holding a token and an email, an encoded email in the path).
update audit set config = jsonb_set(config, '{pages}', jsonb_build_array(
    config->'pages'->0,
    'http://localhost:4400/customers/CANARY-Alice-Smith',
    'http://localhost:4400/reset-password/CANARY0a1b2c3d4e5f6a7b8',
    'http://localhost:4400/step?token=CANARYSECRET&email=canary%40example.com',
    'http://localhost:4400/u/canary%40example.com'))
  where id = :'audit'::uuid;

-- Spread the runs over those pages (ordinal 0 keeps the start page).
update run set page_url = (select (a.config->'pages'->>(run.ordinal % 5)) from audit a where a.id = run.audit_id)
  where audit_id = :'audit'::uuid;

-- Messages and reasons the rules wrote: they repeat page content, so none may be printed.
update check_result set message = 'canary@example.com +44 7911 123456 http://localhost:4400/p?token=CANARYSECRET&sid=CANARYSID reason'
  where run_id in (select id from run where audit_id = :'audit'::uuid);

-- Capture failure and error text built from a page URL.
update run set failure = 'synthetic: http://localhost:4400/x?sid=CANARYSID failed',
               errors = jsonb_build_array(jsonb_build_object('code', 'Navigation',
                 'message', 'http://localhost:4400/x?sid=CANARYSID: net::ERR_CONNECTION_REFUSED'))
  where id = (select id from run where audit_id = :'audit'::uuid order by (status = 'complete'), ordinal limit 1);

-- Extra hits on the first captured run: a Meta destination shaped like a phone number, a TikTok one
-- with a canary, and a custom event name carrying an email.
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id,
                 event, params, ids, consent, host, url, blocked, status, after_consent_action)
select r.org_id, coalesce(r.finished_at, now()), r.id, v.request_id, 0, 'canary-doc', 100 + v.n,
       v.vendor, v.destination, v.event,
       jsonb_build_object('em', 'canary@example.com', 'ph', '+44 7911 123456'),
       '{}'::jsonb, '{"adStorage":"granted","analyticsStorage":"granted"}'::jsonb,
       'canary.example', 'https://canary.example/c?sid=CANARYSID&email=canary%40example.com', false, 200, false
from (select * from run where audit_id = :'audit'::uuid and status = 'complete' order by ordinal limit 1) r,
     (values (1, 'canary-1', 'meta', '07911123456', 'purchase_canary@example.com'),
             (2, 'canary-2', 'tiktok', 'CANARY4155550100', 'Purchase'),
             (3, 'canary-3', 'ga4', 'G-CANARY123', 'page_view')) as v(n, request_id, vendor, destination, event)
on conflict do nothing;

commit;
