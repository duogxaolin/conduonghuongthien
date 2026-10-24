# ops-monitoring Specification

## Purpose
Lets an external monitor know that host-side backup and restore-verification jobs completed, so a silent failure becomes an alert.

## Requirements

### Requirement: Backup and restore verification report success to an optional ping URL
When `HEALTHCHECK_PING_URL` is set, the database backup script and the restore-verification script SHALL request that URL after a successful run and request its failure variant (`/fail` suffix) after a failed run. A failure to reach the ping URL MUST NOT change the script's own exit status. When the variable is unset, the scripts SHALL behave as before.

#### Scenario: Successful backup
- **WHEN** the backup script completes successfully with the ping URL set
- **THEN** one request is made to the ping URL

#### Scenario: Ping endpoint unreachable
- **WHEN** the backup succeeds but the ping URL cannot be reached
- **THEN** the script still exits 0
