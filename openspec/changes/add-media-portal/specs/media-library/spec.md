# Spec Delta

## Purpose

Gives the portal a public video channel of its own — a browsable gallery of published videos that plays on the portal rather than sending readers to a third-party site, and that surfaces a live broadcast at the top of the page while one is running.

## ADDED Requirements

### Requirement: Published media listing

The portal SHALL expose a public listing of media items whose status is published, newest first, and SHALL never include items in any other status.

#### Scenario: Draft items are absent
- **WHEN** an anonymous visitor requests the media listing
- **THEN** the response contains only items whose status is `published`, and an item in `draft` or `archived` status does not appear in any page of the result

#### Scenario: Empty library is a valid state
- **WHEN** no media item has been published yet
- **THEN** the listing returns an empty result with a successful status, and the page renders an empty-state message rather than an error

#### Scenario: Query failure is distinguishable from an empty library
- **WHEN** the listing query fails
- **THEN** the response reports failure, and the page renders an error branch with a retry control that re-runs the same listing request, so that a failed query is never displayed as "nothing has been published"

### Requirement: Category filter and search on the listing

The listing SHALL support filtering by category and searching by title, both carried in the URL so that a filtered view can be shared and survives a reload.

#### Scenario: Filter is preserved across reload
- **WHEN** a visitor opens the listing with a category and a search term in the query string and reloads the page
- **THEN** the same filters are applied and the same result set is shown

#### Scenario: Unknown category yields an empty listing
- **WHEN** the category value in the URL does not match any category
- **THEN** the request succeeds and returns an empty result, rather than an error — a stale shared link must not read as a broken portal

#### Scenario: Pagination values are validated
- **WHEN** the page parameter is not a positive finite number (including values such as `abc`, `0`, `-1`, and `1e999`)
- **THEN** the server falls back to the first page and returns a numeric page value, never `null` or a server error

#### Scenario: Category counts reflect published items only
- **WHEN** the listing reports how many items belong to each category
- **THEN** each count includes only published items, so that a category shown with a non-zero count never opens onto an empty result

### Requirement: Media detail page

The portal SHALL serve a detail page for each published media item addressed by its slug, and SHALL NOT serve items that are not published.

#### Scenario: Published item resolves
- **WHEN** a visitor requests the detail page of a published item by its slug
- **THEN** the page shows the item's title, description, duration, thumbnail, category, and player

#### Scenario: Unpublished or unknown slug does not resolve
- **WHEN** a visitor requests the detail page of an item that is a draft, archived, or does not exist
- **THEN** the portal responds as not found, and does not reveal whether an item with that slug exists in another status

### Requirement: Player selection by media source

The detail page SHALL choose its playback mechanism from the item's source, using an adaptive-bitrate player for self-hosted video and an embedded third-party player for externally hosted video, and SHALL load the playback library only on media pages.

#### Scenario: Self-hosted item plays adaptively
- **WHEN** a visitor opens a published self-hosted item whose renditions are ready
- **THEN** the player streams the item from the portal's own origin using an adaptive-bitrate manifest

#### Scenario: Externally hosted item embeds
- **WHEN** a visitor opens a published item sourced from an external video platform
- **THEN** the page embeds that platform's privacy-preserving player for the item's external identifier

#### Scenario: Playback library is not in the global bundle
- **WHEN** a page outside the media section is built and loaded
- **THEN** neither playback library is loaded, and both are fetched only after a media page mounts

### Requirement: Rendition selection and fallback

The player SHALL offer the renditions that are ready for an item, and SHALL fall back to the highest ready rendition when the item is not yet fully processed.

#### Scenario: Partially processed item is playable
- **WHEN** a published item has one or more renditions ready but not all
- **THEN** the player starts from the highest ready rendition and plays without waiting for the remaining renditions

#### Scenario: No rendition ready
- **WHEN** a published item has no rendition ready
- **THEN** the page shows an explanatory message instead of a player that would fail to start

### Requirement: Third-party asset isolation

Media pages SHALL NOT cause a reader's browser to contact a third-party asset host for thumbnails or embedded playback, except the privacy-preserving embed domain of the item's source platform.

#### Scenario: Thumbnail is served from the portal origin
- **WHEN** a listing or detail page displays the thumbnail of an externally sourced item
- **THEN** the thumbnail URL resolves to the portal's own origin, and no request is made to the external platform's image host

#### Scenario: Embed uses the privacy-preserving domain
- **WHEN** the page embeds an externally hosted item
- **THEN** the embed URL uses the source platform's no-cookie domain

### Requirement: View counting

The portal SHALL count a view of a media item once per visitor per day, counted from the reader's browser after the page mounts, and SHALL NOT count views during server-side rendering.

#### Scenario: Repeat views in the same day count once
- **WHEN** the same visitor opens the same media item several times within one day
- **THEN** the item's view count increases by one

#### Scenario: Cached pages do not suppress counting
- **WHEN** a media detail page is served from cache to a second visitor
- **THEN** that visitor's view is still counted, because the counting request originates from the browser after mount

#### Scenario: Counting failure never breaks the page
- **WHEN** the counting request fails or is rejected
- **THEN** the page continues to render normally and no error is shown to the reader

#### Scenario: Response does not disclose whether the item exists
- **WHEN** the counting request is made for an unknown, unpublished, or malformed target, or without the secret the counter needs
- **THEN** the endpoint responds with the same accepted status it returns for a successful count

### Requirement: Livestream hero on the media listing

The media listing SHALL promote the currently active livestream when one exists, and SHALL show a default hero when none is active.

#### Scenario: Active session is promoted
- **WHEN** a visitor opens the media listing while a session is active
- **THEN** the page shows a hero linking to the live broadcast, above the video listing

#### Scenario: No active session
- **WHEN** a visitor opens the media listing while no session is active
- **THEN** the page shows the default hero, and the hero's live-state request is made from the browser after mount rather than being rendered on the server

#### Scenario: Live-state request fails
- **WHEN** the live-state request fails
- **THEN** the page falls back to the default hero and the listing below remains usable

### Requirement: Media section navigation

The media section SHALL be reachable from the site navigation on both the desktop header and the mobile drawer, with a label in every supported language.

#### Scenario: Present on both surfaces
- **WHEN** the navigation is rendered
- **THEN** the media entry appears in both the desktop header and the mobile drawer

#### Scenario: Navigation configuration degrades safely
- **WHEN** an administrator saves a navigation configuration that omits or malforms the media entry
- **THEN** the portal falls back to its default navigation, and the media section remains reachable

#### Scenario: Labels exist for every supported language
- **WHEN** the visitor switches the interface language
- **THEN** the media entry shows a label in that language rather than a raw key

### Requirement: Listing page states

The media listing and detail pages SHALL provide distinct loading, error, and empty states, and the loading state SHALL respect the reader's reduced-motion preference.

#### Scenario: Loading state is announced
- **WHEN** a media page is loading data
- **THEN** the loading container is marked busy and carries a screen-reader label, and its placeholder shapes are hidden from assistive technology

#### Scenario: Error state is announced and recoverable
- **WHEN** a media page fails to load its data
- **THEN** the error is announced as an alert and offers a retry that re-runs the failed request rather than reloading the whole page

#### Scenario: Reduced motion is honoured
- **WHEN** the reader has requested reduced motion
- **THEN** loading placeholders on media pages do not animate
