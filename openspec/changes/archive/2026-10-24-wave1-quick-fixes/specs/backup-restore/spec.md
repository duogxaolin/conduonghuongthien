# Spec Delta

## ADDED Requirements

### Requirement: Scheduled backups follow the configured days and hour
The backup scheduler SHALL run a scheduled backup only for the most recent configured slot (a configured weekday at the configured hour, 0–23 inclusive) that has no successful scheduled backup at or after it. A slot missed while the server was down SHALL be caught up once at the next tick. The scheduler MUST NOT start a backup on a day or hour outside the policy for any other reason.

#### Scenario: Weekly policy does not run mid-week
- **WHEN** the policy is Sundays at 03:00, the last successful scheduled backup was Sunday 03:05, and the time is Monday 15:30
- **THEN** no backup starts

#### Scenario: Midnight is honoured
- **WHEN** the configured hour is 0
- **THEN** the scheduled slot is 00:00, not 03:00

#### Scenario: Missed slot is caught up once
- **WHEN** the server was down at Sunday 03:00 and starts Sunday 07:00
- **THEN** one backup runs at the next tick and no further backup runs until the next slot

### Requirement: A failed scheduled backup is retried with a bounded backoff
A failed scheduled backup SHALL NOT count as the slot's successful run. The scheduler SHALL retry the same slot at most 3 times, at least 60 minutes apart, then stop until the next slot and log that the slot was abandoned.

#### Scenario: Failure at 03:00
- **WHEN** the 03:00 scheduled backup fails
- **THEN** a retry starts no earlier than 04:00 and no later than the slot's third retry

### Requirement: The backup scheduler runs in production unless disabled by the server
In production the backup scheduler SHALL be running unless the server environment disables it (`BACKUP_SCHEDULER=0`); the admin automatic-backup switch (default off) decides whether scheduled backups happen. The backup settings page SHALL show when the server environment has disabled the scheduler.

#### Scenario: Admin enables automatic backups
- **WHEN** no `BACKUP_SCHEDULER` variable is set in production and an admin turns automatic backups on
- **THEN** the next configured slot produces a backup

#### Scenario: Server disabled the scheduler
- **WHEN** `BACKUP_SCHEDULER=0` is set
- **THEN** the backup settings page states that automatic backups are disabled by the server

### Requirement: A failed backup run leaves no unregistered archive
When any step of a backup run fails, every archive file created by that run that is not recorded as a successful backup SHALL be deleted, and the failed record SHALL name the archive whose creation failed.

#### Scenario: Media archive fails after uploads archive succeeded
- **WHEN** the uploads archive is written and the media archive step fails
- **THEN** no archive from that run remains on disk unregistered and the failed record names the media archive

### Requirement: Backup download streams the file
Downloading a backup SHALL stream the file from disk with a `Content-Length` header and MUST work for files larger than 2 GiB without loading the file into memory. A name that does not resolve to a regular file in the backup directory SHALL return 404.

#### Scenario: Large archive
- **WHEN** a SuperAdmin downloads a 3 GiB archive
- **THEN** the response streams with `Content-Length` equal to the file size and the server's memory does not grow by the file size

#### Scenario: Directory name
- **WHEN** the requested name resolves to a directory
- **THEN** the response is 404
