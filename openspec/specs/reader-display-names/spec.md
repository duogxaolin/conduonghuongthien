# reader-display-names Specification

## Purpose
Prevents readers from choosing display names that pose as portal staff or authorities, including look-alike spellings.

## Requirements

### Requirement: Reserved display names are rejected after folding
A reader-chosen display name SHALL be compared, after Unicode NFKC normalisation, case folding, Vietnamese diacritic removal and removal of zero-width and bidirectional control characters, against a reserved list of staff and authority terms (at least: "ban quan tri", "quan tri vien", "admin", "administrator", "moderator", "c11", "bo cong an", "con duong huong thien"). A name whose folded form equals a reserved term or starts or ends with one as a separate word SHALL be rejected with 400 and a message naming the rule. Names containing zero-width or bidirectional control characters SHALL be rejected.

#### Scenario: Exact reserved name
- **WHEN** a reader sets the display name "Ban Quản Trị"
- **THEN** the request fails with 400

#### Scenario: Look-alike with zero-width space
- **WHEN** a reader sets "Ban qu​ản trị"
- **THEN** the request fails with 400

#### Scenario: Ordinary name containing a reserved word inside another word
- **WHEN** a reader sets "Nguyễn Văn Adminh"
- **THEN** the name is accepted
