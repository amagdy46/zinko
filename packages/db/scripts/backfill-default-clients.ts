import type * as PgDrizzle from "drizzle-orm/effect-postgres"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

/**
 * Idempotent data step that follows the migrations (`drizzle/` is generated and holds no data):
 * every organization gets one default client (an archived one is un-archived). A site on a named
 * client takes that client's name as `report_for`, unless it already says something, then moves to
 * the default client. Because the move is part of the step, a re-run finds nothing to copy, so a
 * `report_for` someone cleared stays cleared.
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
        update site s set report_for = coalesce(s.report_for, c.name)
        from client c
        where c.id = s.client_id and not c.is_default`)
      yield* db.execute(sql`
        update site s set client_id = d.id
        from client c, client d
        where c.id = s.client_id and not c.is_default
          and d.org_id = s.org_id and d.is_default`)
    }),
  )
