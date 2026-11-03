# Spec Delta

## Purpose

Bounds the on-demand video thumbnail extraction that public, unauthenticated requests can trigger.

## ADDED Requirements

### Requirement: Concurrent fallback extractions for one video share a single run
When several requests need the fallback thumbnail of the same video while none exists, the server SHALL start at most one extraction for that video and serve its result to all of them.

#### Scenario: Ten concurrent first requests
- **WHEN** ten requests for a video without a thumbnail arrive at once
- **THEN** exactly one extraction process is started

### Requirement: Fallback extraction is time-limited and failures are remembered
Each extraction SHALL be stopped after at most 15 seconds and its process killed. A failed or timed-out extraction for a video SHALL be remembered for at least 10 minutes, during which requests for that video receive the placeholder without starting a new extraction. The server SHALL also cap the number of simultaneous extractions across all videos.

#### Scenario: Corrupt video
- **WHEN** extraction for a video fails and a new request arrives 1 minute later
- **THEN** the placeholder is returned and no extraction process is started
