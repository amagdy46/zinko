import { Link } from "@tanstack/react-router"
import { auditName } from "@/lib/audit-labels"
import { useTimeZone } from "@/lib/format"

/** "the audit of /drift/, 30 Oct 2026, 18:15" as a link to that audit: how one audit points at another. */
export function AuditLink({
  audit,
  onNavigate,
}: {
  audit: { id: string; startPath: string; createdAt: Date | string }
  onNavigate?: () => void
}) {
  const timeZone = useTimeZone()
  return (
    <Link
      to="/app/audits/$auditId"
      params={{ auditId: audit.id }}
      onClick={onNavigate}
      className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      the audit of {auditName(audit, timeZone)}
    </Link>
  )
}
