# Spec Delta

## Purpose

Makes importing files found on disk into the media library idempotent and safe for objects other rows already use.

## ADDED Requirements

### Requirement: Re-scanning does not import the same file twice
A media scan SHALL record the source path of every file it imports and SHALL skip files whose source path is already recorded, whether the imported copy lives locally or in object storage.

#### Scenario: Second scan
- **WHEN** a scan imports `uploads/2026/10/a.jpg` to object storage and the scan runs again
- **THEN** no new media row is created for that file

### Requirement: An import never overwrites an object another row owns
Before uploading, the scan SHALL check whether the target object key is owned by another media row and SHALL skip that file as a conflict instead of overwriting. If the database insert fails after an upload, the uploaded object SHALL be deleted.

#### Scenario: Same basename in two folders
- **WHEN** `2026/09/a.jpg` and `2026/10/a.jpg` both map to an existing key owned by another row
- **THEN** the second file is reported as a conflict and the existing object is unchanged

### Requirement: Existing duplicates are reported, not deleted
The system SHALL provide a report of media rows that share a source file or object key, and MUST NOT delete them automatically.

#### Scenario: Duplicate report
- **WHEN** an admin requests the duplicate report
- **THEN** groups of rows sharing a source or key are listed with their usage counts
