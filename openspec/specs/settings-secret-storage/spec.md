# settings-secret-storage Specification

## Purpose
Keeps stored mail, object-storage and backup credentials unreadable in the database and in database backups, while letting the app use them.

## Requirements

### Requirement: Stored credentials are encrypted at rest
`smtp_pass`, `r2_secret_key` and `backup_drive_service_account` SHALL be stored only as authenticated-encryption envelopes bound to a per-key context label, derived from the deployment's encryption secret. Saving a new value SHALL store an envelope; reading for use SHALL decrypt; no API response SHALL include the envelope or the plaintext.

#### Scenario: Saving the SMTP password
- **WHEN** an admin saves a new SMTP password
- **THEN** the `settings` row holds an envelope that does not contain the password text, and sending a test e-mail succeeds

### Requirement: Existing plaintext credentials are converted once
At boot, a credential value that is not an envelope SHALL be encrypted in place; a value that is already an envelope SHALL be left unchanged. A value that cannot be decrypted (for example after the encryption secret was rotated) SHALL be reported as needing re-entry and MUST NOT be overwritten.

#### Scenario: Upgrade
- **WHEN** a database with a plaintext `r2_secret_key` boots twice
- **THEN** after the first boot the row holds an envelope and the second boot changes nothing

#### Scenario: Secret rotated
- **WHEN** the encryption secret changed and the stored envelope cannot be decrypted
- **THEN** the settings page reports the credential as needing re-entry and the stored row is unchanged
