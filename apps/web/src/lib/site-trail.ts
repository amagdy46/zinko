type Owner = { readonly id: string; readonly name: string } | null

type Crumb =
  | { label: string; to: "/app/sites" | "/app/clients" }
  | { label: string; to: "/app/clients/$clientId"; params: { clientId: string } }

/** Where a site sits in the breadcrumb: under its client only for a named client in an organization that groups by client. */
export const siteTrail = (groupByClient: boolean, client: Owner): ReadonlyArray<Crumb> =>
  groupByClient && client !== null
    ? [
        { label: "Clients", to: "/app/clients" },
        { label: client.name, to: "/app/clients/$clientId", params: { clientId: client.id } },
      ]
    : [{ label: "Sites", to: "/app/sites" }]

/** The page to return to after a site is archived or deleted, by the same rule. */
export const siteReturn = (groupByClient: boolean, client: Owner) =>
  groupByClient && client !== null
    ? ({ to: "/app/clients/$clientId", params: { clientId: client.id } } as const)
    : ({ to: "/app/sites" } as const)
