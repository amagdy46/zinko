-- SYNTHETIC STRESS DATA, not a real capture. Three audits of one site for the compare feature at the supported maximum:
--   aaaaaaaa-0000-4000-8000-000000000167  OLDER   (created 3 hours ago): runs and check results of the baseline as seeded, no hits
--   aaaaaaaa-0000-4000-8000-000000000168  BASELINE (seed-max.sql), with three of its rules adjusted below
--   aaaaaaaa-0000-4000-8000-000000000169  CURRENT (created 29 minutes ago): a copy of the baseline with the changes below
-- Usage, always in this order (seed-max.sql deletes and reinserts the baseline, which this script then adjusts):
--   psql <url> -v ON_ERROR_STOP=1 -v org=<org id> -v site=<site id> -v user=<user id> -f docs/plans/2026-10-27-m4-matrix-overview-llm/seed-max.sql
--   psql <url> -v ON_ERROR_STOP=1 -v org=<org id> -v user=<user id> -f docs/plans/2026-10-28-m6-compare/seed-compare.sql
-- (seed-max.sql needs check_result rows with rules_version '3' of real rules in the organization to copy their wording.)
--
-- What the comparison of CURRENT against BASELINE must show (the 6 flips; every other rule keeps its verdicts):
--   syn.rule-01, syn.rule-02  fixed          fail on 28 and 30 baseline runs, pass on those runs now; findings become 'inconclusive'
--   syn.rule-03, syn.rule-04  regressed*     baseline: no fail (fail -> pass); now fail on 31 and 39 runs. *The OLDER audit is a copy of the unadjusted baseline, so it failed them on the same runs: cell-level history makes them regressed (Task 6), not new
--   syn.rule-05               regressed      baseline: no fail; now fails on 30 runs; the OLDER audit failed on the same 30 runs
--   syn.rule-06               verdict changed fails on 34 baseline runs; now those runs are 'inconclusive' (could not check)
--   tags: SYNTT0032 (TikTok, 5,704 hits in the baseline) is removed; G-SYN000000 (GA4, 5,642 hits) becomes G-SYN000900
--   triage: syn.rule-07, -08, -09 are accepted risks (reason 'Synthetic accepted risk') on the baseline and on the current audit
-- Expected counts, from the baseline queries before this script ran:
--   BASELINE after adjusting: 168 runs (142 complete, 16 partial, 10 failed), 226,918 hits, 10,428 check results, 66 findings (63 fail, 3 inconclusive)
--   CURRENT:                  168 runs (same statuses), 221,214 hits (226,918 - 5,704), 10,428 check results, 66 findings (63 fail, 3 inconclusive)
--   OLDER:                    168 runs, 0 hits, 10,428 check results, 66 findings (66 fail)
--   triage rows: 6 (3 on the baseline, 3 on the current audit)
\set old '''aaaaaaaa-0000-4000-8000-000000000167'''
\set base '''aaaaaaaa-0000-4000-8000-000000000168'''
\set cur '''aaaaaaaa-0000-4000-8000-000000000169'''
begin;

-- the baseline must be the freshly seeded one: rule-03 still fails on it
do $$ begin
  if not exists (select 1 from check_result c join run r on r.id = c.run_id
                 where r.audit_id = 'aaaaaaaa-0000-4000-8000-000000000168' and c.rule_id = 'syn.rule-03' and c.status = 'fail') then
    raise exception 'run seed-max.sql first: the baseline is missing or already adjusted';
  end if;
end $$;

delete from audit where id in (:old::uuid, :cur::uuid);

create temp table copies (id uuid, tag text, ago interval) on commit drop;
insert into copies values (:old::uuid, 'old', interval '3 hours'), (:cur::uuid, 'cur', interval '29 minutes');

insert into audit (id, org_id, created_at, site_id, created_by, config, status, started_at, finished_at)
select c.id, b.org_id, now() - c.ago, b.site_id, b.created_by, b.config, b.status, now() - c.ago, now() - c.ago + interval '3 minutes'
from copies c cross join audit b where b.id = :base::uuid;

-- same ordinals, URLs, scenarios and viewports as the baseline, so every run has a counterpart cell
insert into run (id, org_id, created_at, audit_id, failure, ordinal, page_url, scenario, viewport, journey,
                 status, consent, hit_count, started_at, finished_at, complete, truncated)
select md5('syn-' || c.tag || '-run-' || b.ordinal)::uuid, b.org_id, now() - c.ago, c.id, b.failure, b.ordinal, b.page_url, b.scenario,
       b.viewport, b.journey, b.status, b.consent, 0,
       now() - c.ago + b.ordinal * interval '1 second', now() - c.ago + b.ordinal * interval '1 second' + interval '900 milliseconds',
       b.complete, b.truncated
from copies c cross join run b where b.audit_id = :base::uuid;

-- check results: the baseline's verdicts, with the flips applied to the current audit
insert into check_result (run_id, org_id, rule_id, rules_version, status, message, evidence, area, severity,
                          title, check_title, why, fix, created_at, owner)
select nr.id, cr.org_id, cr.rule_id, cr.rules_version,
       v.status,
       case when v.status = cr.status then cr.message else 'synthetic: ' || v.status || ' for ' || cr.rule_id end,
       case when v.status = 'fail' then cr.evidence else '[]'::jsonb end,
       cr.area, cr.severity, cr.title, cr.check_title, cr.why, cr.fix, nr.finished_at, cr.owner
from copies c
join run nr on nr.audit_id = c.id
join run br on br.audit_id = :base::uuid and br.ordinal = nr.ordinal
join check_result cr on cr.run_id = br.id
cross join lateral (select case
    when c.tag = 'cur' and cr.rule_id in ('syn.rule-01', 'syn.rule-02') and cr.status = 'fail' then 'pass'
    when c.tag = 'cur' and cr.rule_id = 'syn.rule-06' and cr.status = 'fail' then 'inconclusive'
    else cr.status end as status) v;

-- hits for the current audit only (the older audit is read through check results alone)
insert into hit (org_id, created_at, run_id, request_id, batch_index, document_id, at, vendor, destination_id,
                 event, params, ids, consent, host, url, blocked, status, after_consent_action)
select h.org_id, nr.finished_at, nr.id, h.request_id, h.batch_index, h.document_id, h.at, h.vendor,
       case when h.destination_id = 'G-SYN000000' then 'G-SYN000900' else h.destination_id end,
       h.event, h.params, h.ids, h.consent, h.host, h.url, h.blocked, h.status, h.after_consent_action
from run br
join run nr on nr.audit_id = :cur::uuid and nr.ordinal = br.ordinal
join hit h on h.run_id = br.id
where br.audit_id = :base::uuid and h.destination_id <> 'SYNTT0032';

update run set hit_count = (select count(*) from hit where hit.run_id = run.id) where audit_id = :cur::uuid;

-- the baseline: rules 03 to 05 did not fail on it
update check_result cr set status = 'pass', message = 'synthetic: pass for ' || cr.rule_id, evidence = '[]'::jsonb
from run r where r.id = cr.run_id and r.audit_id = :base::uuid
  and cr.rule_id in ('syn.rule-03', 'syn.rule-04', 'syn.rule-05') and cr.status = 'fail';

-- findings of all three audits, derived from their check results the way the workflow does
delete from finding where audit_id in (:old::uuid, :base::uuid, :cur::uuid);
insert into finding (audit_id, org_id, rule_id, kind, rules_versions, area, severity, title, check_title, why, fix,
                     failing_runs, inconclusive_runs, run_ids, owner)
select ru.audit_id, :'org', cr.rule_id,
  case when count(*) filter (where cr.status = 'fail') > 0 then 'fail' else 'inconclusive' end,
  array['3'], min(cr.area), min(cr.severity), min(cr.title), min(cr.check_title), min(cr.why), (array_agg(cr.fix))[1],
  count(*) filter (where cr.status = 'fail')::int, count(*) filter (where cr.status = 'inconclusive')::int,
  array_agg(cr.run_id order by ru.ordinal), min(cr.owner)
from check_result cr join run ru on ru.id = cr.run_id
where ru.audit_id in (:old::uuid, :base::uuid, :cur::uuid) and cr.status in ('fail', 'inconclusive')
group by ru.audit_id, cr.rule_id;

-- three accepted risks on the baseline, carried to the current audit as they would be by a re-run
delete from finding_triage where audit_id in (:base::uuid, :cur::uuid);
insert into finding_triage (audit_id, org_id, rule_id, status, updated_by, updated_at, reason)
select a, :'org', r, 'accepted_risk', :'user', now() - interval '50 minutes', 'Synthetic accepted risk'
from unnest(array[:base::uuid, :cur::uuid]) a cross join unnest(array['syn.rule-07', 'syn.rule-08', 'syn.rule-09']) r;

commit;
analyze hit; analyze run; analyze check_result; analyze finding;
select a.label,
       (select count(*) from run where audit_id = a.id) runs,
       (select count(*) from run where audit_id = a.id and status = 'complete') complete,
       (select count(*) from run where audit_id = a.id and status = 'partial') partial,
       (select count(*) from run where audit_id = a.id and status = 'failed') failed,
       (select count(*) from hit h join run r on r.id = h.run_id where r.audit_id = a.id) hits,
       (select count(*) from check_result c join run r on r.id = c.run_id where r.audit_id = a.id) check_results,
       (select count(*) from finding where audit_id = a.id and kind = 'fail') findings_fail,
       (select count(*) from finding where audit_id = a.id and kind = 'inconclusive') findings_inconclusive,
       (select count(*) from finding_triage where audit_id = a.id) triage
from (values ('older', :old::uuid), ('baseline', :base::uuid), ('current', :cur::uuid)) a(label, id)
order by 1 desc;
