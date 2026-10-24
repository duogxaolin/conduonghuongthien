# Spec Delta

## Purpose

Defines which stored settings the admin settings read endpoints may return and guarantees that stored credentials never leave the server in readable form, whatever the caller's role.

## ADDED Requirements

### Requirement: The general settings read returns only allowlisted keys
`GET /api/admin/settings` SHALL return only keys on an explicit allowlist of values the settings pages render. A key added to the `settings` table later MUST NOT appear in the response until it is added to the allowlist.

#### Scenario: Unknown key is not returned
- **WHEN** the `settings` table contains a key that is not on the allowlist and a user with `settings.read` calls the endpoint
- **THEN** the response does not contain that key

#### Scenario: Backup and video-storage keys are not returned
- **WHEN** `backup_drive_service_account`, any `backup_*`, `retention_*` or `media_video_r2_*` key is stored
- **THEN** none of them appears in the general settings response

### Requirement: Stored credentials are masked for every role
Every response that reports a stored credential (`backup_drive_service_account`, `r2_secret_key`, `media_video_r2_secret_key`, `smtp_pass`) SHALL replace its value with the mask `********` when a value is stored, for every caller including a SuperAdmin. Saving the mask back MUST keep the stored value.

#### Scenario: SuperAdmin reads backup settings
- **WHEN** a SuperAdmin calls `GET /api/admin/settings/backup` while a service-account JSON is stored
- **THEN** the field is `********` and no part of the JSON (including `private_key`) appears in the response

#### Scenario: Form round trip keeps the secret
- **WHEN** the backup settings form is saved with the service-account field still `********`
- **THEN** the stored service-account JSON is unchanged
