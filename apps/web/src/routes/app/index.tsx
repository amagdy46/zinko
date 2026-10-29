import { createFileRoute, redirect } from "@tanstack/react-router"

/** The one place that decides where an organization lands: its mode picks Clients or Sites. */
export const Route = createFileRoute("/app/")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.groupByClient ? "/app/clients" : "/app/sites" })
  },
})
