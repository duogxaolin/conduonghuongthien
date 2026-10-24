# public-accessibility Specification

## Purpose
Sets the accessibility baseline for public pages: visible keyboard focus, one top-level heading, user control over motion, and correct focus handling in the chat dialog.

## Requirements

### Requirement: Keyboard focus indicators meet contrast on public pages
Focus indicators on public pages SHALL use `#4A6741` on light backgrounds and a white ring with offset on dark green backgrounds; `#7CB342` MUST NOT be used for any focus ring, outline or focus border.

#### Scenario: Focus ring class audit
- **WHEN** the public components are scanned for focus-prefixed ring, outline or border classes
- **THEN** none uses `#7CB342`

### Requirement: Each public page has exactly one level-one heading
Every public page rendered with the default layout SHALL contain exactly one `<h1>`. The site brand in the header MUST NOT be an `<h1>`.

#### Scenario: Article page
- **WHEN** an article page is rendered
- **THEN** it contains exactly one `<h1>`, the article title

#### Scenario: Home page with a hero block
- **WHEN** the home page has a hero block
- **THEN** the hero title is the only `<h1>`

### Requirement: Auto-advancing content can be paused and respects reduced motion
An auto-advancing carousel SHALL provide a visible pause/play control whose state only the user changes, SHALL pause while it contains focus, while hovered, while touched and while the document is hidden (each pause lasting until that condition ends, except that pressing play resumes immediately and stays resumed until the next focus, hover or touch), SHALL never resume while the document is hidden, and SHALL NOT auto-advance or animate scrolling when the user prefers reduced motion. Continuous marquee animations SHALL stop under reduced motion.

#### Scenario: Reduced motion
- **WHEN** a visitor with `prefers-reduced-motion: reduce` opens the home page
- **THEN** the role-models carousel does not advance on its own and the live ticker text does not scroll

#### Scenario: Pause control
- **WHEN** a keyboard user activates the pause control
- **THEN** the carousel stops advancing until play is activated

#### Scenario: Tapping pause on a touch screen
- **WHEN** a visitor on a phone taps the pause control and then moves focus out of the carousel
- **THEN** the control shows "play" and the carousel does not advance until play is tapped

### Requirement: The chat dialog keeps focus inside while open
When the chat dialog opens, focus SHALL move to the first visible control inside it on every viewport; while open, content outside the dialog SHALL be inert; Escape SHALL close it from anywhere on the page; on close, focus SHALL return to the control that opened it.

#### Scenario: Mobile open
- **WHEN** the chat opens on a 375 px wide viewport
- **THEN** the focused element is a visible control inside the dialog

#### Scenario: Tab from the launcher
- **WHEN** focus is on the launcher outside the dialog after opening and the user presses Tab
- **THEN** focus lands inside the dialog
