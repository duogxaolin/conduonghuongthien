# Spec Delta

## Purpose

Keeps a single admin surface for managing moderation rules and the review queue, so behaviour and fixes do not diverge between two copies.

## ADDED Requirements

### Requirement: Moderation rules and queue are managed in one place
Managing moderation rules and resolving queue items SHALL be possible only on the moderation page. The AI panel SHALL show moderation counts and a link to that page and SHALL NOT offer its own rule or queue actions.

#### Scenario: AI panel moderation tab
- **WHEN** an admin opens the moderation tab of the AI panel
- **THEN** it shows pending-queue and active-rule counts and a link to the moderation page, with no approve, reject or rule-edit controls
