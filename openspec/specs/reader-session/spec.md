# reader-session Specification

## Purpose
Defines what signing out means for a reader session so that a copied reader token stops working when the reader signs out.

## Requirements

### Requirement: Reader sign-out revokes every session of that reader
When a signed-in reader signs out, the system SHALL invalidate every reader session token issued to that reader before the sign-out, in addition to clearing the cookie. A sign-out request without a valid reader session SHALL only clear the cookie.

#### Scenario: Replay after sign-out
- **WHEN** a reader signs in, copies the session token, signs out, and a request is made with the copied token
- **THEN** the request is treated as anonymous

#### Scenario: Anonymous sign-out
- **WHEN** a request without a reader session calls sign-out
- **THEN** the response succeeds and no reader account is modified
