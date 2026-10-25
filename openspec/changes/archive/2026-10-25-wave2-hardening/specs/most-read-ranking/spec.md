# Spec Delta

## Purpose

Ranks articles by total views from maintained per-article totals, so that "most read" lists cost the same regardless of how many view rows exist, while keeping real and fabricated views separable.

## ADDED Requirements

### Requirement: Per-article view totals equal the sum of daily view rows
Each article SHALL carry a real-view total and a fabricated-view total that always equal the sums of its daily view rows, updated in the same database operation that updates the daily rows (real view recording, instant boost and scheduled boost). At every boot, articles whose totals differ from the sums of their daily rows SHALL be reconciled to those sums (writing nothing when all totals already match), which covers existing articles at introduction and any drift left by running an older version. The totals SHALL be plain columns so that database dumps taken by any version restore.

#### Scenario: After a real view and a boost
- **WHEN** an article receives 1 real view and an instant boost of 50
- **THEN** its real total increased by 1, its fabricated total by 50, and both equal the sums over its daily rows

### Requirement: Most-read lists are served from the totals
The public article list sorted by views SHALL order by the per-article total (real + fabricated) descending, then publish date, using an index, and MUST NOT aggregate daily view rows per request.

#### Scenario: Order
- **WHEN** article A has totals 10 + 5 and article B has 12 + 0
- **THEN** A is listed before B
