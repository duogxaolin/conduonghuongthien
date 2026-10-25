# schema-upgrade-safety Specification

## Purpose
Proves on a real database that booting a new release on a previous release's data keeps that data, so migration regressions are caught in CI instead of in production.

## Requirements

### Requirement: Booting on a previous release's database preserves its rows
CI SHALL load a snapshot of the previous release's schema with representative rows in every table touched by an additive migration, run the boot sequence twice, and fail if any row value changed other than by a one-time conversion that is declared in the test with a reason.

#### Scenario: Unguarded data write reintroduced
- **WHEN** a migration that unconditionally updates a column is added
- **THEN** the upgrade suite fails naming the table and column

#### Scenario: Declared conversion
- **WHEN** a migration performs a declared one-time conversion
- **THEN** the suite passes and the second boot changes nothing
