# Spec Delta

## Purpose

Extends the portal's existing public commenting to video items, so that a reader can ask a question under a video and be told when someone answers — using one commenting engine for both articles and videos rather than a second, parallel one that would quietly lack notifications, email, rate limiting, and moderation history.

## ADDED Requirements

### Requirement: Comments are enabled per media item

Commenting on a media item SHALL be off by default and SHALL be enabled per item by an administrator.

#### Scenario: New item has comments off
- **WHEN** a media item is created
- **THEN** its commenting flag is off, and the public detail page shows no comment thread

#### Scenario: Enabling comments
- **WHEN** an administrator enables commenting on a media item
- **THEN** the public detail page shows the comment thread and accepts new comments

#### Scenario: Disabling hides but does not delete
- **WHEN** an administrator disables commenting on a media item that already has comments
- **THEN** the public page stops showing the thread and stops accepting new comments, while existing comments and replies remain stored and remain visible to administrators

#### Scenario: Bulk default for new items
- **WHEN** an administrator sets a default commenting state for newly created media items
- **THEN** subsequently created items take that default, and existing items are unchanged

### Requirement: Comment thread on a media detail page

The portal SHALL display and accept comments on a published media item whose commenting is enabled, and SHALL load the thread from the browser after the page mounts.

#### Scenario: Thread loads after mount
- **WHEN** a reader opens a media detail page
- **THEN** the comment thread is requested from the reader's browser after mount, so that a cached page never serves one reader's comment state to another

#### Scenario: Reader identity is not rendered on the server
- **WHEN** a media detail page is served from cache
- **THEN** the response contains no reader identity and no per-comment delete affordance, because those are added by the browser after mount

#### Scenario: Commenting disabled or item unpublished
- **WHEN** a reader opens a media item whose commenting is disabled, or that is not published
- **THEN** no comment thread is displayed and no comments may be submitted

#### Scenario: Empty thread
- **WHEN** a published item with commenting enabled has no comments yet
- **THEN** the page shows an invitation to comment rather than an empty region

### Requirement: Submitting a comment on a media item

A signed-in reader SHALL be able to submit a comment on a media item whose commenting is enabled, subject to the same content rules as article comments.

#### Scenario: Successful submission
- **WHEN** a signed-in reader submits a non-empty comment within the length limit on an item whose commenting is enabled
- **THEN** the comment is stored, attributed to that reader, and appears in the thread

#### Scenario: Signed-out reader is invited to sign in
- **WHEN** a reader who is not signed in attempts to comment
- **THEN** the request is refused as unauthorized and the interface offers sign-in instead of the comment form

#### Scenario: Item has commenting disabled
- **WHEN** a reader submits a comment on an item whose commenting is disabled
- **THEN** the request is refused and nothing is stored

#### Scenario: Item is not published
- **WHEN** a reader submits a comment on an item that is not published
- **THEN** the request is refused and nothing is stored

#### Scenario: Content is stored verbatim and rendered as text
- **WHEN** a comment is stored and later displayed
- **THEN** the stored text is exactly what the reader submitted and it is rendered as plain text, never interpreted as markup

#### Scenario: Over-length content is refused, not truncated
- **WHEN** a comment exceeds the maximum length
- **THEN** the request is refused with a message naming the limit, and the reader's text is not silently shortened

#### Scenario: Empty content after trimming is refused
- **WHEN** a comment is empty or contains only whitespace
- **THEN** the request is refused

#### Scenario: Rate limiting applies per account and per address
- **WHEN** a reader submits comments faster than the configured limits
- **THEN** further submissions are refused for the configured window

#### Scenario: A refused submission does not consume quota
- **WHEN** a submission is refused for a reason other than rate limiting
- **THEN** the reader's quota is not reduced

#### Scenario: Banned address cannot comment
- **WHEN** a reader submits a comment from an address on the block list
- **THEN** the request is refused

### Requirement: One level of replies on media comments

Replies on a media comment SHALL be limited to a single level, and a reply's parent SHALL belong to the same media item.

#### Scenario: Replying to a top-level comment
- **WHEN** a reader replies to a top-level comment on a media item
- **THEN** the reply is stored and displayed under that comment

#### Scenario: Replying to a reply is refused
- **WHEN** a reader attempts to reply to a reply
- **THEN** the request is refused, so that the thread never exceeds one level of nesting

#### Scenario: Parent from a different item is refused
- **WHEN** a reader submits a comment whose parent belongs to a different media item
- **THEN** the request is refused, and no comment is stored under either item

#### Scenario: A media comment cannot be replied to as an article comment, or the reverse
- **WHEN** a comment is created, read, or replied to
- **THEN** the item it belongs to is exactly one of an article or a media item, never both and never neither

### Requirement: Replies and notifications on media comments

A reply to a reader's media comment SHALL notify that reader, using the same notification records as article replies.

#### Scenario: Reply notifies the comment's author
- **WHEN** someone replies to a reader's comment on a media item
- **THEN** a notification is created for that reader, referencing the reply

#### Scenario: Self-reply does not notify
- **WHEN** a reader replies to their own comment
- **THEN** no notification is created for them

#### Scenario: Notification is created with the reply
- **WHEN** a reply is stored
- **THEN** the notification is stored in the same transaction, so that a reply never exists without the notification it should have produced

#### Scenario: Notification links to the comment
- **WHEN** a reader follows a media reply notification
- **THEN** the link opens the media detail page at the page of the thread containing the comment, anchored to the top-level comment the reply belongs to

#### Scenario: Link target page is derived from the thread's paging, not guessed
- **WHEN** the notification's target page is computed
- **THEN** it is computed from the same page size the thread is served with, so that the link lands on the comment rather than beside it

### Requirement: Email notification for media replies

A reader who has enabled email notifications and whose comment on a media item receives a reply SHALL be sent an email, subject to the same conditions as article replies.

#### Scenario: Email is sent for a media reply
- **WHEN** a reply is made to a comment on a published media item whose commenting is enabled, and the comment's author has email notifications enabled and an email address on file
- **THEN** an email is sent containing the reply and a link to the media detail page

#### Scenario: Email is sent after the reply is stored, not during
- **WHEN** a reply is stored
- **THEN** the email is sent after the storing transaction completes, so that a slow or unreachable mail server does not hold a database transaction open

#### Scenario: Mail failure does not fail the reply
- **WHEN** sending the email fails
- **THEN** the reply remains stored, the failure is logged, and the reader is not shown an error

#### Scenario: Notifications disabled or no address
- **WHEN** the comment's author has email notifications disabled, or has no email address
- **THEN** no email is sent, and the in-portal notification is still created

#### Scenario: Reply on an item that is no longer eligible
- **WHEN** a reply is made on a media item that is unpublished or whose commenting has since been disabled
- **THEN** no email is sent

#### Scenario: Interpolated values are escaped
- **WHEN** an email body includes the item title, the reader's display name, or the comment text
- **THEN** each is escaped for HTML, because all three are text typed by a person

#### Scenario: No base address means no link
- **WHEN** the portal has no public base address configured
- **THEN** the email is still sent and contains no link, rather than a link that cannot resolve

#### Scenario: Banned readers receive no email
- **WHEN** the comment's author has been banned and their comments removed
- **THEN** no email is sent to them

### Requirement: Moderation of media comments

Administrators holding the comments permission SHALL be able to review and remove comments on both articles and media items from the same moderation screen.

#### Scenario: Both sources are reviewable
- **WHEN** an administrator opens the comment moderation screen
- **THEN** comments on articles and comments on media items are both available, and the screen can be filtered to one source

#### Scenario: Media context is shown
- **WHEN** a media comment is listed for moderation
- **THEN** the listing shows which media item it belongs to, by title and slug, so that a comment is never presented without the item it was made on

#### Scenario: Comments on deleted items remain attributable
- **WHEN** a comment's media item has been deleted
- **THEN** the comment row is not listed as belonging to a live item, and the moderation query does not drop the row because of the missing join

#### Scenario: Administrator reply on a media comment
- **WHEN** an administrator replies to a media comment
- **THEN** the reply is stored as an administrative reply, displayed under the comment, and the comment's author is notified

#### Scenario: Removing a media comment is recorded with its item
- **WHEN** an administrator removes a comment on a media item
- **THEN** the activity log records the removal with the comment identifier and the media item identifier

#### Scenario: Removal uses the single shared deletion path
- **WHEN** a media comment is removed, by a moderator, by its author, in bulk, by a ban, by account deletion, or by data retention
- **THEN** every one of those paths uses the same deletion behavior, so that replies and notifications are handled identically

#### Scenario: Removal counts what else disappears
- **WHEN** a moderator confirms removal of a comment that has replies
- **THEN** the confirmation states how many administrative replies and how many other readers' replies will also be removed

### Requirement: Comment auditing for media

Every administrative read and write of media comment data SHALL be recorded in the activity log, and the record SHALL NOT contain the comment's text.

#### Scenario: Moderation reads are recorded
- **WHEN** an administrator views the comment moderation screen
- **THEN** a record is written including the filters used, so that the log cannot be browsed silently

#### Scenario: Removal records the count
- **WHEN** a comment removal also removes replies
- **THEN** the record includes how many rows were removed, since after the removal that count is the only remaining evidence

#### Scenario: Records identify the acting administrator
- **WHEN** an administrative action on media comments is recorded
- **THEN** the record identifies the administrator who performed it

#### Scenario: Reader-initiated writes identify the reader without impersonating staff
- **WHEN** a reader's own action on a media comment is recorded
- **THEN** the record carries no administrative account identifier and identifies the reader separately

### Requirement: Comment moderation permission covers media

Access to media comment moderation SHALL be governed by the existing comments permission, and SHALL NOT require a newly invented permission.

#### Scenario: Existing permission is sufficient
- **WHEN** an administrator holds the comments permission
- **THEN** they can moderate media comments as well as article comments, without an additional grant

#### Scenario: Permission is enforced server-side
- **WHEN** a request to moderate or remove a media comment is made without the comments permission
- **THEN** the request is refused, regardless of what the interface shows
