import type * as PgDrizzle from "drizzle-orm/effect-postgres"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

/**
 * Idempotent data step that follows the migrations (`drizzle/` is generated and holds no data):
 * every organization gets one default client (an archived one is un-archived) and, if it has no
 * `org_setting` row, one that is `true` when it has any named client, archived ones included. An
 * existing setting row is never touched, so a re-run never overrides a manager's choice.
 */
export const backfillDefaultClients = (
  db: Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults>>,
) =>
  db.$client.withTransaction(
    Effect.gen(function* () {
      yield* db.execute(sql`
        insert into client (org_id, name, is_default)
        select o.id, 'Ungrouped', true from organization o
        on conflict (org_id) where is_default do update set archived_at = null
        where client.archived_at is not null`)
      yield* db.execute(sql`
        insert into org_setting (org_id, group_by_client)
        select o.id, exists (select 1 from client c where c.org_id = o.id and not c.is_default)
        from organization o
        on conflict (org_id) do nothing`)
    }),
  )
