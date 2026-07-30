import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'
import { runRetentionPass } from '../server/services/retention-scheduler'
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
 */

const catchUpArgument = process.argv.find(argument => argument.startsWith('--catch-up-days='))
const catchUpDays = catchUpArgument ? Number(catchUpArgument.split('=', 2)[1]) : undefined

const result = await runAnalyticsMaintenance({ catchUpDays })

// Retention runs even when aggregation reports a warning: a stale aggregate is
// a reporting problem, holding personal data past its window is a policy one.
// It is skipped only when analytics could not run at all, because that usually
// means the database is unreachable.
const retention = result.status === 'failed'
  ? null
  : await runRetentionPass({ ignoreSchedule: true, trigger: 'cron' })

const output = {
  status: result.status,
  processedDays: result.processedDays,
  purgedRaw: result.purgedRaw,
  purgedAggregates: result.purgedAggregates,
  lastAggregatedDay: result.lastAggregatedDay,
  stale: result.stale,
  retention: retention && (retention.ran
    ? {
        ran: true,
        status: retention.result.status,
        tables: retention.result.tables,
        purgedRateLimits: retention.result.purgedRateLimits,
        message: retention.result.message,
      }
    : { ran: false, skipped: retention.reason }),
  scheduler: 'The app also runs this purge in-process. Both paths share a MySQL lock, so cron remains safe to keep.',
}

console.log(JSON.stringify(output))

await closeDb()

const retentionFailed = retention?.ran === true && retention.result.status === 'failed'
const retentionWarned = retention?.ran === true && retention.result.status === 'warning'

if (result.status === 'failed' || retentionFailed) process.exitCode = 1
else if (result.status === 'locked' || result.status === 'warning' || retentionWarned) process.exitCode = 2
