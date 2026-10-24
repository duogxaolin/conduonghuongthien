# ci-pipeline Specification

## Purpose
Ensures every real-database integration suite in the repository actually runs in CI with the configuration it needs.

## Requirements

### Requirement: Every integration suite is registered in the CI matrix
Every file matching `tests/*-integration.test.ts` SHALL have an entry in the CI integration matrix, and every environment variable the suite reads SHALL be provided in each CI step that runs the suite. A repository test SHALL fail when a suite is missing from the matrix or from any of those steps.

#### Scenario: New suite added without CI wiring
- **WHEN** a developer adds `tests/foo-integration.test.ts` and does not add it to the matrix
- **THEN** the unit test job fails naming the file

### Requirement: The skipped-suite check does not re-run the suite
The CI step that fails a matrix job whose suite silently skipped SHALL decide from the output of the run that already happened, without executing the suite a second time.

#### Scenario: Suite ran
- **WHEN** the integration step ran the suite once and all tests executed
- **THEN** the skip check passes without starting the suite again
