# Spec Delta

## Purpose

Defines when a reply-notification e-mail may be sent and what it may say, so that abusive replies are never mailed before moderation and a reader-chosen name cannot pose as staff in a subject line.

## ADDED Requirements

### Requirement: Reply e-mails are sent only after the reply passes moderation
A notification e-mail for a reader reply SHALL be sent only after the full content moderation of that reply has completed and has not hidden or blocked it. A reply hidden or blocked by moderation MUST NOT produce an e-mail. A moderation failure (error or timeout) MUST NOT send the e-mail and SHALL be logged.

#### Scenario: Reply blocked by AI moderation
- **WHEN** a reader replies with content the AI moderation flags as auto-hide
- **THEN** no reply e-mail is sent to the parent comment's author

#### Scenario: Clean reply
- **WHEN** a reader posts a reply that moderation allows
- **THEN** the parent comment's author (with e-mail notifications on) receives the reply e-mail

### Requirement: Reader reply e-mail subjects do not contain the reader-chosen name
The subject of an e-mail about a reply written by a reader SHALL be a fixed neutral text that does not include the replier's display name. Replies written by staff keep the staff subject.

#### Scenario: Reader named like staff
- **WHEN** a reader whose display name is "Ban quản trị" replies
- **THEN** the e-mail subject does not contain "Ban quản trị"
