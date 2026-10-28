/**
 * Every server function and who may call the runtime. `scripts/check-entry-points.mjs` (run by
 * `pnpm check`) reads this file as data and fails on a server function that is missing here, a
 * "mutation" that does not call `mutation(...)`, a "read" that writes through `respond`/`mutation`,
 * or an Effect run outside `RUNTIME_ALLOWED`. Keys are `<file under server/ without .ts>.<export>`.
 * A state-changing function is a POST that wraps its Effect in `mutation(...)` from `./server-fn`:
 * that is the single place a demo mode refuses writes.
 */
export const ENTRY_POINTS: Record<string, "read" | "mutation"> = {
  "ai-policy.getAiPolicy": "read",
  "ai-policy.saveAiPolicy": "mutation",
  "ai-settings.getLlmSettings": "read",
  "ai-settings.saveLlmSettings": "mutation",
  "ai-settings.clearLlmSettings": "mutation",
  "ai-settings.testLlmSettings": "mutation",
  "branding.getBranding": "read",
  "branding.saveBranding": "mutation",
  "branding-logo.uploadLogo": "mutation",
  "branding-logo.removeLogo": "mutation",
  "audits.startAudit": "mutation",
  "audits.previewRerun": "read",
  "audits.rerunAudit": "mutation",
  "audits.setBaseline": "mutation",
  "audits.getAudit": "read",
  "explain.explainFinding": "mutation",
  "explain.getExplanation": "read",
  "report-edit.saveReportEdit": "mutation",
  "report-edit.saveFindingEdit": "mutation",
  "matrix.getTagMatrix": "read",
  "matrix.getMatrixCell": "read",
  "clients.listClients": "read",
  "clients.searchTargets": "read",
  "clients.createClient": "mutation",
  "clients.archiveClient": "mutation",
  "clients.deleteClient": "mutation",
  "clients.getClient": "read",
  "clients.createSite": "mutation",
  "clients.updateSiteAddress": "mutation",
  "clients.archiveSite": "mutation",
  "clients.deleteSite": "mutation",
  "clients.getSite": "read",
  "findings.listFindings": "read",
  "findings.getFinding": "read",
  "findings.setTriage": "mutation",
  "findings.getEvidence": "read",
  "overview.getOverview": "read",
  "report-publish.publishReport": "mutation",
  "report-publish.deleteSnapshot": "mutation",
  "report-share.createShareLink": "mutation",
  "report-share.listShares": "read",
  "report-share.revokeShare": "mutation",
  "session.getSession": "read",
  "session.getAppState": "read",
  "report.getReportDraft": "read",
  "hits.listTimeline": "read",
  "hits.listHitFilters": "read",
  "hits.getHitDetail": "read",
  "run-browser.runBrowser": "mutation",
}

/**
 * Files under `server/` that may run an Effect directly (`runtime.runPromise`, `Effect.run*`,
 * `ManagedRuntime`): the runtime and the gates, the Worker routes (they answer outside the
 * server-function path), the auth wiring, and the session readers that cannot write.
 */
export const RUNTIME_ALLOWED: string[] = [
  "runtime.ts",
  "server-fn.ts",
  "session.ts",
  "require-session.ts",
  "auth-route.ts",
  "audit-room-route.ts",
  "storage-route.ts",
  "report-route.ts",
  "register-route.ts",
  "auth-live.ts",
  "invitation-email.ts",
]
