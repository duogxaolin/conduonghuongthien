import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'

const catchUpArgument = process.argv.find(argument => argument.startsWith('--catch-up-days='))
const catchUpDays = catchUpArgument ? Number(catchUpArgument.split('=', 2)[1]) : undefined

const result = await runAnalyticsMaintenance({ catchUpDays })
const output = {
  status: result.status,
  processedDays: result.processedDays,
  purgedRaw: result.purgedRaw,
  purgedAggregates: result.purgedAggregates,
  lastAggregatedDay: result.lastAggregatedDay,
  stale: result.stale,
  scheduler: 'Invoke this command from cron. Enable an in-process scheduler only for a guaranteed single scheduler instance.',
}

console.log(JSON.stringify(output))
if (result.status === 'failed') process.exitCode = 1
else if (result.status === 'locked' || result.status === 'warning') process.exitCode = 2
