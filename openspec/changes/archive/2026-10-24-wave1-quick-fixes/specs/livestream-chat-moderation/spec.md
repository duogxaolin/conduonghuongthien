# Spec Delta

## Purpose

Keeps livestream chat messages hidden by AI moderation as auditable evidence instead of deleting them.

## ADDED Requirements

### Requirement: AI-hidden livestream messages are soft-deleted only
When AI moderation decides to auto-hide a livestream chat message, the message SHALL be marked deleted and kept with its author, IP and timestamp; it MUST NOT be removed from the database by that decision. Public chat history SHALL NOT show it.

#### Scenario: Auto-hidden message
- **WHEN** moderation returns an auto-hide verdict for a livestream message
- **THEN** the row still exists with `is_deleted = 1` and does not appear in the public history
