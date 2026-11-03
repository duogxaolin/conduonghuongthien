# Spec Delta

## Purpose

Limits how often public pages ask the server whether a livestream is active.

## ADDED Requirements

### Requirement: Live status is not polled from hidden tabs or where it is not shown
The live-status ticker SHALL stop polling while the document is hidden and SHALL poll once immediately when it becomes visible again. It SHALL NOT poll on pages where the ticker is not shown (the media section).

#### Scenario: Background tab
- **WHEN** a visitor switches to another tab for 5 minutes
- **THEN** no live-status request is sent from the hidden tab during those 5 minutes

### Requirement: The active-livestream endpoint answers from a short cache
The public active-livestream endpoint SHALL serve repeated requests within a few seconds (at most 5) from an in-process cache instead of querying the database each time, and a start or stop of a livestream SHALL be visible within that window.

#### Scenario: Burst of requests
- **WHEN** 100 requests arrive within one second
- **THEN** the database is queried at most once for them
