import { createFileRoute, redirect } from "@tanstack/react-router"

/** Overview became Problems; an old link still lands. */
export const Route = createFileRoute("/app/audits/$auditId/overview")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/app/audits/$auditId/findings", params, replace: true })
  },
})
