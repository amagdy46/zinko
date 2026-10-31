import { createFileRoute, Link } from "@tanstack/react-router"
import { Globe, Info, TriangleAlert } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { ChangeBadge } from "@/components/change-badge"
import { DataRow, LinkRow, RowChevron, rowLink } from "@/components/data-row"
import { EmptyState } from "@/components/empty-state"
import { ConsentTokens, CopyButton, RequestView } from "@/components/evidence"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { ScoreChip } from "@/components/score-figure"
import { SectionHeading } from "@/components/section-heading"
import { SeverityBadge } from "@/components/severity"
import { Stat } from "@/components/stat"
import { StageStrip, type Stage } from "@/components/stage-strip"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { CheckStatusBadge, StatusBadge, type BadgeStatus } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ACCENTS } from "@/lib/report-accent"
import type { ChangeState } from "@/lib/compare"
import { tabLink } from "@/lib/row-style"
import { pageTitle } from "@/lib/page-title"
import { cn } from "@/lib/utils"

const title = pageTitle("Design system")

export const Route = createFileRoute("/app/design-system")({
  head: () => ({ meta: [...title.meta, { name: "robots", content: "noindex, nofollow" }] }),
  component: DesignSystem,
})

type Swatch = { name: string; className: string }

const TOKENS: ReadonlyArray<{
  role: string
  note: string
  /** The report tokens only exist under a data-accent. */
  accent?: true
  swatches: ReadonlyArray<Swatch>
}> = [
  {
    role: "Surfaces",
    note: "Page, card, raised surfaces and the sidebar. Depth is the hierarchy.",
    swatches: [
      { name: "background", className: "bg-background" },
      { name: "card", className: "bg-card" },
      { name: "popover", className: "bg-popover" },
      { name: "sidebar", className: "bg-sidebar" },
      { name: "muted", className: "bg-muted" },
      { name: "accent", className: "bg-accent" },
      { name: "secondary", className: "bg-secondary" },
    ],
  },
  {
    role: "Text",
    note: "Ink and the quiet text; every pair is at least 4.5:1 on its surface.",
    swatches: [
      { name: "foreground", className: "bg-foreground" },
      { name: "muted-foreground", className: "bg-muted-foreground" },
      { name: "card-foreground", className: "bg-card-foreground" },
      { name: "popover-foreground", className: "bg-popover-foreground" },
      { name: "accent-foreground", className: "bg-accent-foreground" },
      { name: "secondary-foreground", className: "bg-secondary-foreground" },
    ],
  },
  {
    role: "Brand and actions",
    note: "primary is the only brand accent; destructive is for destructive actions and form errors.",
    swatches: [
      { name: "primary", className: "bg-primary" },
      { name: "primary-foreground", className: "bg-primary-foreground" },
      { name: "destructive", className: "bg-destructive" },
    ],
  },
  {
    role: "Borders and focus",
    note: "ring is the focus ring; border-subtle is the hairline of cards.",
    swatches: [
      { name: "border", className: "bg-border" },
      { name: "border-subtle", className: "bg-border-subtle" },
      { name: "input", className: "bg-input" },
      { name: "ring", className: "bg-ring" },
    ],
  },
  {
    role: "Severity",
    note: "Critical, Warning, Info. Each set: text and glyph, -bg, -border, -solid.",
    swatches: [
      { name: "sev-critical", className: "bg-sev-critical" },
      { name: "sev-critical-bg", className: "bg-sev-critical-bg" },
      { name: "sev-critical-border", className: "bg-sev-critical-border" },
      { name: "sev-critical-solid", className: "bg-sev-critical-solid" },
      { name: "sev-warning", className: "bg-sev-warning" },
      { name: "sev-warning-bg", className: "bg-sev-warning-bg" },
      { name: "sev-warning-border", className: "bg-sev-warning-border" },
      { name: "sev-warning-solid", className: "bg-sev-warning-solid" },
      { name: "sev-info", className: "bg-sev-info" },
      { name: "sev-info-bg", className: "bg-sev-info-bg" },
      { name: "sev-info-border", className: "bg-sev-info-border" },
      { name: "sev-info-solid", className: "bg-sev-info-solid" },
    ],
  },
  {
    role: "Status",
    note: "pass, active (running) and neutral (finished, queued, not audited, unknown). The same four tokens each.",
    swatches: [
      { name: "status-pass", className: "bg-status-pass" },
      { name: "status-pass-bg", className: "bg-status-pass-bg" },
      { name: "status-pass-border", className: "bg-status-pass-border" },
      { name: "status-pass-solid", className: "bg-status-pass-solid" },
      { name: "status-active", className: "bg-status-active" },
      { name: "status-active-bg", className: "bg-status-active-bg" },
      { name: "status-active-border", className: "bg-status-active-border" },
      { name: "status-active-solid", className: "bg-status-active-solid" },
      { name: "status-neutral", className: "bg-status-neutral" },
      { name: "status-neutral-bg", className: "bg-status-neutral-bg" },
      { name: "status-neutral-border", className: "bg-status-neutral-border" },
      { name: "status-neutral-solid", className: "bg-status-neutral-solid" },
    ],
  },
  {
    role: "Report",
    accent: true,
    note: "The report paper reads these; the accent is one of the eight presets below.",
    swatches: [
      { name: "report-accent", className: "bg-report-accent" },
      { name: "report-tint", className: "bg-report-tint" },
      { name: "report-on-accent", className: "bg-report-on-accent" },
    ],
  },
]

const GLYPHS: ReadonlyArray<{ meaning: StatusMeaning; word: string }> = [
  { meaning: "critical", word: "Critical" },
  { meaning: "warning", word: "Warning" },
  { meaning: "info", word: "Info" },
  { meaning: "pass", word: "Pass" },
  { meaning: "fail", word: "Fail" },
  { meaning: "could-not-check", word: "Could not check" },
  { meaning: "not-applicable", word: "Not applicable" },
  { meaning: "not-evaluated", word: "Not evaluated" },
  { meaning: "finished", word: "Finished" },
  { meaning: "captured", word: "Captured" },
  { meaning: "queued", word: "Queued" },
  { meaning: "running", word: "Running" },
  { meaning: "partial", word: "Partial" },
  { meaning: "failed", word: "Failed" },
  { meaning: "none", word: "Not audited" },
]

const BADGE_STATUSES: ReadonlyArray<BadgeStatus> = [
  "complete",
  "partial",
  "failed",
  "running",
  "queued",
  "none",
  "unknown",
]

const CHECK_STATUSES = ["fail", "inconclusive", "pass", "not_applicable"] as const

const CHANGE_STATES: ReadonlyArray<ChangeState> = [
  "new",
  "regressed",
  "fixed",
  "unchanged",
  "verdict_changed",
  "not_comparable",
]

const SAMPLE_AT = new Date("2026-10-30T10:00:00Z")

const baseStage: Stage = {
  capture: { active: false, total: 24, complete: 24, partial: 0, failed: 0 },
  decisions: { evaluated: true, failing: 5, decided: 2, carriedOver: 1 },
  report: { published: null, shared: null },
  reaudit: null,
}

const STAGES: ReadonlyArray<{
  label: string
  stage: Stage
  active: boolean
  archived: boolean
}> = [
  {
    label: "Running: capture is next",
    stage: {
      ...baseStage,
      capture: { active: true, total: 24, complete: 9, partial: 1, failed: 0 },
      decisions: { evaluated: false, failing: 0, decided: 0, carriedOver: 0 },
    },
    active: true,
    archived: false,
  },
  {
    label: "Settled with gaps: decisions are next, with one carried over",
    stage: {
      ...baseStage,
      capture: { active: false, total: 24, complete: 20, partial: 3, failed: 1 },
    },
    active: false,
    archived: false,
  },
  {
    label: "All decided, published but not shared: report is next",
    stage: {
      ...baseStage,
      decisions: { evaluated: true, failing: 5, decided: 5, carriedOver: 0 },
      report: { published: 2, shared: null },
    },
    active: false,
    archived: false,
  },
  {
    label: "Shared, no re-run yet: re-audit is next",
    stage: {
      ...baseStage,
      decisions: { evaluated: true, failing: 5, decided: 5, carriedOver: 0 },
      report: { published: 2, shared: 2 },
    },
    active: false,
    archived: false,
  },
  {
    label: "Nothing failing, partial capture, successor still running",
    stage: {
      ...baseStage,
      capture: { active: false, total: 24, complete: 21, partial: 3, failed: 0 },
      decisions: { evaluated: true, failing: 0, decided: 0, carriedOver: 0 },
      report: { published: 2, shared: 1 },
      reaudit: { id: "sample", status: "running", evaluated: false, at: SAMPLE_AT },
    },
    active: false,
    archived: false,
  },
  {
    label: "Not evaluated, site archived",
    stage: {
      ...baseStage,
      capture: { active: false, total: 24, complete: 0, partial: 0, failed: 24 },
      decisions: { evaluated: false, failing: 0, decided: 0, carriedOver: 0 },
    },
    active: false,
    archived: true,
  },
  {
    label: "Everything done: re-run evaluated",
    stage: {
      ...baseStage,
      decisions: { evaluated: true, failing: 5, decided: 5, carriedOver: 0 },
      report: { published: 2, shared: 2 },
      reaudit: { id: "sample", status: "complete", evaluated: true, at: SAMPLE_AT },
    },
    active: false,
    archived: false,
  },
]

const SAMPLE_REQUEST = {
  id: "req-14",
  method: "POST",
  url: "https://www.google-analytics.com/g/collect?v=2&tid=G-SAMPLE1234&en=page_view&gcs=G111&dl=https%3A%2F%2Fshop.example%2F",
  resourceType: "fetch",
  bodyTruncated: false,
  body: "en=scroll&epn.percent_scrolled=90",
} as const

const FULL_COVERAGE = {
  totalRuns: 24,
  evaluatedRuns: 24,
  unfinishedRuns: 0,
  checks: 480,
  unresolvedChecks: 0,
  unauditedSites: 0,
}

const PARTIAL_COVERAGE = { ...FULL_COVERAGE, evaluatedRuns: 21, unfinishedRuns: 3 }

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function Block({
  id,
  title: heading,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <SectionHeading title={<span id={id}>{heading}</span>} description={description} />
      {children}
    </section>
  )
}

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="type-label">{label}</h3>
      {children}
    </div>
  )
}

function DesignSystem() {
  const [grayscale, setGrayscale] = useState(false)
  const [tab, setTab] = useState("overview")
  const [secondary, setSecondary] = useState("runs")
  return (
    <PageShell>
      <PageHeader
        breadcrumb={[{ label: "Design system" }]}
        title="Design system"
        description="The tokens, type roles and shared components of the app, drawn by the real code. The written rules are in docs/ui.md."
        actions={
          <Button
            type="button"
            variant="outline"
            aria-pressed={grayscale}
            onClick={() => setGrayscale((on) => !on)}
          >
            {grayscale ? "Show colour" : "Preview in grayscale"}
          </Button>
        }
      />
      <div className={cn("space-y-10", grayscale && "grayscale")}>
        <Block
          id="ds-tokens"
          title="Theme tokens"
          description="Swatches use the token classes, so they follow the theme. Switch it in the account menu, Theme."
        >
          <div className="space-y-6">
            {TOKENS.map((group) => (
              <Sample key={group.role} label={group.role}>
                <p className="text-sm text-muted-foreground">{group.note}</p>
                <ul
                  data-accent={group.accent ? "violet" : undefined}
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
                >
                  {group.swatches.map((swatch) => (
                    <li key={swatch.name} className="min-w-0 space-y-1.5">
                      <div className={cn("h-10 rounded-md border", swatch.className)} />
                      <code className="block truncate font-mono text-xs">{swatch.name}</code>
                    </li>
                  ))}
                </ul>
              </Sample>
            ))}
          </div>
        </Block>

        <Block
          id="ds-accents"
          title="Report accents"
          description="Eight presets, chosen in Settings, Branding and set with a data-accent attribute. Each is at least 4.5:1 on white."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ACCENTS.map((accent) => (
              <li key={accent.id} data-accent={accent.id} className="min-w-0 space-y-1.5">
                <div className="flex h-10 items-center justify-center rounded-md border bg-report-accent text-sm font-medium text-report-on-accent">
                  Aa
                </div>
                <div className="h-2 rounded-sm border bg-report-tint" />
                <code className="block truncate font-mono text-xs">{accent.id}</code>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="ds-type" title="Type roles">
          <div className="space-y-4">
            <Sample label="Display">
              <p className="text-xl font-semibold tracking-tight sm:text-2xl">Page title</p>
              <p className="text-5xl font-semibold tracking-tight tabular-nums">72</p>
            </Sample>
            <Sample label="type-section">
              <p className="type-section">Section heading</p>
            </Sample>
            <Sample label="type-label">
              <p className="type-label">Label</p>
            </Sample>
            <Sample label="Body and scale">
              <div className="space-y-1">
                <p className="text-base">text-base 14/22: long prose</p>
                <p className="text-sm">text-sm 13/20: body</p>
                <p className="text-xs">text-xs 12/16: meta lines</p>
                <p className="text-2xs">text-2xs 11/16: kickers and qualifiers</p>
                <p className="font-mono text-xs">font-mono: IDs, parameters, URLs and timestamps</p>
              </div>
            </Sample>
          </div>
        </Block>

        <Block id="ds-space" title="Spacing and radius">
          <div className="grid gap-6 sm:grid-cols-2">
            <Sample label="Spacing (4px steps)">
              <ul className="space-y-1.5">
                {[
                  { name: "1", box: "w-1" },
                  { name: "2", box: "w-2" },
                  { name: "3", box: "w-3" },
                  { name: "4", box: "w-4" },
                  { name: "6", box: "w-6" },
                  { name: "8", box: "w-8" },
                  { name: "12", box: "w-12" },
                ].map((step) => (
                  <li key={step.name} className="flex items-center gap-3">
                    <code className="w-6 font-mono text-xs">{step.name}</code>
                    <div className={cn("h-3 rounded-sm bg-primary", step.box)} />
                  </li>
                ))}
              </ul>
            </Sample>
            <Sample label="Radius">
              <ul className="flex flex-wrap gap-4">
                {[
                  { name: "sm", box: "rounded-sm" },
                  { name: "md", box: "rounded-md" },
                  { name: "lg", box: "rounded-lg" },
                  { name: "xl", box: "rounded-xl" },
                ].map((step) => (
                  <li key={step.name} className="space-y-1.5">
                    <div className={cn("size-14 border bg-card shadow-xs", step.box)} />
                    <code className="block font-mono text-xs">{step.name}</code>
                  </li>
                ))}
              </ul>
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-buttons"
          title="Buttons"
          description="One primary action per screen. A target is at least 32px."
        >
          <div className="space-y-4">
            {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map(
              (variant) => (
                <div key={variant} className="flex flex-wrap items-center gap-3">
                  <code className="w-24 font-mono text-xs">{variant}</code>
                  <Button variant={variant} size="sm">
                    Small
                  </Button>
                  <Button variant={variant}>Default</Button>
                  <Button variant={variant} size="lg">
                    Large
                  </Button>
                  <Button variant={variant} disabled>
                    Disabled
                  </Button>
                </div>
              ),
            )}
            <div className="flex flex-wrap items-center gap-3">
              <code className="w-24 font-mono text-xs">icon</code>
              <Button variant="outline" size="icon-sm" aria-label="Sites">
                <Globe aria-hidden="true" />
              </Button>
              <CopyButton value="https://shop.example/" label="Copy address" />
              <CopyButton value="https://shop.example/" label="Copy with a label" showLabel />
            </div>
          </div>
        </Block>

        <Block
          id="ds-glyphs"
          title="Status glyphs and badges"
          description="A status is a glyph and a word, never colour alone. Turn on the grayscale preview to check."
        >
          <div className="space-y-4">
            <Sample label="StatusGlyph, every meaning">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {GLYPHS.map((glyph) => (
                  <li key={glyph.meaning} className="flex items-center gap-2 text-sm">
                    <StatusGlyph meaning={glyph.meaning} />
                    <span>{glyph.word}</span>
                    <code className="font-mono text-2xs text-muted-foreground">
                      {glyph.meaning}
                    </code>
                  </li>
                ))}
              </ul>
            </Sample>
            <Sample label="SeverityBadge">
              <div className="flex flex-wrap gap-2">
                <SeverityBadge severity="critical" />
                <SeverityBadge severity="warning" />
                <SeverityBadge severity="info" />
              </div>
            </Sample>
            <Sample label="StatusBadge (audit and run)">
              <div className="flex flex-wrap gap-2">
                {BADGE_STATUSES.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
              </div>
            </Sample>
            <Sample label="CheckStatusBadge">
              <div className="flex flex-wrap gap-2">
                {CHECK_STATUSES.map((status) => (
                  <CheckStatusBadge key={status} status={status} />
                ))}
              </div>
            </Sample>
            <Sample label="ChangeBadge (since the baseline)">
              <div className="flex flex-wrap gap-2">
                {CHANGE_STATES.map((state) => (
                  <ChangeBadge key={state} state={state} />
                ))}
              </div>
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-stage"
          title="Stage strip"
          description="Where a full audit is in the loop. The first available unfinished step carries Next; plain text and unavailable steps are skipped. The sample props are fixed."
        >
          <div className="space-y-5">
            {STAGES.map((sample) => (
              <Sample key={sample.label} label={sample.label}>
                <StageStrip
                  auditId="sample"
                  stage={sample.stage}
                  active={sample.active}
                  archived={sample.archived}
                  onRerun={() => toast("Re-run opens the Re-run dialog on a real audit.")}
                />
              </Sample>
            ))}
          </div>
        </Block>

        <Block
          id="ds-tabs"
          title="Tabs"
          description="Audit tabs are links with an underline for the current one; Evidence holds Runs, Tags and Hits behind a second row. Both rows scroll inside their container with inset rings. TabsList is the segmented control for in-page views."
        >
          <div className="space-y-5">
            <Sample label="Tab bar and secondary row">
              <div className="space-y-1">
                <nav
                  aria-label="Audit sample"
                  className="scroll-edges -mx-2.5 flex gap-1 overflow-x-auto overflow-y-hidden border-b text-sm tabular-nums"
                >
                  {[
                    ["overview", "Overview"],
                    ["findings", "Findings 7"],
                    ["changes", "Changes"],
                    ["evidence", "Evidence 24"],
                    ["report", "Report"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-current={tab === id ? "page" : undefined}
                      data-status={tab === id ? "active" : "inactive"}
                      className={tabLink}
                      onClick={() => setTab(id ?? "overview")}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {tab === "evidence" ? (
                  <nav
                    aria-label="Evidence sample"
                    className="scroll-edges -mx-2.5 flex gap-1 overflow-x-auto overflow-y-hidden border-b text-xs tabular-nums"
                  >
                    {[
                      ["runs", "Runs 24"],
                      ["tags", "Tags 11"],
                      ["hits", "Hits 342"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-current={secondary === id ? "page" : undefined}
                        data-status={secondary === id ? "active" : "inactive"}
                        className={cn(tabLink, "text-xs")}
                        onClick={() => setSecondary(id ?? "runs")}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Choose Evidence to see the second row.
              </p>
            </Sample>
            <Sample label="Tabs (segmented)">
              <Tabs defaultValue="open">
                <TabsList>
                  <TabsTrigger value="open">Open</TabsTrigger>
                  <TabsTrigger value="accepted">Accepted risk</TabsTrigger>
                  <TabsTrigger value="fixed">Fixed</TabsTrigger>
                </TabsList>
                <TabsContent value="open" className="p-2 text-sm">
                  Findings that still fail and have no decision.
                </TabsContent>
                <TabsContent value="accepted" className="p-2 text-sm">
                  Findings someone chose to live with, with a reason.
                </TabsContent>
                <TabsContent value="fixed" className="p-2 text-sm">
                  Findings marked fixed by the author.
                </TabsContent>
              </Tabs>
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-rows"
          title="Rows"
          description="A row that opens something: the link carries rowLink, which stretches over the row and draws an inset ring."
        >
          <div className="space-y-5">
            <Sample label="LinkRow in a table">
              <div className="overflow-x-auto rounded-lg border border-border-subtle bg-card shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Last audit</TableHead>
                      <TableHead className="w-8">
                        <span className="sr-only">Open</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {["shop.example", "blog.example"].map((host, index) => (
                      <LinkRow key={host} selected={index === 1}>
                        <TableCell>
                          <Link to="/app/design-system" className={cn(rowLink, "font-medium")}>
                            {host}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {index === 0 ? "Finished" : "Selected row"}
                        </TableCell>
                        <TableCell>
                          <RowChevron />
                        </TableCell>
                      </LinkRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Sample>
            <Sample label="DataRow in a list">
              <ul className="overflow-hidden rounded-lg border border-border-subtle bg-card shadow-xs">
                <DataRow>
                  <StatusGlyph meaning="critical" />
                  <div className="min-w-0 flex-1">
                    <Link to="/app/design-system" className={cn(rowLink, "font-medium")}>
                      Ad tags fire before consent
                    </Link>
                    <span className="block text-sm text-muted-foreground">
                      Consent · 3 pages · 4 scenarios
                    </span>
                  </div>
                  <RowChevron />
                </DataRow>
                <DataRow>
                  <StatusGlyph meaning="warning" />
                  <div className="min-w-0 flex-1">
                    <Link to="/app/design-system" className={cn(rowLink, "font-medium")}>
                      Analytics sends the full page address
                    </Link>
                    <span className="block text-sm text-muted-foreground">
                      Privacy · 1 page · 2 scenarios
                    </span>
                  </div>
                  <RowChevron />
                </DataRow>
              </ul>
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-notices"
          title="Notices and empty states"
          description="An alert is an inline row, a destructive one only for a failure. An empty state is a narrow centred block that never spans the page."
        >
          <div className="space-y-4">
            <Alert>
              <Info aria-hidden="true" />
              <AlertTitle>Partly evaluated</AlertTitle>
              <AlertDescription>38 of 40 runs have check results.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>The model did not answer in time</AlertTitle>
              <AlertDescription>Try again. Nothing was stored.</AlertDescription>
            </Alert>
            <EmptyState
              icon={Globe}
              title="Add your first site"
              description="A site is the address Zinko audits."
              steps={["Add the site", "Choose the scenarios", "Read the findings"]}
              action={<Button>Add site</Button>}
            />
            <EmptyState
              dashed
              title="Not evaluated"
              description="No check ran, so nothing here is clean."
            />
          </div>
        </Block>

        <Block id="ds-figures" title="Stat and score">
          <div className="space-y-4">
            <Sample label="Stat">
              <div className="grid max-w-xl grid-cols-3 gap-3">
                <Stat glyph="critical" label="Critical" value={2} unit="open" />
                <Stat glyph="warning" label="Warning" value={5} unit="open" />
                <Stat glyph="could-not-check" label="Could not check" value={6} unit="rules" />
              </div>
            </Sample>
            <Sample label="ScoreChip">
              <div className="flex flex-wrap items-start gap-8">
                <ScoreChip score={72} band="attention" coverage={FULL_COVERAGE} />
                <ScoreChip score={38} band="critical" coverage={PARTIAL_COVERAGE} />
                <ScoreChip score={null} band={null} coverage={FULL_COVERAGE} />
              </div>
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-evidence"
          title="Evidence"
          description="The request view is compact on Start with and full in the finding detail. The sample request is fixed."
        >
          <div className="space-y-5">
            <Sample label="RequestView compact">
              <div className="max-w-xl rounded-lg border bg-card p-4">
                <RequestView compact request={SAMPLE_REQUEST} />
              </div>
            </Sample>
            <Sample label="RequestView full">
              <div className="max-w-2xl rounded-lg border bg-card p-4">
                <RequestView request={SAMPLE_REQUEST} />
              </div>
            </Sample>
            <Sample label="ConsentTokens">
              <ConsentTokens consent={{ adStorage: "denied", analyticsStorage: "granted" }} />
            </Sample>
          </div>
        </Block>

        <Block
          id="ds-focus"
          title="Focus"
          description="Press Tab to see the ring. A solid 2px ring with a 2px gap in the page colour; inset where an ancestor clips."
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={cn(
                "inline-flex h-8 items-center rounded-md border px-3 text-sm outline-none",
                FOCUS_RING,
              )}
            >
              Offset ring
            </button>
            <div className="overflow-hidden rounded-md border">
              <button
                type="button"
                className="inline-flex h-8 items-center px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                Inset ring
              </button>
            </div>
          </div>
        </Block>
      </div>
    </PageShell>
  )
}
