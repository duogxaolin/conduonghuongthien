# admin-dialogs Specification

## Purpose
Gives every admin modal dialog semantics and keyboard behaviour, so assistive technology announces it and keyboard users cannot fall behind it.

## Requirements

### Requirement: Admin modals are accessible dialogs
Every admin overlay that blocks the page SHALL have `role="dialog"`, `aria-modal="true"` and an accessible name; SHALL move focus inside when it opens; SHALL keep Tab focus inside while open; SHALL close on Escape unless an action is in progress; SHALL make the background inert; and SHALL return focus to the opener on close. Backdrops of side drawers are exempt only if named in the guard test with a reason.

#### Scenario: Create-user modal
- **WHEN** an admin opens the create-user modal
- **THEN** the dialog is announced with its title and Tab cycles only among its controls

#### Scenario: Escape
- **WHEN** the admin presses Escape while no save is in progress
- **THEN** the modal closes and focus returns to the button that opened it
