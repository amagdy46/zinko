import { AuditConfig } from "@repo/core"
import { Database } from "@repo/core/Database"
import {
  audit,
  client,
  finding as findingTable,
  reportEdit,
  reportFindingEdit,
  run,
  site,
} from "@repo/db"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { AREAS, scenarioLabel } from "@/lib/audit-labels"
import { csvFile } from "@/lib/csv"
import { OWNER_LABELS } from "@/lib/report-model"
import { pageLabel } from "@/lib/report-projection"
import { pageIndexOf } from "@/lib/page-match"
import { auditInOrg } from "./audit-data"
import { findingsOf } from "./findings-data"
import { NotFound } from "./server-fn"

const decodeConfig = Schema.decodeUnknownEffect(AuditConfig)
const decodeFix = Schema.decodeUnknownEffect(Schema.Array(Schema.String))

const MAX_PAGE_LABELS = 20

const OWNER_LABELS_BY_ID = new Map<string, string>(Object.entries(OWNER_LABELS))

const TRIAGE_WORD = { open: "Open", accepted_risk: "Accepted risk", fixed: "Fixed" } as const

export const REGISTER_COLUMNS = [
  "Site",
  "Audit date",
  "Rule ID",
  "Finding",
  "Severity",
  "Area",
  "Status",
  "Owner",
  "Failing runs",
  "Runs checked",
  "Pages",
  "Page labels",
  "Scenarios",
  "Triage",
  "Accepted-risk reason",
  "Note",
  "In report",
  "Rules version",
  "Why it matters",
  "Fix steps",
]

/**
 * The audit register: one row per finding, failing first by severity and then those that could
 * not be checked, read live (not from a published version) for the consultant. Page labels follow
 * the report's disclosure level. Stored rule wording only: no check message, no capture text.
 */
export const registerOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    yield* auditInOrg(orgId, auditId)
    const { db } = yield* Database
    const [head] = yield* db
      .select({
        config: audit.config,
        createdAt: audit.createdAt,
        finishedAt: audit.finishedAt,
        siteName: site.name,
        host: site.host,
      })
      .from(audit)
      .innerJoin(site, eq(site.id, audit.siteId))
      .innerJoin(client, eq(client.id, site.clientId))
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
      .limit(1)
    if (head === undefined) return yield* new NotFound({ message: "Not found" })
    const config = yield* decodeConfig(head.config).pipe(Effect.orDie)
    const found = yield* findingsOf(orgId, auditId)
    const runs = yield* db
      .select({ id: run.id, pageUrl: run.pageUrl, scenario: run.scenario, journey: run.journey })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
      .orderBy(asc(run.ordinal))
    const wording = yield* db
      .select({ ruleId: findingTable.ruleId, why: findingTable.why, fix: findingTable.fix })
      .from(findingTable)
      .where(and(eq(findingTable.auditId, auditId), eq(findingTable.orgId, orgId)))
    const [edit] = yield* db
      .select({ detail: reportEdit.detail })
      .from(reportEdit)
      .where(and(eq(reportEdit.auditId, auditId), eq(reportEdit.orgId, orgId)))
      .limit(1)
    const edits = yield* db
      .select({
        ruleId: reportFindingEdit.ruleId,
        note: reportFindingEdit.note,
        hidden: reportFindingEdit.hidden,
        owner: reportFindingEdit.owner,
      })
      .from(reportFindingEdit)
      .where(and(eq(reportFindingEdit.auditId, auditId), eq(reportFindingEdit.orgId, orgId)))
    const detail = edit?.detail === "detailed" ? "detailed" : "standard"
    const runById = new Map(runs.map((r) => [r.id, r]))
    const wordingOf = new Map(wording.map((w) => [w.ruleId, w]))
    const editOf = new Map(edits.map((e) => [e.ruleId, e]))
    const date = (head.finishedAt ?? head.createdAt).toISOString().slice(0, 10)
    const rows = yield* Effect.forEach(found.findings, (f) =>
      Effect.gen(function* () {
        const affected = f.runIds.flatMap((id) => {
          const r = runById.get(id)
          return r === undefined ? [] : [r]
        })
        const labels = [
          ...new Set(
            affected
              .toSorted(
                (a, b) =>
                  Number(a.journey) * config.pages.length +
                  pageIndexOf(config.pages, a.pageUrl) -
                  (Number(b.journey) * config.pages.length + pageIndexOf(config.pages, b.pageUrl)),
              )
              .map((r) => pageLabel(config.pages, r.pageUrl, r.journey, detail)),
          ),
        ]
        const shown =
          labels.length > MAX_PAGE_LABELS
            ? [...labels.slice(0, MAX_PAGE_LABELS), `+${labels.length - MAX_PAGE_LABELS} more`]
            : labels
        const stored = wordingOf.get(f.ruleId)
        const fix = stored === undefined ? [] : yield* decodeFix(stored.fix).pipe(Effect.orDie)
        const edited = editOf.get(f.ruleId)
        const owner = edited?.owner ?? f.owner
        const scenarios = [...new Set(affected.map((r) => r.scenario))]
        return [
          head.siteName,
          date,
          f.ruleId,
          f.title,
          f.kind === "fail" ? f.severity : "",
          AREAS[f.area] ?? f.area,
          f.kind === "fail" ? "Fail" : "Could not check",
          (owner === null ? undefined : OWNER_LABELS_BY_ID.get(owner)) ?? "Owner not assigned",
          f.failingRuns,
          f.knownRuns,
          labels.length,
          shown.join("; "),
          scenarios.map(scenarioLabel).join("; "),
          TRIAGE_WORD[f.triage.status],
          f.triage.status === "accepted_risk" ? (f.triage.reason ?? "") : "",
          edited?.note ?? "",
          edited?.hidden === true ? "Left out" : "Yes",
          f.rulesVersions.join(", "),
          stored?.why ?? "",
          fix.join(" | "),
        ]
      }),
    )
    return {
      host: head.host,
      date,
      csv: csvFile([REGISTER_COLUMNS, ...rows]),
    }
  })
