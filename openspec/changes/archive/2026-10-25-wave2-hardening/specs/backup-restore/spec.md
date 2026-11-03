# Spec Delta

## ADDED Requirements

### Requirement: Scheduled backups reach an off-VPS destination when one is configured
When an off-VPS destination (Google Drive) is configured, every scheduled backup SHALL be uploaded to it, and an upload failure SHALL mark the backup's off-site status as failed and be logged without deleting the local copy.

#### Scenario: Drive upload fails
- **WHEN** a scheduled backup completes locally and the Drive upload fails
- **THEN** the backup is listed with off-site status failed and the local file remains

### Requirement: The backup page warns when no off-VPS destination exists
The backup settings page SHALL show a warning when automatic backups are enabled and no off-VPS destination is configured.

#### Scenario: Local only
- **WHEN** automatic backups are on and Drive is not configured
- **THEN** the page shows that backups exist only on the server
