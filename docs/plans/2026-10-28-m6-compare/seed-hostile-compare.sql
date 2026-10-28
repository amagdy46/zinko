-- HOSTILE TEST DATA, not a real capture. Three scratch audits of one site (a chain: HIST, BASE, CUR)
-- copied from three real audits of the `drift` fixture (releases 0, 1, 2, with their hits), then
-- rewritten so that every field a comparison, a report or the register must not print holds a canary.
-- Usage (explicit database, the audits must be finished and evaluated, in this order, oldest first):
--   psql <url> -v ON_ERROR_STOP=1 -v hist=<audit id> -v base=<audit id> -v cur=<audit id> -f seed-hostile-compare.sql
-- It prints the three new audit ids. CUR is compared with BASE by default (its `baseline_audit_id`).
--   hostile pages     /customers/CANARY-Alice-Smith, /reset-password/CANARY0a1b2c3d4e5f6a7b8 (replace the
--                     fixture's /drift/product and /drift/thank-you in the runs of all three audits)
--   messages          every check_result.message holds canary@example.com, +44 7911 123456 and a query URL
--   tags              BASE: a Meta destination shaped like a phone number (07911123456) that CUR lacks;
--                     CUR: a TikTok destination CANARY4155550100, and a GA4 event purchase_canary@example.com
--   states in CUR vs BASE: M `consent.pixel-without-consent` regressed (failed in HIST), C
--                     `coverage.invalid-currency` fixed, `consent.mode-v2-incomplete` new (forced to fail)
--   left out (report_finding_edit.hidden) in CUR: all three, so one of every changed state is hidden
-- Expected under Standard on every report surface (draft JSON `model`, snapshot, public HTML, CSV):
-- no CANARY, no canary%40, no 7911, no 4155550100, and none of the three hidden findings' states or
-- titles inside "What changed". Under Detailed only the entered paths without query and the vendor-shaped
-- IDs may appear.
\set ON_ERROR_STOP on
begin;

create function pg_temp.hc_copy(p_src uuid, p_created timestamptz) returns uuid language plpgsql as $$
declare v_dst uuid := gen_random_uuid();
begin
  insert into audit (id, org_id, created_at, site_id, created_by, config, status, error, started_at, finished_at)
    select v_dst, org_id, p_created, site_id, created_by, config, status, error, started_at, finished_at from audit where id = p_src;
  create temp table if not exists hc_map (old uuid, new uuid, dst uuid) on commit drop;
  insert into hc_map select id, gen_random_uuid(), v_dst from run where audit_id = p_src;
  insert into run (id, org_id, created_at, audit_id, failure, ordinal, page_url, scenario, viewport, journey, role, status, engine, decoder_version, consent, documents, cookies, errors, complete, truncated, screenshot_key, capture_key, hit_count, started_at, finished_at)
    select m.new, r.org_id, p_created, v_dst, r.failure, r.ordinal, r.page_url, r.scenario, r.viewport, r.journey, r.role, r.status, r.engine, r.decoder_version, r.consent, r.documents, r.cookies, r.errors, r.complete, r.truncated, r.screenshot_key, r.capture_key, r.hit_count, r.started_at, r.finished_at
    from run r join hc_map m on m.old = r.id and m.dst = v_dst;
  insert into check_result (run_id, org_id, rule_id, rules_version, status, message, evidence, area, severity, title, check_title, owner, why, fix, created_at)
    select m.new, c.org_id, c.rule_id, c.rules_version, c.status, c.message, c.evidence, c.area, c.severity, c.title, c.check_title, c.owner, c.why, c.fix, c.created_at
    from check_result c join hc_map m on m.old = c.run_id and m.dst = v_dst;
  insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id, event, params, ids, consent, host, url, blocked, status, after_consent_action)
    select h.org_id, h.created_at, m.new, h.request_id, h.batch_index, h.document_id, h.at, h.vendor, h.destination_id, h.event, h.params, h.ids, h.consent, h.host, h.url, h.blocked, h.status, h.after_consent_action
    from hit h join hc_map m on m.old = h.run_id and m.dst = v_dst;
  insert into finding (audit_id, org_id, rule_id, kind, rules_versions, area, severity, title, check_title, owner, why, fix, failing_runs, inconclusive_runs, run_ids)
    select v_dst, f.org_id, f.rule_id, f.kind, f.rules_versions, f.area, f.severity, f.title, f.check_title, f.owner, f.why, f.fix, f.failing_runs, f.inconclusive_runs,
      coalesce((select array_agg(m.new) from unnest(f.run_ids) u join hc_map m on m.old = u and m.dst = v_dst), '{}')
    from finding f where f.audit_id = p_src;
  return v_dst;
end $$;

select pg_temp.hc_copy(:'hist'::uuid, (select created_at from audit where id = :'hist'::uuid) + interval '10 seconds') as h \gset
select pg_temp.hc_copy(:'base'::uuid, (select created_at from audit where id = :'base'::uuid) + interval '10 seconds') as b \gset
select pg_temp.hc_copy(:'cur'::uuid, (select created_at from audit where id = :'cur'::uuid) + interval '10 seconds') as c \gset
update audit set baseline_audit_id = :'b'::uuid where id = :'c'::uuid;
update audit set baseline_audit_id = :'h'::uuid where id = :'b'::uuid;

-- pages: the two key pages of the fixture become hostile ones, in the audit config and the runs
update audit set config = replace(replace(config::text,
    'http://localhost:4460/drift/product', 'http://localhost:4460/customers/CANARY-Alice-Smith'),
    'http://localhost:4460/drift/thank-you', 'http://localhost:4460/reset-password/CANARY0a1b2c3d4e5f6a7b8')::jsonb
  where id in (:'h'::uuid, :'b'::uuid, :'c'::uuid);
update run set page_url = replace(replace(page_url,
    'http://localhost:4460/drift/product', 'http://localhost:4460/customers/CANARY-Alice-Smith'),
    'http://localhost:4460/drift/thank-you', 'http://localhost:4460/reset-password/CANARY0a1b2c3d4e5f6a7b8')
  where audit_id in (:'h'::uuid, :'b'::uuid, :'c'::uuid);

-- messages and reasons
update check_result set message = 'canary@example.com +44 7911 123456 http://localhost:4460/p?token=CANARYSECRET&sid=CANARYSID reason'
  where run_id in (select id from run where audit_id in (:'h'::uuid, :'b'::uuid, :'c'::uuid));

-- tags: BASE has a Meta destination shaped like a phone number that CUR does not; CUR has hostile
-- TikTok and GA4 content on the same runs (the home page, scenario none)
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id, event, params, ids, consent, host, url, blocked, status, after_consent_action)
  select r.org_id, now(), r.id, 'hostile-meta', 0, 'doc0', 5, 'meta', '07911123456', 'PageView', '{}', '{}', '{"adStorage":"granted","analyticsStorage":"granted"}', 'www.facebook.com', 'https://www.facebook.com/tr?id=07911123456', false, 200, false
  from run r where r.audit_id = :'b'::uuid and r.scenario = 'none' and r.page_url like '%/drift/';
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id, event, params, ids, consent, host, url, blocked, status, after_consent_action)
  select r.org_id, now(), r.id, 'hostile-tiktok', 0, 'doc0', 5, 'tiktok', 'CANARY4155550100', 'Pageview', '{}', '{}', '{"adStorage":"granted","analyticsStorage":"granted"}', 'analytics.tiktok.com', 'https://analytics.tiktok.com/x?sdkid=CANARY4155550100', false, 200, false
  from run r where r.audit_id = :'c'::uuid and r.scenario = 'none' and r.page_url like '%/drift/';
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id, event, params, ids, consent, host, url, blocked, status, after_consent_action)
  select r.org_id, now(), r.id, 'hostile-ga4', 0, 'doc0', 6, 'ga4', 'G-ZINKO00002', 'purchase_canary@example.com', '{}', '{}', '{"adStorage":"granted","analyticsStorage":"granted"}', 'www.google-analytics.com', 'https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00002', false, 200, false
  from run r where r.audit_id = :'c'::uuid and r.scenario = 'none' and r.page_url like '%/drift/';

-- states: HIST failed M on the same runs CUR fails it on (BASE passes, so CUR regresses); C fixed
-- (fails in BASE, passes in CUR); a new rule fails in CUR only
update check_result set status = 'fail' where rule_id = 'consent.pixel-without-consent'
  and run_id in (select id from run where audit_id = :'h'::uuid);
update check_result set status = 'pass' where rule_id = 'consent.pixel-without-consent'
  and run_id in (select id from run where audit_id = :'b'::uuid);
update check_result set status = 'fail' where rule_id = 'consent.pixel-without-consent'
  and run_id in (select id from run where audit_id = :'c'::uuid);
update check_result set status = 'fail' where rule_id = 'coverage.invalid-currency'
  and run_id in (select id from run where audit_id = :'b'::uuid);
update check_result set status = 'pass' where rule_id = 'coverage.invalid-currency'
  and run_id in (select id from run where audit_id = :'c'::uuid);
update check_result set status = 'fail' where rule_id = 'consent.mode-v2-incomplete'
  and run_id in (select id from run where audit_id = :'c'::uuid);

-- the report's own edits on CUR: all three changed findings left out of the report
insert into report_finding_edit (audit_id, org_id, rule_id, hidden, updated_by, updated_at)
  select :'c'::uuid, org_id, r, true, 'seed', now()
  from audit, unnest(array['consent.pixel-without-consent', 'coverage.invalid-currency', 'consent.mode-v2-incomplete']) r
  where id = :'c'::uuid;

\echo hist :h
\echo base :b
\echo cur :c
commit;
