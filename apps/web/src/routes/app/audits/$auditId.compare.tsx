import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { GitCompareArrows } from "lucide-react"
import { Option, Schema } from "effect"
import { useRef, useState } from "react"
import { ChangeSheet } from "@/components/compare/change-sheet"
import { FindingsTable } from "@/components/compare/findings-table"
import { CompareNotices } from "@/components/compare/notices"
import { CompareSummary } from "@/components/compare/summary"
import { TagsSection } from "@/components/compare/tags"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ChangeState } from "@/lib/compare"
import { nothingChanged } from "@/lib/compare-text"
import { shortDate, shortDateTime, useTimeZone } from "@/lib/format"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { getComparison } from "@/server/compare"
import type { NoComparison } from "@/server/compare-data"
import { setBaseline } from "@/server/audits"

const auditRoute = getRouteApi("/app/audits/$auditId")
const decodeText = Schema.decodeUnknownOption(Schema.String)
const decodeState = Schema.decodeUnknownOption(
  Schema.Literals(["new", "regressed", "unchanged", "fixed", "verdict_changed", "not_comparable"]),
)

interface Search {
  against?: string
  state?: ChangeState
  finding?: string
}

export const Route = createFileRoute("/app/audits/$auditId/compare")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    against: Option.getOrUndefined(decodeText(search.against)),
    state: Option.getOrUndefined(decodeState(search.state)),
    finding: Option.getOrUndefined(decodeText(search.finding)),
  }),
  head: ({ matches }: TitleContext) => auditTabTitle("Compare", matches),
  loaderDeps: ({ search }) => ({ against: search.against }),
  loader: ({ params, deps }) =>
    getComparison({
      data: {
        auditId: params.auditId,
        ...(deps.against === undefined ? {} : { against: deps.against }),
      },
    }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: CompareScreen,
})

const EMPTY: Record<NoComparison, { title: string; description: string; dashed?: boolean }> = {
  no_earlier: {
    title: "No earlier audit to compare with",
    description:
      "This is the first evaluated audit of this site. Re-run it after the fixes and this tab shows what was fixed, what is new and what came back.",
  },
  no_baseline: {
    title: "No baseline chosen",
    description:
      "This audit has no baseline: none was chosen, or the audit it was compared with was deleted. Pick an earlier audit above to compare with.",
  },
  audit_active: {
    title: "Available when the audit finishes",
    description: "The comparison is computed from the finished results of both audits.",
  },
  audit_failed: {
    title: "Nothing to compare",
    description: "This audit failed before it produced results.",
  },
  not_evaluated: {
    title: "Not evaluated",
    description:
      "No run of this audit has check results, so there is nothing to compare. It is not clean: nothing can be said about its tracking.",
    dashed: true,
  },
  narrow: {
    title: "A re-check is not compared",
    description:
      "A re-check covers a few pages for one check. Its result is shown in the audit it belongs to.",
  },
}

function CompareScreen() {
  const view = Route.useLoaderData()
  const { auditId } = Route.useParams()
  const { state, finding } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const timeZone = useTimeZone()
  const { audit } = auditRoute.useLoaderData()
  const opener = useRef<HTMLElement | null>(null)
  const [message, setMessage] = useState<string>()
  const [pending, setPending] = useState(false)
  const { comparison, candidates, baselineId } = view
  const against = comparison?.before.id
  const label = (iso: string, id: string) =>
    `${shortDateTime(iso, timeZone)}${id === baselineId ? " (baseline)" : ""}`

  async function makeBaseline() {
    if (against === undefined) return
    setPending(true)
    setMessage(undefined)
    try {
      const result = await setBaseline({ data: { auditId, against } })
      if (!result.ok) setMessage(result.message)
      else await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  const picker =
    candidates.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="compare-against" className="text-sm text-muted-foreground">
          Audit
        </label>
        <Select
          value={against ?? baselineId ?? ""}
          onValueChange={(next) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                against: next === baselineId ? undefined : next,
                finding: undefined,
              }),
            })
          }
        >
          <SelectTrigger id="compare-against" className="h-8 w-60 max-w-full">
            <SelectValue placeholder="Choose an earlier audit" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {label(c.createdAt, c.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {against !== undefined && against !== baselineId ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={pending || audit.kind !== "full"}
            onClick={() => void makeBaseline()}
          >
            Make this the baseline
          </Button>
        ) : null}
      </div>
    )

  if (comparison === null) {
    const empty = EMPTY[view.empty ?? "no_baseline"]
    return (
      <div className="space-y-4">
        {picker}
        <EmptyState
          title={empty.title}
          description={empty.description}
          icon={GitCompareArrows}
          dashed={empty.dashed}
        />
      </div>
    )
  }

  const shownCount = state === undefined ? comparison.findings.length : comparison.counts[state]
  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h2 className="text-base font-semibold">
            Compared with the audit of {shortDate(comparison.before.createdAt, timeZone)}
          </h2>
          {picker}
        </div>
        {against !== baselineId ? (
          <p className="text-sm text-muted-foreground">
            This is not the baseline of this audit. Make it the baseline to use it in the Overview
            and the report.
          </p>
        ) : null}
        {message === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
      <CompareSummary
        comparison={comparison}
        selected={state}
        onSelect={(next) => void navigate({ search: (prev) => ({ ...prev, state: next }) })}
      />
      <CompareNotices comparison={comparison} />
      {nothingChanged(comparison) ? (
        <p role="status" className="text-sm">
          No finding changed in the {comparison.comparability.commonCells} shared runs. Open Tags
          below to see whether any tag did.
        </p>
      ) : null}
      {shownCount === 0 ? (
        <p className="text-sm text-muted-foreground">No findings in this state.</p>
      ) : (
        <FindingsTable
          findings={comparison.findings}
          state={state}
          onOpen={(ruleId, element) => {
            opener.current = element
            void navigate({ search: (prev) => ({ ...prev, finding: ruleId }) })
          }}
        />
      )}
      <TagsSection key={comparison.before.id} auditId={auditId} against={comparison.before.id} />
      <ChangeSheet
        auditId={auditId}
        comparison={comparison}
        ruleId={finding}
        opener={opener}
        onClose={() => void navigate({ search: (prev) => ({ ...prev, finding: undefined }) })}
      />
    </div>
  )
}
