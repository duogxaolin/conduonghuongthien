import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'
import { runRetentionPass } from '../server/services/retention-scheduler'
import { reportRateLimitPurge } from '../server/services/rate-limit-purge-scheduler'
import { closeDb } from '../server/utils/db'

/**
 * The single nightly maintenance entrypoint. It runs analytics aggregation and
 * purge first, then the retention purge for the operational tables holding
 * personal data. One cron line, so an operator cannot install half of it.
 *
 * Retention now also runs from an in-process scheduler (see
 * server/plugins/retention-scheduler.ts), because a purge that only happens
 * when someone remembers a crontab line mostly does not happen. Both paths take
 * the same MySQL named lock, so running cron alongside the scheduler is safe —
 * whichever arrives second reports `skipped: locked` and does nothing.
 *
 * `ignoreSchedule` rather than `force`: the crontab line is this run's schedule,
 * so `runHour` does not apply — but the auto-cleanup switch in the admin still
 * does. A switch that cron ignores is not a switch.
 *
 * Every pass is settled, never awaited bare: a pass that rejects (the retention
 * pass reads its policy through `getDb()` outside any catch) lands in the JSON as
 * `{ error }` instead of aborting the script before it prints a line, purges the
 * rate-limit counters, or closes the pool — which then keeps cron hanging. The
 * exit code is 1 when any pass failed or threw, 2 for warnings / a held lock.
 */

type Settled<T> = { ok: true; value: T } | { ok: false; error: string }

async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const SCHEDULER_NOTE = 'The app also runs this purge in-process. Both paths share a MySQL lock, so cron remains safe to keep.'

const catchUpArgument = process.argv.find(argument => argument.startsWith('--catch-up-days='))
const catchUpDays = catchUpArgument ? Number(catchUpArgument.split('=', 2)[1]) : undefined

let exitCode = 0
let printed = false

try {
  const analytics = await settle(() => runAnalyticsMaintenance({ catchUpDays }))
  const result = analytics.ok ? analytics.value : null
  const analyticsFailed = !result || result.status === 'failed'

  // Retention runs even when aggregation reports a warning: a stale aggregate is
  // a reporting problem, holding personal data past its window is a policy one.
  // It is skipped only when analytics could not run at all, because that usually
  // means the database is unreachable.
  const retention = analyticsFailed
    ? null
    : await settle(() => runRetentionPass({ ignoreSchedule: true, trigger: 'cron' }))
  const retentionRun = retention?.ok && retention.value.ran ? retention.value.result : null

  // Expired rate-limit counters: their own pass and lock, NOT gated on the admin
  // auto-cleanup switch (they are lapsed windows, not data under a retention
  // policy). The in-process timer does the same; this covers RETENTION_SCHEDULER=0,
  // where cron may be the only purge — so it runs whatever happened above.
  // `reportRateLimitPurge` never throws: a failure is `{ ran: false, error }`.
  const rateLimits = await reportRateLimitPurge()

  const output = {
    status: result?.status ?? 'failed',
    ...(analytics.ok ? {} : { error: analytics.error }),
    processedDays: result?.processedDays ?? 0,
    purgedRaw: result?.purgedRaw ?? 0,
    purgedAggregates: result?.purgedAggregates ?? 0,
    lastAggregatedDay: result?.lastAggregatedDay ?? null,
    stale: result?.stale ?? null,
    retention: retention === null
      ? null
      : !retention.ok
          ? { ran: false, error: retention.error }
          : retention.value.ran
            ? {
                ran: true,
                status: retention.value.result.status,
                tables: retention.value.result.tables,
                message: retention.value.result.message,
              }
            : { ran: false, skipped: retention.value.reason },
    rateLimits,
    scheduler: SCHEDULER_NOTE,
  }
  console.log(JSON.stringify(output))
  printed = true

  const retentionFailed = retention !== null && (!retention.ok || retentionRun?.status === 'failed')
  const retentionWarned = retentionRun?.status === 'warning'
  const rateLimitsFailed = 'error' in rateLimits

  if (analyticsFailed || retentionFailed || rateLimitsFailed) exitCode = 1
  else if (result.status === 'locked' || result.status === 'warning' || retentionWarned) exitCode = 2
} catch (error) {
  // Only reachable through a bug in this file — every pass above is settled.
  exitCode = 1
  if (!printed) {
    console.log(JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      scheduler: SCHEDULER_NOTE,
    }))
  }
} finally {
  // An open pool keeps the event loop alive: cron would hang after its result.
  await closeDb()
  if (exitCode !== 0) process.exitCode = exitCode
}
