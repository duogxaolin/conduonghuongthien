# seed-defaults Specification

## Purpose
Seeds default rows once per database so that defaults staff delete stay deleted across restarts.

## Requirements

### Requirement: Each default group is seeded once per database
For each seed group (moderation rules, social links, media categories, content types, article categories), the boot seed SHALL insert each versioned default set of the group only if that set has never been seeded in this database, and SHALL then record that set as seeded; a default set added in a later release SHALL reach existing databases once. On the first boot after this rule is introduced, a group whose table already has rows SHALL be recorded as seeded without inserting. The seeded markers MUST NOT be returned by any settings read.

#### Scenario: Deleted default stays deleted
- **WHEN** an admin deletes a default moderation rule and the container restarts
- **THEN** the rule is not recreated

#### Scenario: Fresh database
- **WHEN** a new database boots for the first time
- **THEN** every group's defaults are inserted and each group is marked seeded
