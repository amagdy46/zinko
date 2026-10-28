import type { ReportModel } from "@/lib/report-model"
import { ConsentSummary } from "./consent-summary"
import { Cover } from "./cover"
import { Scope } from "./scope"
import { Summary } from "./summary"

/**
 * The report as a document. Pure: data in, HTML out, no hooks, no router links and no fetching, so
 * the app and the public Worker route render the same component. `mode` only tells a draft from
 * what a client reads.
 */
export function ReportView({
  model,
  logoSrc,
  mode,
}: {
  model: ReportModel
  logoSrc: string | null
  mode: "consultant" | "client"
}) {
  return (
    <article
      data-accent={model.branding.accent}
      className="report-paper mx-auto w-full max-w-[210mm] overflow-hidden rounded-lg border bg-card text-card-foreground"
    >
      <Cover model={model} logoSrc={logoSrc} draft={mode === "consultant"} />
      <Summary model={model} />
      <Scope model={model} />
      <ConsentSummary model={model} />
    </article>
  )
}
