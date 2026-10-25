# request-validation Specification

## Purpose
Makes malformed request bodies fail clearly and gives new endpoints one validation path, without rewriting legacy endpoints.

## Requirements

### Requirement: New endpoints reject malformed JSON with 400
Endpoints written after this change SHALL read JSON bodies through the shared body reader, which SHALL respond 400 with a stable message for a body that is not valid JSON or not an object, instead of treating it as an empty object.

#### Scenario: Truncated JSON
- **WHEN** a client sends `{"name":` to a new endpoint
- **THEN** the response is 400

### Requirement: New endpoints validate input against a declared schema
Endpoints written after this change SHALL validate their body and query against a declared schema and SHALL respond 400 naming the first invalid field. The number of legacy endpoints that read bodies without the shared reader SHALL NOT increase.

#### Scenario: Wrong type
- **WHEN** a new endpoint expecting `{ id: number }` receives `{ id: "x" }`
- **THEN** the response is 400 naming `id`

#### Scenario: Legacy baseline
- **WHEN** a developer adds a new handler that calls `readBody(event).catch(() => ({}))`
- **THEN** the repository test that tracks the baseline fails
