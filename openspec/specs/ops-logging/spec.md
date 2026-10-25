# ops-logging Specification

## Purpose
Keeps application logs across container recreation and makes selected security events reach an operator.

## Requirements

### Requirement: Application logs survive container recreation
The app container's logs SHALL be written to a host-level log store that is not deleted when the container is removed, with bounded retention configured on the host.

#### Scenario: Deploy
- **WHEN** a deploy recreates the app container
- **THEN** log lines written before the deploy can still be read on the host

### Requirement: Selected security events are sent to an operator, rate-limited
When `OPS_ALERT_EMAIL` is set, each occurrence of an allowlisted security event SHALL trigger an e-mail to that address, at most one per event name per 15 minutes, containing the event name, time and non-secret context only. A failure to send MUST NOT affect the request that logged the event.

#### Scenario: Repeated restore failures
- **WHEN** `backup.restore_failed` is logged three times within 5 minutes
- **THEN** exactly one alert e-mail is sent for it in that window

#### Scenario: Not configured
- **WHEN** `OPS_ALERT_EMAIL` is unset
- **THEN** no alert e-mail is attempted
