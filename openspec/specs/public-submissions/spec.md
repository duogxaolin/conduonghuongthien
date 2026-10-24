# public-submissions Specification

## Purpose
Defines where the recipient of a citizen submission may come from and what contact details public page data may expose, so that unpublished or hidden content can never redirect citizen data.

## Requirements

### Requirement: Submission recipients come only from published, visible form blocks
The set of configured submission recipients SHALL be built only from contact and support form blocks that are live on the public site: nodes of a page's published block tree that are visible (including every ancestor container), or, for a page with no published tree, visible rows of the legacy flat block table. Draft trees, hidden nodes and legacy flat rows of a page that has a published tree MUST NOT contribute.

#### Scenario: Recipient only in a draft
- **WHEN** a page's draft tree contains a support form with `recipientEmail` set and no published block names that address, and a citizen submits the form
- **THEN** the submission is not sent to that address and falls back to the site e-mail

#### Scenario: Hidden block
- **WHEN** a published contact form node has `isVisible = false` and carries a recipient
- **THEN** that recipient is not in the configured set

#### Scenario: Stale flat row on a tree-published page
- **WHEN** a page has a published tree and its legacy flat rows still hold a form with a recipient
- **THEN** that recipient is not in the configured set

#### Scenario: Published recipient still honoured
- **WHEN** exactly one visible published form names a recipient
- **THEN** a submission from that form is delivered to that recipient

### Requirement: Public page data does not expose form recipients
The public page endpoint SHALL omit `recipientEmail` from every block it returns, including blocks nested in containers and per-language translations.

#### Scenario: Public page with a contact form
- **WHEN** a visitor loads a page whose contact form block has `recipientEmail` set
- **THEN** the JSON response contains no `recipientEmail` field
