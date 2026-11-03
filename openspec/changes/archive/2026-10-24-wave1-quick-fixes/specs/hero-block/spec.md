# Spec Delta

## Purpose

Makes the home hero block's buttons follow what the editor configured in the page builder, without changing pages that were saved with the defaults.

## ADDED Requirements

### Requirement: Hero buttons render the configured text and link
The hero block SHALL render each button's text and link from the block data, in the same order the hero title uses: on a Vietnamese page, the block's own value, then the built-in default; on another language, that language's translation of the block, then the UI dictionary, then the built-in default (the block's own value is Vietnamese and is not shown on other languages). A button whose configured text is an empty string SHALL not be rendered. Links pass the page-builder link policy.

#### Scenario: English page without a translation
- **WHEN** an editor set the Vietnamese help text to "Liên hệ hỗ trợ" and no English translation exists
- **THEN** the English page shows the dictionary label, not the Vietnamese text

#### Scenario: Editor changes the help button
- **WHEN** an editor sets the help button text to "Liên hệ hỗ trợ" and link to "/contact" and publishes
- **THEN** the public hero shows "Liên hệ hỗ trợ" linking to "/contact"

#### Scenario: Editor clears a button
- **WHEN** an editor sets the about button text to an empty string
- **THEN** the about button is not rendered

### Requirement: Pages saved with the old defaults keep today's labels
A stored button value equal to the previous registry default SHALL be treated as not configured, so that pages saved before this change keep showing today's labels.

#### Scenario: Untouched existing home page
- **WHEN** the home page's hero data still holds the previous registry defaults
- **THEN** the buttons show the same labels and links as before this change
