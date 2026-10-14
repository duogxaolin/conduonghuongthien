# backup-restore Specification

## Purpose
Defines who may download, restore and delete backups, what a restore must verify before executing anything, how restores are audited, and what a database dump must preserve so that restoring a backup returns the data that was backed up.

## Requirements

### Requirement: Restore, download and deletion of backups are super-admin only

The system SHALL allow only super-administrators to restore a backup (by stored filename or by upload), to download a backup file, and to delete a backup. Listing backups, reading backup status and starting a new backup SHALL keep their existing permission requirements. A non-super-administrator SHALL receive 403 for the three restricted actions regardless of any `settings` permission they hold.

#### Scenario: Settings editor cannot restore

- **WHEN** an administrator with `settings.update` but who is not a super-administrator requests a restore by filename or uploads a restore file
- **THEN** the response is 403, no file is written and no SQL is executed

#### Scenario: Settings reader cannot download a dump

- **WHEN** an administrator with `settings.read` but who is not a super-administrator requests a backup file
- **THEN** the response is 403 and no file content is returned

#### Scenario: Settings editor cannot delete a backup

- **WHEN** an administrator with `settings.update` but who is not a super-administrator requests deletion of a backup
- **THEN** the response is 403 and the file and its record remain

#### Scenario: Super-administrator keeps full access

- **WHEN** a super-administrator performs a restore, a download or a deletion
- **THEN** the action is permitted

#### Scenario: Interface hides restricted actions

- **WHEN** a non-super-administrator opens the backup page
- **THEN** the restore upload, restore, download and delete controls are not offered, while the backup list, status and "create backup" remain

### Requirement: Backup destination and retention settings are super-admin only

The system SHALL allow only super-administrators to change the Google Drive backup destination, the `keep_count` retention setting, and to use the Google Drive OAuth endpoints used for backups. Administrators holding only `settings` permissions SHALL receive 403 for these actions.

#### Scenario: Settings editor cannot change the Drive destination

- **WHEN** an administrator with `settings.update` but who is not a super-administrator changes the Drive backup destination
- **THEN** the response is 403 and the stored destination is unchanged

#### Scenario: Settings editor cannot change retention

- **WHEN** an administrator with `settings.update` but who is not a super-administrator changes `keep_count`
- **THEN** the response is 403 and the stored value is unchanged

#### Scenario: Settings editor cannot use Drive OAuth endpoints

- **WHEN** an administrator with `settings.update` but who is not a super-administrator calls a Google Drive OAuth endpoint for backups
- **THEN** the response is 403

### Requirement: Uploaded restore files are validated before use

The system SHALL validate an uploaded restore file before writing it to the backup directory, recording it, or executing any part of it: the file name SHALL end in `.sql.gz` or `.tar.gz`, the content SHALL begin with the gzip signature, the compressed size SHALL NOT exceed a fixed cap, and the decompressed size SHALL NOT exceed a fixed cap. A file that fails any check SHALL be rejected with a 4xx status, SHALL leave no file or backup record behind, and SHALL leave the restore status in a failed state with a reason.

#### Scenario: Not a gzip file

- **WHEN** a file named `x.sql.gz` whose content is plain text is uploaded
- **THEN** it is rejected and nothing is stored or executed

#### Scenario: Decompression bomb

- **WHEN** an uploaded `.sql.gz` expands beyond the decompressed-size cap
- **THEN** decompression stops, the file is rejected and memory use stays bounded

#### Scenario: Oversized upload

- **WHEN** an upload exceeds the compressed-size cap
- **THEN** it is rejected before being written to disk

### Requirement: File-archive restore refuses unsafe entries

Before extracting a `.tar.gz` backup the system SHALL list its entries and SHALL refuse to extract an archive that contains an entry with a `..` path segment, an absolute path, a symbolic link or a hard link, or an entry outside the expected top-level directory for that archive. A refused archive SHALL extract nothing.

#### Scenario: Path traversal entry

- **WHEN** an archive contains an entry named `uploads/../../etc/x`
- **THEN** the restore fails before extracting any entry

#### Scenario: Symlink entry

- **WHEN** an archive contains a symbolic link
- **THEN** the restore fails before extracting any entry

#### Scenario: Well-formed archive

- **WHEN** an archive contains only regular files and directories under the expected top-level directory
- **THEN** it is extracted

### Requirement: Archive entries are validated from the tar headers

The system SHALL validate the entries of a `.tar.gz` backup by reading the 512-byte tar headers of the decompressed stream, not by parsing the text output of a tar listing, and SHALL fail closed when a header cannot be read or is malformed.

#### Scenario: Entry types come from the header

- **WHEN** a `.tar.gz` archive contains an entry whose header type flag is a symbolic link, a hard link or a device
- **THEN** the archive is refused before any entry is extracted

#### Scenario: Unreadable header

- **WHEN** a `.tar.gz` archive has a truncated or malformed tar header
- **THEN** the archive is refused and nothing is extracted

### Requirement: A restore is preceded by a safety backup

Before executing a database restore the system SHALL create a `pre-restore` database backup of the current state. If that backup cannot be created the restore SHALL NOT proceed. Backup rotation triggered by the safety backup SHALL NOT delete the file being restored.

#### Scenario: Safety backup exists after a restore

- **WHEN** a super-administrator restores a database backup
- **THEN** a `pre-restore` backup of the previous state is listed afterwards

#### Scenario: Safety backup fails

- **WHEN** the safety backup cannot be created
- **THEN** the restore does not run and the status reports why

#### Scenario: Restoring the oldest backup

- **WHEN** the restore target is the oldest backup and rotation is at its retention limit
- **THEN** the target file still exists when the restore reads it

### Requirement: Restore is audited and logged

Every restore attempt SHALL record, in one atomic write, who performed it, the file name and the outcome, and SHALL emit a security log event for start, success and failure. A failed or refused restore SHALL be recorded as such.

#### Scenario: Successful restore

- **WHEN** a restore completes
- **THEN** one audit entry names the super-administrator and the file, and the success is logged

#### Scenario: Refused restore

- **WHEN** a restore is refused (permission, validation or safety backup failure)
- **THEN** the refusal is logged with the reason and no restore audit entry claims success

### Requirement: A database dump preserves date and time values exactly

A database backup SHALL store DATETIME, TIMESTAMP and DATE values exactly as the database holds them, independent of the application's or the server's time zone setting, and restoring that backup SHALL reproduce every such value unchanged.

#### Scenario: Round trip of date and time columns

- **WHEN** rows containing DATETIME, TIMESTAMP and DATE values (including values near midnight and near the month boundary) are dumped and restored into an empty database
- **THEN** each value read back is identical to the value before the dump

#### Scenario: Dump is independent of the server default time zone

- **WHEN** the dump is produced and restored under different server default time zones
- **THEN** every date and time value is identical after restore

### Requirement: A database dump is a consistent snapshot

A database backup SHALL read all tables from one consistent snapshot, so that rows related by foreign keys are never captured at different moments.

#### Scenario: Writes during a dump

- **WHEN** rows are inserted into related tables while a dump is running
- **THEN** the dump contains either both or neither of two rows written together in one transaction

### Requirement: Legacy app-generated dumps are flagged on restore

The system SHALL recognise a database dump produced by an older version of the application, whose date and time values were written shifted by the application's UTC offset, and SHALL warn the super-administrator before or while restoring it, and SHALL record the warning in the restore audit entry. Dumps produced by other tools SHALL NOT be flagged.

#### Scenario: Restoring an old application dump

- **WHEN** a super-administrator restores a dump created by the application before the date-fidelity fix
- **THEN** the restore status and the audit entry state that date and time values in that dump are shifted and may be seven hours early

#### Scenario: Restoring a dump from another tool

- **WHEN** a super-administrator restores a dump produced by `mysqldump`
- **THEN** no shift warning is shown
