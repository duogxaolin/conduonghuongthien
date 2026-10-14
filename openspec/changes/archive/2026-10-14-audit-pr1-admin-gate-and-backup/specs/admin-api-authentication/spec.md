# Spec Delta

## Purpose

Defines how every request to the admin API is authenticated before any handler runs, so that no request path spelling can bypass the session, revocation and MFA-stage checks, and how authorization coverage of individual handlers is kept honest as handlers are added.

## ADDED Requirements

### Requirement: Admin API requests are identified by their decoded path

The system SHALL decide whether a request targets the admin API, and whether it targets an exempt login-flow endpoint, from the request path after percent-decoding and after removing the query string. The decision SHALL be the same one the router uses to select the handler, so that no spelling of a path can reach an admin handler without being treated as an admin request.

#### Scenario: Percent-encoded prefix still requires a session

- **WHEN** a request without a session cookie is sent to `/api/%61dmin/users`
- **THEN** the response is 401 and the route handler is not executed

#### Scenario: Percent-encoded segment still requires a session

- **WHEN** a request without a session cookie is sent to `/api/admin/%75sers`
- **THEN** the response is 401 and the route handler is not executed

#### Scenario: Query string does not change the decision

- **WHEN** a request without a session cookie is sent to `/api/admin/users?x=1`
- **THEN** the response is 401

#### Scenario: Dot segments do not escape the gate

- **WHEN** a request without a session cookie is sent to `/api/admin/users/%2e%2e/users` or `/api/admin/auth/login/../../users`
- **THEN** the response is 401 or the request is not routed to any admin handler, and in no case is an admin handler executed without a verified session

#### Scenario: Non-admin paths are untouched

- **WHEN** a request is sent to `/api/public/articles` or `/admin/login`
- **THEN** the gate does not apply and performs no token or database work

### Requirement: Only the login-flow endpoints are exempt

The system SHALL exempt from the session requirement exactly four endpoints: `/api/admin/auth/login`, `/api/admin/auth/captcha`, `/api/admin/auth/mfa/verify` and `/api/admin/auth/mfa/send-code`. Matching SHALL be exact on the decoded path. Look-alikes (trailing slash, extra suffix, sibling paths, differently encoded spellings of other endpoints) SHALL NOT be exempt.

#### Scenario: Exempt endpoint spelled with an encoded character

- **WHEN** an unauthenticated request is sent to `/api/admin/auth/log%69n`
- **THEN** the request is treated as the exempt login endpoint, exactly as `/api/admin/auth/login` is

#### Scenario: Look-alike endpoints stay protected

- **WHEN** an unauthenticated request is sent to `/api/admin/auth/login/`, `/api/admin/auth/loginx`, `/api/admin/auth/me` or `/api/admin/auth/logout`
- **THEN** the response is 401

### Requirement: Malformed path encoding fails closed

The system SHALL refuse a request whose path cannot be decoded (for example a malformed percent sequence) instead of falling back to a different spelling, when that path would otherwise be an admin API request.

#### Scenario: Broken percent sequence under the admin prefix

- **WHEN** a request is sent to `/api/admin/users%zz` without a session
- **THEN** the response is an error status (400 or 401) and no handler runs

### Requirement: A verified session is established before an admin handler runs

For every admin API request that is not exempt, the system SHALL require a signed session token whose user exists and is active, whose token generation matches the user's current generation, and whose stage is a full session (not an MFA challenge ticket), and SHALL attach the authenticated user and permissions to the request context before the handler runs.

#### Scenario: Valid session

- **WHEN** a request to an admin endpoint carries a valid session cookie for an active user
- **THEN** the handler runs with the user's identity and permissions available

#### Scenario: Revoked or inactive session

- **WHEN** the token generation no longer matches or the user is inactive
- **THEN** the response is 401 and a security log entry is written for the revoked session

#### Scenario: MFA challenge ticket is not a session

- **WHEN** a request presents an MFA challenge ticket as its session cookie
- **THEN** the response is 401 and a security log entry records that a challenge token was used as a session

### Requirement: Every admin handler enforces authorization or is a named exemption

Every handler under the admin API SHALL either enforce a permission check on its own request path (in the handler or in the service it calls) or be listed in an explicit exemption list that states the reason (for example "own-profile endpoint", "login flow", "super-admin-only check inline"). An automated check SHALL fail when a handler is neither.

#### Scenario: New handler without an authorization check

- **WHEN** a handler file is added under the admin API with no permission check and no exemption entry
- **THEN** the automated check fails and names the file

#### Scenario: Exemption list does not rot

- **WHEN** an exemption entry names a file that no longer exists or that now enforces a permission check
- **THEN** the automated check fails and asks for the entry to be removed
