# analytics-retention Specification

## Purpose
Guarantees that analytics retention actually removes expired raw and aggregate rows, never removes raw rows of a day that was not aggregated, and makes any failure visible in the logs.

## Requirements

### Requirement: Raw page-view events are purged in bounded batches after their day is aggregated
Each maintenance run SHALL delete raw page-view events older than the configured raw retention whose day has a completed aggregation run, in batches of the configured size up to the configured batch cap. Raw events of a day without a completed aggregation MUST NOT be deleted. The statements used MUST be valid on MySQL 8.

#### Scenario: Old aggregated events are purged
- **WHEN** events older than the raw retention exist for a day with a completed run, and maintenance runs on real MySQL
- **THEN** those events are deleted and the run does not report a retention warning

#### Scenario: Old events of an unaggregated day are kept
- **WHEN** events older than the raw retention exist for a day without a completed run
- **THEN** those events remain after maintenance

### Requirement: Each retention step runs and reports independently
The purge of raw events, of each daily aggregate table and of old maintenance runs SHALL each run even if another step failed in the same run, and every failed step SHALL write one log line naming the step and the error code.

#### Scenario: One step fails
- **WHEN** the raw-event purge throws
- **THEN** the daily aggregate tables are still purged and a log line names the raw-event step
