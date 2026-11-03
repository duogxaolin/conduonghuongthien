# csrf-protection Specification

## Purpose
Refuses state-changing API requests that a browser sends on behalf of another site, so that a page on a sibling subdomain cannot act with an admin's or reader's cookies.

## Requirements

### Requirement: Cross-site state-changing API requests are refused
For `POST`, `PUT`, `PATCH` and `DELETE` requests to `/api/**`, the server SHALL respond 403 without running the handler when `Sec-Fetch-Site` is present and is neither `same-origin` nor `none`; or, when `Sec-Fetch-Site` is absent, when `Origin` is present and its host is not the request host (resolved through the trusted-proxy rules), the host of `PUBLIC_BASE_URL`, or a host in `PUBLIC_HOST_ALLOWLIST`. `Origin: null` SHALL be refused. A request carrying neither header SHALL be allowed. `GET`, `HEAD` and `OPTIONS` SHALL never be refused by this rule.

#### Scenario: Form post from a sibling subdomain
- **WHEN** a browser on `https://other.delify.vn` submits a form to `POST /api/admin/users` with the admin's cookie and `Sec-Fetch-Site: same-site`
- **THEN** the response is 403 and no user is created

#### Scenario: Same-origin fetch
- **WHEN** the admin UI on the production host sends `PUT /api/admin/settings` with `Sec-Fetch-Site: same-origin`
- **THEN** the request reaches the handler

#### Scenario: Scripted client
- **WHEN** a cron job sends `POST` with neither `Sec-Fetch-Site` nor `Origin`
- **THEN** the request reaches the handler

#### Scenario: Null origin
- **WHEN** a request sends `Origin: null` and no `Sec-Fetch-Site`
- **THEN** the response is 403
