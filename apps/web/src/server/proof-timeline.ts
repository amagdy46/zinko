import { CaptureResult, CookieSnapshot } from "@repo/capture-contract"
import { Database } from "@repo/core/Database"
import { checkResult, hit, run } from "@repo/db"
import { pushCommand } from "@repo/llm"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { auditInOrg, readCaptureTolerant, runInAudit } from "./audit-data"
import { decodeEvidence } from "./findings"
import { findingRowOf } from "./findings-data"
import { requireSession } from "./require-session"
import { membership, NotFound, read } from "./server-fn"

const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)
const decodeCookies = Schema.decodeUnknownOption(Schema.Array(CookieSnapshot))

const Input = Schema.Struct({
  auditId: Schema.String,
  runId: Schema.String,
  ruleId: Schema.String,
})

interface Tick {
  id: string
  at: number
  label: string
  cited: boolean
}
interface Row {
  kind: "vendor" | "cookie" | "dataLayer" | "request"
  name: string
  ticks: Array<Tick>
}

/**
 * What fired in one run and when, on the capture clock: every decoded hit by vendor, the moment of
 * the consent action, and which of it this check cites. Only cited cookies, pushes and undecoded
 * requests get a row, so the chart stays about the problem. A cookie's moment is the snapshot it
 * was cited in, which says when it was seen, not when it was written. No value or URL leaves
 * here: names, events and times only.
 */
export const getProofTimeline = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Input))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        yield* findingRowOf(orgId, auditId, data.ruleId)
        const found = yield* runInAudit(orgId, auditId, data.runId)
        const { db } = yield* Database
        const [stored] = yield* db
          .select({ role: run.role, consent: run.consent, cookies: run.cookies })
          .from(run)
          .where(and(eq(run.id, found.id), eq(run.orgId, orgId)))
          .limit(1)
        if (stored?.role !== "target") return yield* new NotFound({ message: "Not found" })
        const [check] = yield* db
          .select({ evidence: checkResult.evidence })
          .from(checkResult)
          .where(
            and(
              eq(checkResult.runId, found.id),
              eq(checkResult.orgId, orgId),
              eq(checkResult.ruleId, data.ruleId),
            ),
          )
          .limit(1)
        const evidence =
          check === undefined ? [] : yield* decodeEvidence(check.evidence).pipe(Effect.orDie)
        const citedHits = new Set(
          evidence.flatMap((ref) =>
            ref.kind === "hit" ? [`${ref.requestId}\0${ref.batchIndex}`] : [],
          ),
        )
        const hits = yield* db
          .select({
            requestId: hit.requestId,
            batchIndex: hit.batchIndex,
            vendor: hit.vendor,
            event: hit.event,
            at: hit.at,
          })
          .from(hit)
          .where(and(eq(hit.runId, found.id), eq(hit.orgId, orgId)))
          .orderBy(asc(hit.at), asc(hit.requestId), asc(hit.batchIndex))

        const rows = new Map<string, Row>()
        const add = (kind: Row["kind"], name: string, tick: Tick) => {
          const key = `${kind}\0${name}`
          const row = rows.get(key) ?? { kind, name, ticks: [] }
          row.ticks.push(tick)
          rows.set(key, row)
        }
        for (const h of hits)
          add("vendor", h.vendor, {
            id: `${h.requestId}-${h.batchIndex}`,
            at: h.at,
            label: h.event,
            cited: citedHits.has(`${h.requestId}\0${h.batchIndex}`),
          })

        // the run row keeps the snapshots, so a cited cookie needs no read of the stored capture
        const snapshots = Option.getOrElse(decodeCookies(stored.cookies), () => [])
        let unreadable = false
        for (const ref of evidence) {
          if (ref.kind !== "cookie") continue
          const snapshot = snapshots.find(
            (s) => s.label === ref.label && s.documentId === ref.documentId,
          )
          if (snapshot === undefined) unreadable = true
          else
            add("cookie", ref.name, {
              id: `${ref.label}-${ref.documentId}-${ref.domain}-${ref.path}`,
              at: Math.round(snapshot.at),
              label: "seen",
              cited: true,
            })
        }
        const others = evidence.filter((ref) => ref.kind === "push" || ref.kind === "request")
        if (others.length > 0) {
          const captured = yield* readCaptureTolerant(found.captureKey, found.id)
          if (captured.found) {
            const { capture } = captured
            for (const ref of others) {
              if (ref.kind === "push") {
                const push = capture.dataLayer[ref.seq]
                if (push === undefined) unreadable = true
                else
                  add("dataLayer", "dataLayer", {
                    id: `${ref.seq}`,
                    at: Math.round(push.at),
                    label: pushCommand(push.value),
                    cited: true,
                  })
              }
              if (ref.kind === "request") {
                const request = capture.requests.find((r) => r.id === ref.requestId)
                if (request === undefined || !URL.canParse(request.url)) unreadable = true
                else
                  add("request", new URL(request.url).hostname.replace(/^www\./, ""), {
                    id: request.id,
                    at: Math.round(request.startedAt),
                    label: request.resourceType,
                    cited: true,
                  })
              }
            }
          } else unreadable = true
        }
        const consent = Option.getOrNull(decodeConsent(stored.consent))
        return {
          outcome: consent?.outcome ?? null,
          actionAt: consent?.actionAt ?? null,
          rows: [...rows.values()],
          unreadable,
          citesPage: evidence.some((ref) => ref.kind === "document"),
        }
      }),
    ),
  )
