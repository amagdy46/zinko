-- SYNTHETIC STRESS DATA, not a real capture. One audit at the supported maximum:
-- (20 pages + 1 journey) x 4 scenarios x 2 viewports = 168 runs, 40 destinations on every captured run.
-- Usage: psql <url> -v org=<org id> -v site=<site id> -v user=<user id> -f seed-max.sql
-- Re-running replaces the audit (fixed id). Rule metadata for the 19 real rules is copied from
-- stored check_result rows of an existing audit; 47 more rules are synthetic ("syn.rule-NN").
\set audit '''aaaaaaaa-0000-4000-8000-000000000168'''
\set ON_ERROR_STOP on
begin;
delete from audit where id = :audit;

insert into audit (id, org_id, created_at, site_id, created_by, config, status, started_at, finished_at)
select :audit::uuid, :'org', now() - interval '1 hour', :'site'::uuid, :'user',
  jsonb_build_object(
    'pages', (select jsonb_agg('http://localhost:4400/syn/page-' || lpad(p::text, 2, '0') || '/' order by p) from generate_series(0, 19) p),
    'journey', true, 'clickIds', false,
    'scenarios', '["none","accept","reject","gpc"]'::jsonb,
    'viewports', '["desktop","mobile"]'::jsonb,
    'blockVendorRequests', true),
  'partial', now() - interval '1 hour', now() - interval '30 minutes';

-- ordinal g: viewport = g % 2, scenario = (g / 2) % 4, page = g / 8 (page 20 is the journey from page 0)
insert into run (id, org_id, created_at, audit_id, failure, ordinal, page_url, scenario, viewport, journey,
                 status, consent, hit_count, started_at, finished_at, complete, truncated)
select
  md5('syn-run-' || g)::uuid, :'org', now() - interval '1 hour', :audit::uuid,
  case when st = 'failed' then 'synthetic: capture timed out' end,
  g,
  'http://localhost:4400/syn/page-' || lpad((case when g / 8 = 20 then 0 else g / 8 end)::text, 2, '0') || '/',
  (array['none','accept','reject','gpc'])[(g / 2) % 4 + 1],
  (array['desktop','mobile'])[g % 2 + 1],
  g / 8 = 20,
  st,
  case when st = 'failed' then null else jsonb_build_object(
    'cmp', case when outcome in ('accepted','rejected') then 'cookieconsent3' end,
    'outcome', outcome,
    'actionAt', case when outcome in ('accepted','rejected') then 5000 + (g % 7) * 50 end,
    'completedAt', case when outcome in ('accepted','rejected') then 5020 + (g % 7) * 50 end,
    'observations', '[]'::jsonb) end,
  0,
  now() - interval '1 hour' + g * interval '10 seconds',
  now() - interval '1 hour' + g * interval '10 seconds' + interval '9 seconds',
  st = 'complete', false
from (
  select g, sc,
    case when abs(hashtext('status' || g)) % 100 < 6 then 'failed'
         when abs(hashtext('status' || g)) % 100 < 18 then 'partial'
         else 'complete' end as st,
    case when sc in ('none','gpc') then 'none'
         when abs(hashtext('outcome' || g)) % 100 < 10 then 'not-found'
         when sc = 'accept' then 'accepted' else 'rejected' end as outcome
  from (select g, (array['none','accept','reject','gpc'])[(g / 2) % 4 + 1] as sc from generate_series(0, 167) g) q
) r(g, sc, st, outcome);

-- 40 destinations per captured run: 14 ga4, 10 google-ads, 8 meta, 8 tiktok; 30 to 45 hits each
-- (about 1500 per run), 8 to 14 distinct events each drawn from a pool of about 500 names.
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id,
                 event, params, ids, consent, host, url, blocked, status, after_consent_action)
select
  :'org', ru.finished_at, ru.id, 'r' || (d * 100 + j), 0, 'doc1',
  at_ms,
  vendor,
  case vendor when 'ga4' then 'G-SYN' || lpad(d::text, 6, '0')
              when 'google-ads' then 'AW-9000' || lpad(d::text, 3, '0')
              when 'meta' then '5000000' || lpad(d::text, 3, '0')
              else 'SYNTT' || lpad(d::text, 4, '0') end,
  'evt_' || lpad(((d * 12 + (j % k)) % 500)::text, 3, '0'),
  jsonb_build_object('page_location', 'http://localhost/syn/page/', 'page_title', 'Synthetic page',
                     'ep.synthetic', 'stress-data', 'seq', j),
  jsonb_build_object('clientId', '1000000000.1700000000', 'sessionId', '1700000000'),
  case when vendor in ('ga4', 'google-ads') then
    case
      when action and at_ms >= action_at and ru.consent->>'outcome' = 'accepted'
        then '{"raw":"G111","adStorage":"granted","analyticsStorage":"granted"}'::jsonb
      when action and at_ms >= action_at
        then '{"raw":"G100","adStorage":"denied","analyticsStorage":"denied"}'::jsonb
      when h < 3 then '{"adStorage":"unknown","analyticsStorage":"unknown"}'::jsonb
      when h = 3 then '{"raw":"G111","adStorage":"granted","analyticsStorage":"granted"}'::jsonb
      when h = 4 then '{"raw":"G101","adStorage":"denied","analyticsStorage":"granted"}'::jsonb
      else '{"raw":"G100","adStorage":"denied","analyticsStorage":"denied"}'::jsonb
    end
  else '{"adStorage":"unknown","analyticsStorage":"unknown"}'::jsonb end,
  case vendor when 'ga4' then 'www.google-analytics.com' when 'google-ads' then 'www.googleadservices.com'
              when 'meta' then 'www.facebook.com' else 'analytics.tiktok.com' end,
  'https://' || case vendor when 'ga4' then 'www.google-analytics.com/g/collect' when 'google-ads' then 'www.googleadservices.com/pagead/conversion'
              when 'meta' then 'www.facebook.com/tr' else 'analytics.tiktok.com/api/v2/pixel' end || '?id=' || d || '&n=' || j,
  true, 204,
  action and at_ms >= action_at
from (
  select ru.id, ru.finished_at, ru.consent, ru.status, ru.ordinal,
         ru.consent->>'outcome' in ('accepted', 'rejected') as action,
         coalesce((ru.consent->>'actionAt')::int, 0) as action_at
  from run ru where ru.audit_id = :audit::uuid and ru.status <> 'failed'
) ru
cross join generate_series(0, 39) d
cross join lateral (select case when d < 14 then 'ga4' when d < 24 then 'google-ads' when d < 32 then 'meta' else 'tiktok' end as vendor,
                           8 + abs(hashtext('k' || ru.ordinal || ':' || d)) % 7 as k,
                           (30 + abs(hashtext('n' || ru.ordinal || ':' || d)) % 16) * (case when ru.status = 'partial' then 6 else 10 end) / 10 as n,
                           abs(hashtext('h' || ru.ordinal || ':' || d)) % 10 as h) x
cross join lateral generate_series(0, x.n - 1) j
cross join lateral (select (j * 9000 / x.n + d)::int as at_ms) t
where true;

update run set hit_count = (select count(*) from hit where hit.run_id = run.id) where audit_id = :audit::uuid;

create temp table syn_rule on commit drop as
  select distinct on (rule_id) rule_id, rules_version, area, severity, title, check_title, why, fix
  from check_result where rules_version = '3' and org_id = :'org' and rule_id not like 'syn.%'
  union all
  select 'syn.rule-' || lpad(i::text, 2, '0'), '3',
         (array['consent','clickids','coverage','duplicates','dedup','hygiene'])[i % 6 + 1],
         (array['critical','warning','info'])[i % 3 + 1],
         'Synthetic rule ' || i, 'Synthetic check ' || i,
         'Synthetic stress data: this rule does not exist.',
         '["Synthetic step one.","Synthetic step two."]'::jsonb
  from generate_series(1, 47) i;

insert into check_result (run_id, org_id, rule_id, rules_version, status, message, evidence, area, severity,
                          title, check_title, why, fix, created_at)
select ru.id, :'org', s.rule_id, s.rules_version, st,
  'synthetic: ' || st || ' for ' || s.rule_id,
  case when st = 'fail' then jsonb_build_array(jsonb_build_object('kind', 'hit',
         'requestId', 'r' || (abs(hashtext('e' || ru.ordinal || s.rule_id)) % 40 * 100), 'batchIndex', 0)) else '[]'::jsonb end,
  s.area, s.severity, s.title, s.check_title, s.why, s.fix, ru.finished_at
from run ru cross join syn_rule s
cross join lateral (select case
    when abs(hashtext('c' || ru.ordinal || s.rule_id)) % 100 < 20 then 'fail'
    when abs(hashtext('c' || ru.ordinal || s.rule_id)) % 100 < 28 then 'inconclusive'
    when abs(hashtext('c' || ru.ordinal || s.rule_id)) % 100 < 45 then 'not_applicable'
    else 'pass' end as st) v(st)
where ru.audit_id = :audit::uuid and ru.status <> 'failed';

insert into finding (audit_id, org_id, rule_id, kind, rules_versions, area, severity, title, check_title, why, fix,
                     failing_runs, inconclusive_runs, run_ids)
select :audit::uuid, :'org', cr.rule_id,
  case when count(*) filter (where cr.status = 'fail') > 0 then 'fail' else 'inconclusive' end,
  array['3'], min(cr.area), min(cr.severity), min(cr.title), min(cr.check_title), min(cr.why), (array_agg(cr.fix))[1],
  count(*) filter (where cr.status = 'fail')::int, count(*) filter (where cr.status = 'inconclusive')::int,
  array_agg(cr.run_id order by ru.ordinal)
from check_result cr join run ru on ru.id = cr.run_id
where ru.audit_id = :audit::uuid and cr.status in ('fail', 'inconclusive')
group by cr.rule_id;

commit;
analyze hit; analyze run; analyze check_result; analyze finding;
select (select count(*) from run where audit_id = :audit) runs,
       (select count(*) from run where audit_id = :audit and status = 'complete') complete,
       (select count(*) from run where audit_id = :audit and status = 'partial') partial,
       (select count(*) from run where audit_id = :audit and status = 'failed') failed,
       (select count(*) from hit h join run r on r.id = h.run_id where r.audit_id = :audit) hits,
       (select count(*) from check_result c join run r on r.id = c.run_id where r.audit_id = :audit) check_results,
       (select count(*) from finding where audit_id = :audit) findings;
