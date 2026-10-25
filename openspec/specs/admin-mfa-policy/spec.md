# admin-mfa-policy Specification

## Purpose
Lets a SuperAdmin require multi-factor authentication for privileged admin accounts, with a staged rollout and an emergency off switch, without locking operators out.

## Requirements

### Requirement: A SuperAdmin sets the MFA policy
The MFA policy SHALL be one of `off`, `privileged` or `all`, settable only by a SuperAdmin through a dedicated endpoint, and MUST NOT be writable through the general settings update. `privileged` covers SuperAdmins and every account whose role holds update or delete on users, roles, settings or backups. Changing the policy SHALL be audited and SHALL record an enforcement start 14 days later.

#### Scenario: Non-SuperAdmin tries to change the policy
- **WHEN** an admin with `settings.update` but not SuperAdmin sends a policy change
- **THEN** the response is 403 and the policy is unchanged

### Requirement: Covered accounts without an active factor are limited to enrollment after the grace period
After the enforcement start, every authenticated admin request from a covered account with no active MFA factor SHALL be refused with 403 and a distinct code, except requests to session, logout, profile password and MFA enrollment endpoints. Before the enforcement start, covered accounts without a factor SHALL be told when enforcement begins. When the environment sets `MFA_ENFORCEMENT=0`, no request SHALL be refused by this rule.

#### Scenario: After grace, no factor
- **WHEN** the policy is `privileged`, the grace period has ended, and a SuperAdmin without a factor calls `GET /api/admin/users`
- **THEN** the response is 403 with the enrollment-required code

#### Scenario: Enrollment still reachable
- **WHEN** the same account calls the MFA enrollment endpoint
- **THEN** the request is allowed

#### Scenario: Kill switch
- **WHEN** `MFA_ENFORCEMENT=0` is set
- **THEN** the same `GET /api/admin/users` request is allowed

### Requirement: Enrollment under enforcement produces recovery codes
When an account covered by a non-`off` policy confirms its first factor, the system SHALL generate recovery codes in the same flow and SHALL show them once.

#### Scenario: First factor confirmed
- **WHEN** a covered account confirms a TOTP factor
- **THEN** the response includes newly generated recovery codes
