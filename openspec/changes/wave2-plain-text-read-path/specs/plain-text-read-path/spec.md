# Spec Delta

## Purpose

Removes the read-time guess that repairs truncated HTML entities once stored data has been repaired, keeping only exact entity decoding.

## ADDED Requirements

### Requirement: Read-time plain-text fields are decoded without truncation guessing
After the stored-excerpt repair has been applied in production, public and admin reads of `title` and `excerpt` SHALL decode complete HTML entities only and SHALL NOT remove or alter a trailing `&` sequence.

#### Scenario: Mixed string with a literal ampersand
- **WHEN** a stored title is `C&ocirc;ng ty AT&T`
- **THEN** the API returns `Công ty AT&T`
