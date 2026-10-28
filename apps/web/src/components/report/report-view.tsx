import type { ComponentType, ReactNode } from "react"
import type { ReportFinding, ReportModel } from "@/lib/report-model"
import { ActionPlan } from "./action-plan"
import { Appendix } from "./appendix"
import { ConsentSummary } from "./consent-summary"
import { Cover } from "./cover"
import { Findings } from "./findings"
import { Scope } from "./scope"
import { Summary } from "./summary"

/**
 * What the consultant's view adds around the document: the findings left out of the detail (shown
 * dimmed), and slots the app fills with its edit controls. Absent in the client's view.
 */
export interface ReportControls {
  summary: ReactNode
  Finding: ComponentType<{ finding: ReportFinding; hidden: boolean }>
  hiddenFindings: ReadonlyArray<ReportFinding>
}

/**
 * The report as a document. Pure: data in, HTML out, no hooks, no router links and no fetching, so
 * the app and the public Worker route render the same component. `mode` only tells a draft from
 * what a client reads.
 */
export function ReportView({
  model,
  logoSrc,
  mode,
  controls,
}: {
  model: ReportModel
  logoSrc: string | null
  mode: "consultant" | "client"
  controls?: ReportControls
}) {
  return (
    <article
      data-accent={model.branding.accent}
      className="report-paper mx-auto w-full max-w-[210mm] overflow-hidden rounded-lg border bg-card text-card-foreground"
    >
      <Cover model={model} logoSrc={logoSrc} draft={mode === "consultant"} />
      <Summary model={model} actions={controls?.summary} />
      <Scope model={model} />
      <ConsentSummary model={model} />
      <Findings model={model} controls={controls} />
      <ActionPlan model={model} />
      <Appendix model={model} />
    </article>
  )
}
