# boot-seed Specification

## Purpose
Defines what the seed that runs on every container start may change, so that a restart never reverts edits staff made to seeded rows.

## Requirements

### Requirement: Boot seed does not overwrite staff-edited ordering
The seed run at container start SHALL insert missing default `home_sections` rows only and MUST NOT change `display_order` (or any other column) of an existing row.

#### Scenario: Reordered legacy home section survives restart
- **WHEN** an admin changes a home section's display order and the container restarts
- **THEN** the display order is unchanged
