import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'
import { runDataRetention } from '../server/services/data-retention'

/**
 * The single nightly maintenance entrypoint. It runs analytics aggregation and
 * purge first, then the retention purge for the operational tables holding
 * personal data. One cron line, so an operator cannot install half of it.
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
  : await runDataRetention()

const output = {
  status: result.status,
  processedDays: result.processedDays,
  purgedRaw: result.purgedRaw,
  purgedAggregates: result.purgedAggregates,
  lastAggregatedDay: result.lastAggregatedDay,
  stale: result.stale,
  retention: retention && {
    status: retention.status,
    tables: retention.tables,
    purgedRateLimits: retention.purgedRateLimits,
    message: retention.message,
  },
  scheduler: 'Invoke this command from cron. Enable an in-process scheduler only for a guaranteed single scheduler instance.',
}

console.log(JSON.stringify(output))

if (result.status === 'failed' || retention?.status === 'failed') process.exitCode = 1
else if (result.status === 'locked' || result.status === 'warning' || retention?.status === 'warning') process.exitCode = 2
