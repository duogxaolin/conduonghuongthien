# Proposal

> **Wave 0 of the 2026-10-23 improvement plan.** Ship this change alone, before every other wave.
> Waves: `fix-media-category-wipe-on-boot` (0) → `wave1-quick-fixes` (1) → `wave2-hardening` (2) → `wave3-long-term` (3).

## Why

Every time the app container starts, it erases the category of every video in the media portal. That includes each deploy, each `manage.sh` Update, and each `restart: always` recovery after a crash.

The cause is in `server/db/migrations-additive.ts:565`. That line runs `UPDATE media_items SET category_id = NULL WHERE category_id IS NOT NULL` with no guard. It was meant as a one-time conversion when `media_items.category_id` moved from article `categories` to `media_categories` (commit `69a84eb`, 2026-09-22). Instead it runs on every boot, because `Dockerfile:100` runs `init.ts` and `seed.ts` before `server/index.mjs` on every start.

Staff-assigned categories have therefore survived only until the next restart since 2026-09-22. On 2026-10-23 alone there were four deploys.

This must ship before anything else. Any merge to `main` deploys and restarts the app, and that includes a docs-only merge, because the `push` trigger has no `paths-ignore`. So even merging the plan files for later waves would wipe the categories again.

## What Changes

**The boot migration converts legacy data once, based on schema state.**
- The null-out and the drop of `fk_media_items_category` run only while that constraint still references `categories`.
- If the constraint already references `media_categories`, the boot does nothing to the table: no UPDATE and no DROP/ADD of the FK.
- If the constraint is missing, it is added. Values are not nulled, because they may be real assignments.
- The null-out is never keyed on values. Legacy article-category ids 1–7 collide with the seeded `media_categories` ids 1–4, so "id not found in `media_categories`" cannot identify stale ids.

**New real-MySQL integration suite pins that boot migrations preserve media categories.**
- It covers the legacy upgrade, repeated boots with a category assigned, and a fresh database booted twice.
- It is wired into the CI integration matrix.

**Restore runbook.** It covers how to recover category values that were wiped since 2026-09-22, from backups, plus an audit-log query that lists the videos whose category staff once set.
- It goes in `docs/` and `production/README.md`.
- It runs strictly after this fix is deployed.

**User-side checklist for the whole plan.** It lives at the end of this proposal, because Wave 0 is the first thing the user acts on.

## Capabilities

### New Capabilities
- `boot-migrations`: what the schema migrations that run on every container start may and may not do to existing rows.

### Modified Capabilities
- None.

## Impact

**Code**
- `server/db/migrations-additive.ts` (lines ~545–580, the media-category block).

**Tests**
- New `tests/media-category-migration-integration.test.ts`.
- `.github/workflows/ci.yml`: integration matrix entry plus env lines in **both** env blocks, the `Integration test` step and the `Fail if this suite skipped` step.

**Docs**
- `docs/decisions/data-layer.md` (restore runbook section).
- `production/README.md` (post-deploy restore step).
- `docs/CHANGELOG.md`.
- `CLAUDE.md`: one line under Data layer, "boot migrations are state-guarded".

**Production**
- No new env vars and no compose change.
- The deploy itself is the fix. The first boot after it stops the wipe; data already lost needs the runbook.

**Not touched**
- `seed.ts` resurrection and the `home_sections` reorder overwrite. They are a different class of boot-time overwrite, planned in `wave1-quick-fixes` and `wave2-hardening`.

## User-side checklist (whole plan — not osf-apply tasks)

**Now, independent of code**
0. **Preserve the existing backups today.** The category restore needs dumps taken between a staff assignment and the next restart. `scripts/backup-db.sh` (`BACKUP_KEEP_DAYS`) and the in-app rotation (`backup_keep_count`) are deleting older dumps right now.
   - Copy `./backups` and the in-app backup directory off the VPS, or into a folder that is not rotated, before anything else.
1. **Rotate `AI_API_KEY` at the AI provider.** The key leaked in git history.
   - Commit `405461b` (2026-07-21) added `klk.zip`, whose `.env` holds `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL`. No other secrets were in it.
   - The repo is public, so rewriting history does not un-leak the key.
2. **Decide repo visibility.** Recommended: **private**.
   - The repo tracks 66 FontAwesome **Pro** files (commercial licence) in `public/assets/fontawesome`.
   - History holds `migrations/full_dump.sql` versions with an admin bcrypt hash and `activity_logs` PII.
   - CLAUDE.md and `CI-CD.md` already claim the repo is private, which is wrong today.
   - If it stays public: run `git filter-repo` on `klk.zip` and `migrations/full_dump.sql`, then enable secret scanning and push protection.
3. **Admin passwords.** If any admin password from the `full_dump.sql` era (2026-07-25 / 2026-09-13) is still in use, change it.
4. **Branch protection.** Add a ruleset on `main`: require a PR, block force-push and deletion, and require a single "CI gate" check (`CI-CD.md` §495–520 explains why a single check).
5. **Check the VPS.**
   - Run `crontab -l` and confirm backup / verify-restore lines exist.
   - Check whether `.env` has `BACKUP_SCHEDULER=1`. Without it, the admin "auto backup" toggle does nothing.
6. **Confirm the production host(s).** Is it `cdht.delify.vn`, `conduonghuongthien.com.vn`, or both? The answer decides how real the cross-subdomain CSRF risk is (Wave 2) and which CSP hosts are needed (Wave 3).

**After Wave 0 is deployed**
7. **Pick the backup(s) for the category restore.** Use dumps newer than 2026-09-22, taken between a staff assignment and the next restart.

**During Wave 1**
8. **Smoke test and monitoring.** Set the repo variable `VPS_SMOKE_URL`, create an uptime monitor, and create a healthchecks-style ping URL (`HEALTHCHECK_PING_URL`).

**During Wave 2**
9. **Restore drill.** Rehearse a restore on a blank machine.
10. **Deploy key.** Move it to a non-root deploy user with a `restrict` key.
11. **Off-VPS copy of `.env`.** Keep an encrypted copy outside the VPS.

**Plan files and a public repo.** While the repo is public, do not commit the `wave1-quick-fixes`, `wave2-hardening` or `wave3-long-term` folders. They describe unpatched, exploitable flaws with file:line.
- Keep them local until the repo is private, or until each fix has been deployed.
- This Wave 0 change can be committed together with its fix.

**Order of waves:** Wave 0 → Wave 1 group 1D (pre-deploy backup, docs-only deploy skip) → 1A → 1B → 1C → Wave 2 → Wave 3.

**Rough score effect** (reviewer's estimate, not a measurement): 6.5 now → ~7.4 after Waves 0+1 → ~8 after Wave 2 → ~8.5 after Wave 3.
