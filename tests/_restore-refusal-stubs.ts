/**
 * Stand-ins for the restore-refusal exports of `server/services/backup` (the barrel), for
 * tests that mock the barrel with a partial export list. `pre-job-backup.ts` and the media
 * jobs import these, so a partial mock without them fails at ESM link time ("does not
 * provide an export named …"). The refusal itself is tested with the REAL classes in
 * `tests/media-jobs-restore-abort.test.ts`; here the check always says "no restore".
 */
export function restoreRefusalStubs() {
  class BackupRestoreInProgressError extends Error {}
  class BackupRestoreStateUnknownError extends BackupRestoreInProgressError {}
  return {
    BackupRestoreInProgressError,
    BackupRestoreStateUnknownError,
    refuseIfRestoreInProgress: async () => {},
  }
}
