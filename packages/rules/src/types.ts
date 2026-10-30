import type { Hit } from "@zinko/decoders"
import type {
  CaptureRequest,
  CaptureResult,
  CookieSnapshot,
  Scenario,
} from "@repo/capture-contract"

/** A decoded hit with the keys that tie it to its raw request and its document. */
export type DecodedHit = Hit & {
  requestId: string
  batchIndex: number
  documentId: string
  /** The request's start, in ms since the capture started. */
  startedAt: number
}

/** One run as the rules see it: its configuration, its stored capture and its decoded hits. */
export interface RunInput {
  scenario: Scenario
  viewport: CaptureRequest["viewport"]
  pageUrl: string
  siteHost: string
  /** The hosts the owner declared belong to the site: the only hosts the rules treat as related. Empty for audits stored before. */
  measuredHosts: readonly string[]
  journey: boolean
  capture: CaptureResult
  hits: readonly DecodedHit[]
}

/** Points into the run's stored capture or its decoded hits; the evidence resolver reads it back. */
export type EvidenceRef =
  | { kind: "hit"; requestId: string; batchIndex: number }
  | { kind: "request"; requestId: string }
  | {
      kind: "cookie"
      label: CookieSnapshot["label"]
      documentId: string
      name: string
      domain: string
      path: string
    }
  | { kind: "push"; seq: number }
  | { kind: "document"; documentId: string }

export type CheckStatus = "pass" | "fail" | "inconclusive" | "not_applicable"

export interface CheckResult {
  ruleId: string
  status: CheckStatus
  message: string
  evidence: readonly EvidenceRef[]
}

/** Who usually fixes a failing rule; a hint stored with the rule's wording, not a verdict. */
export type OwnerId = "consent-platform" | "tag-manager" | "developer"

export interface Rule {
  id: string
  area: "consent" | "clickids" | "coverage" | "duplicates" | "dedup" | "hygiene"
  severity: "critical" | "warning" | "info"
  owner: OwnerId
  title: string
  /** A neutral noun phrase that reads true whether the check passes or fails; shown when it could not be run. */
  checkTitle: string
  why: string
  fix: readonly string[]
  evaluate(input: RunInput): CheckResult
}
