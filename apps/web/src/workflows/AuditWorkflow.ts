import { Schema } from "effect"
import { Workflow } from "effect-cf"

/**
 * The audit workflow's binding, apart from its class (`Audit.ts`) because the class needs
 * `AppLayer`, which needs `JobsLive`, which needs this.
 */
export class AuditWorkflow extends Workflow.Tag<AuditWorkflow>()("AuditWorkflow", {
  payload: Schema.Struct({ auditId: Schema.String }),
  result: Schema.Struct({ status: Schema.String }),
}) {}
