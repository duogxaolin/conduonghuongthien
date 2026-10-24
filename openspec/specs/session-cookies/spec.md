# session-cookies Specification

## Purpose
Defines when the admin, MFA, reader and OAuth-state cookies carry the `Secure` attribute, so that a misconfigured proxy cannot silently downgrade production cookies.

## Requirements

### Requirement: Session cookies are Secure in production unless a trusted proxy reports plain HTTP
In production, the admin session, MFA ticket, reader session and OAuth state cookies SHALL carry `Secure`, except when the immediate peer is a configured trusted proxy that explicitly reports `x-forwarded-proto: http`. A forwarded-protocol header from a peer that is not a configured trusted proxy MUST be ignored. Outside production, `Secure` SHALL be set exactly when the request URL is `https:` or a configured trusted proxy reports `https`.

#### Scenario: Proxy omits the forwarded header in production
- **WHEN** a production request arrives through the trusted loopback proxy without `x-forwarded-proto`
- **THEN** the session cookie is set with `Secure`

#### Scenario: Untrusted peer claims https in development
- **WHEN** in development a request over plain HTTP from a peer that is not a trusted proxy sends `x-forwarded-proto: https`
- **THEN** the cookie is set without `Secure`

#### Scenario: Trusted proxy reports http in production
- **WHEN** in production the trusted proxy sends `x-forwarded-proto: http`
- **THEN** the cookie is set without `Secure`
