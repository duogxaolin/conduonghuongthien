# Spec Delta

## Purpose

Ensures that only one moderation rescan runs at a time across replicas, even if the process loses its lock mid-run.

## ADDED Requirements

### Requirement: A rescan stops when it no longer holds its lock
Before each batch, a running moderation rescan SHALL confirm it still holds its named lock and SHALL stop with a logged reason when it does not.

#### Scenario: Lock connection dropped
- **WHEN** the database connection holding the rescan lock is closed during a run
- **THEN** the rescan stops before the next batch and logs that the lock was lost
