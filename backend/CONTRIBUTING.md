# Backend contributor notes

Operational gotchas worth knowing before you touch Prisma migrations,
the test suite, or the multi-tenant guard layer. Add to this file when
you discover something the next person should not have to rediscover.

## Patching an already-applied Prisma migration

**Use case:** a historical migration SQL file is broken in a way that
prevents `prisma migrate dev` from completing a shadow-DB replay
(typical example: a `DROP INDEX` or `DROP CONSTRAINT` without `IF
EXISTS` that references an object the shadow DB doesn't have yet). The
file is already recorded as applied in the dev DB's
`_prisma_migrations` table, so editing the file naively triggers
Prisma's "modified after applied" drift detection and demands a reset.

**Pre-flight check:** only do this when the migration is already
applied on **every** deployment target you care about (dev + staging +
prod). Production DBs are unaffected by file-content edits (Prisma
only re-checks the checksum, not the SQL state), but every developer
with a local dev DB will need to run the recipe below before their
next `migrate dev`.

For migrations that haven't shipped anywhere yet, **don't use this
recipe** — just delete the directory and re-run `prisma migrate dev`
to regenerate. Cleaner, no manual checksum work.

### The recipe (one migration)

1. **Edit the migration SQL file.** Keep edits minimal and defensive
   (add `IF EXISTS` / `IF NOT EXISTS`, comment-only changes, etc.).
   Anything that changes the semantic effect of an applied migration
   is a much riskier path — file a separate "schema repair" migration
   instead.

2. **Compute the LF-normalized SHA256 of the patched file.** Prisma
   stores `sha256(<file bytes with \n line endings>)` in the
   `_prisma_migrations.checksum` column. From `backend/`:

   ```sh
   node -e "const c=require('crypto'),f=require('fs'); \
     const lf=f.readFileSync('prisma/migrations/<DIR>/migration.sql','utf8').replace(/\r\n/g,'\n'); \
     console.log(c.createHash('sha256').update(lf,'utf8').digest('hex'));"
   ```

   Replace `<DIR>` with the migration directory name, e.g.
   `20260513182148_add_learning_outcomes`.

3. **Update `_prisma_migrations` directly.** `prisma migrate resolve
   --applied <name>` looks like the right command for this but it
   **does not work** when the migration is already in the applied
   state — Prisma errors with `P3008: migration is already recorded as
   applied`. `--rolled-back` also refuses with `P3012` for the same
   reason. The only working path is a direct DB update:

   ```sh
   echo "UPDATE _prisma_migrations SET checksum = '<NEW_CHECKSUM>' \
     WHERE migration_name = '<NAME>';" \
     | npx prisma db execute --stdin --schema prisma/schema.prisma
   ```

4. **Verify.** `npx prisma migrate status` should report
   `"Database schema is up to date!"`. `npx prisma migrate dev
   --create-only --name verify_clean_shadow` should create an empty
   migration (`-- This is an empty migration.`) and apply cleanly; if
   so, delete that empty directory.

### Why this works

Prisma's drift detection runs two independent checks:

- **Checksum check** — does the on-disk file's SHA256 match the
  recorded value? Step 3 updates the recorded value to match the new
  file. ✔
- **Structural drift check** — does the dev DB's actual schema match
  what a fresh shadow-DB replay of all migrations would produce?
  This is unaffected by file-content edits as long as the edits don't
  change the semantic effect on a populated DB. `IF EXISTS` /
  `IF NOT EXISTS` additions are safe in this sense: a DB where the
  object already exists/doesn't-exist sees no change in behavior.

If your edit DOES change the semantic effect (e.g. removing a CREATE
TABLE, changing column types), structural drift will fire on the next
`migrate dev` even after a successful checksum reconcile. The fix is
to also write a forward migration that reconciles the dev DB — same
pattern as Session 5's
`20260901000000_add_student_academic_record_promoted_by_index`, which
healed a divergence between the schema, the dev DB, and an earlier
migration that had been creating an index the schema never declared.

### Why not just `migrate reset`?

`prisma migrate reset` drops the dev DB and replays everything from
scratch. Acceptable on a fresh local clone with no seeded data;
catastrophic on a dev DB carrying months of test bookings, seeded CDC
outcomes, fixture users, etc. Always prefer the checksum-update
recipe when you have any data worth keeping.
