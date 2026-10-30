import { useRouteContext } from "@tanstack/react-router"

/** The word for who signs a report: "agency" once the organization groups sites by client, else "company". */
export function useReportVoice() {
  const { groupByClient } = useRouteContext({ from: "/app" })
  return groupByClient
    ? { who: "agency", Who: "Agency", possessive: "the agency's" }
    : { who: "company", Who: "Company", possessive: "your company's" }
}
