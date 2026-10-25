# Spec Delta

## Purpose

Applies the reserved display-name rule to names supplied by the identity provider without blocking sign-in.

## ADDED Requirements

### Requirement: A reserved provider name is replaced by a neutral name
When a reader signs in and the provider-supplied display name folds to a reserved term (same folding as reader-chosen names), the system SHALL show the neutral name "Bạn đọc" for that reader until the reader chooses a custom name, and sign-in SHALL succeed.

#### Scenario: Google name "Admin"
- **WHEN** a reader whose Google profile name is "Admin" signs in
- **THEN** sign-in succeeds and their comments show "Bạn đọc"
