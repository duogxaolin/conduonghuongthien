# page-builder-links Specification

## Purpose
Defines which URL schemes block and navigation link fields may hold, so that a delegated page editor cannot plant script that runs in the portal's origin when a visitor or admin clicks.

## Requirements

### Requirement: Link fields accept only safe URL forms
Every block field declared as a link in the block registry, every `links[].url`, and every navigation item URL SHALL be accepted only when it is a site-relative path (starting with a single `/`), a fragment (`#…`), or an absolute `http:`, `https:`, `mailto:` or `tel:` URL. Scheme matching MUST ignore case, leading/trailing whitespace, embedded control characters and HTML entity encoding. Any other value (including `javascript:`, `data:`, `vbscript:` and protocol-relative `//host`) SHALL be rejected on write with a 400 that names the field, and SHALL be replaced by an empty link on public read for rows stored before this rule.

#### Scenario: Script URL rejected on save
- **WHEN** an editor saves a Links block whose item URL is `JaVa\tScRiPt:alert(1)`
- **THEN** the save fails with 400 naming the field and nothing is stored

#### Scenario: Legacy stored script URL neutralised on read
- **WHEN** a page stored before this rule has a hero button link `javascript:alert(1)` and a visitor loads the page
- **THEN** the public JSON carries an empty link for that field and the rendered anchor has no `href` with that value

#### Scenario: Protocol-relative navigation URL rejected
- **WHEN** an admin saves a navigation item with URL `//evil.example/path`
- **THEN** the save fails with 400

#### Scenario: Ordinary links still accepted
- **WHEN** link fields hold `/about`, `#tro-giup`, `https://example.gov.vn/x`, `mailto:a@b.vn` and `tel:+84123`
- **THEN** all are stored and rendered unchanged
