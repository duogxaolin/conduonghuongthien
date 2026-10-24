# rate-limiting Specification

## Purpose
Keeps the shared rate-limit counter table bounded and stops article view counts from being inflated from a single address.

## Requirements

### Requirement: Expired rate-limit counters are purged in bounded batches independently of data retention
Expired rate-limit counter rows SHALL be deleted on a periodic schedule of its own, in batches, until fewer than one batch remains or a per-run batch cap is reached. The purge MUST run whether or not automatic data retention is enabled and MUST NOT be skipped because another retention scope failed.

#### Scenario: Backlog larger than one batch
- **WHEN** 12 000 expired counter rows exist and the purge runs with a batch size of 5 000 and a cap of 10 batches
- **THEN** all 12 000 rows are deleted in that run

#### Scenario: Retention disabled
- **WHEN** automatic data retention is turned off
- **THEN** expired counter rows are still purged

### Requirement: Article view counting has a per-IP ceiling
The article view endpoint SHALL count at most 60 views per client IP (IPv6 grouped by /64) per 10 minutes across all articles, in addition to the existing per-article visitor dedupe. Requests over the ceiling SHALL still return 202 and MUST NOT increment any counter.

#### Scenario: Rotating user agents from one IP
- **WHEN** one IP sends 100 view requests for different articles with different user agents within 10 minutes
- **THEN** at most 60 real views are recorded and every response is 202
