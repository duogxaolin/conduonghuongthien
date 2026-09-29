# Spec Delta

## Purpose

Lets the portal broadcast a live session to its readers and lets readers ask questions while it is happening, with a conversation that is visible to everyone watching rather than one-to-one.

## ADDED Requirements

### Requirement: Single active session

At most one livestream session SHALL be active at any time, and starting a session while another is active SHALL be refused.

#### Scenario: Starting while idle
- **WHEN** an administrator with the livestream permission starts a session and no session is active
- **THEN** the session is created as active and the response identifies it

#### Scenario: Starting while already live
- **WHEN** an administrator starts a session while another session is active
- **THEN** the request is refused with a conflict status and a message stating that a session is already running, and no new session is created

#### Scenario: Concurrent starts admit exactly one
- **WHEN** two start requests arrive at the same time
- **THEN** exactly one succeeds and exactly one session row is created as active

#### Scenario: Permission is required
- **WHEN** an administrator without the livestream permission attempts to start or stop a session
- **THEN** the request is refused

### Requirement: Session lifecycle

An administrator SHALL be able to start and stop a session, and stopping SHALL record the end time and make the session no longer active.

#### Scenario: Stop records the end
- **WHEN** an administrator stops the active session
- **THEN** the session is marked inactive and its end time is recorded

#### Scenario: Stopping an inactive session
- **WHEN** an administrator stops a session that is not active
- **THEN** the request is refused and no session state changes

#### Scenario: Session start and stop are recorded
- **WHEN** a session is started or stopped
- **THEN** the activity log records the action with the session identifier and the administrator who performed it

#### Scenario: Session carries its playback source
- **WHEN** an administrator starts a session
- **THEN** the session records the source the viewers will watch, being either an external platform reference or a portal-hosted stream

### Requirement: Public active-session state

The portal SHALL expose the currently active session to anonymous readers, and SHALL report clearly when no session is active.

#### Scenario: Active session is reported
- **WHEN** an anonymous reader requests the live state while a session is active
- **THEN** the response identifies the session and how to watch it, and does not include administrative fields

#### Scenario: No active session is reported as such
- **WHEN** an anonymous reader requests the live state while no session is active
- **THEN** the response reports that nothing is live with a successful status, rather than an error

#### Scenario: Live state does not depend on the reader's identity
- **WHEN** the live-state request is made with or without a reader session
- **THEN** the response is the same, and the request does not read the reader's session cookie

### Requirement: Live chat delivery

The portal SHALL deliver chat messages to watching readers without requiring them to reload the page, over a long-lived streaming response.

#### Scenario: Viewer receives messages as they are sent
- **WHEN** a reader is watching the live chat and another reader sends a message
- **THEN** the message appears in the watching reader's conversation without a page reload

#### Scenario: Streaming response is not buffered or cached
- **WHEN** a reader opens the chat stream
- **THEN** the response is served with headers that prevent intermediary buffering and caching, and the connection is held open

#### Scenario: Anonymous readers may watch
- **WHEN** a reader who is not signed in opens the chat stream
- **THEN** the stream is served and messages are delivered

#### Scenario: Stream ends when the session ends
- **WHEN** the active session stops
- **THEN** open streams for that session are closed and readers are told that the session has ended

### Requirement: Stream lifecycle on server shutdown

The portal SHALL close open chat streams when the server is shutting down, and SHALL tell the reader why.

#### Scenario: Shutdown closes streams with a reason
- **WHEN** the server begins shutting down while chat streams are open
- **THEN** each open stream receives an event stating that the server is restarting and is then closed

#### Scenario: No messages are broadcast after shutdown begins
- **WHEN** a message is broadcast after shutdown has begun
- **THEN** it is not delivered to any stream

#### Scenario: Stream bookkeeping is released on client disconnect
- **WHEN** a reader's connection closes
- **THEN** the server's record of that stream is released and no further messages are sent to it

### Requirement: Slow consumer protection

The portal SHALL NOT allow a reader who consumes messages slower than they are produced to accumulate unbounded work on the server.

#### Scenario: Slow reader is disconnected
- **WHEN** the number of messages queued for a reader's stream exceeds the configured limit
- **THEN** that reader's stream is closed and its bookkeeping released, and other readers continue to receive messages

#### Scenario: Disconnection does not affect the session
- **WHEN** a reader is disconnected for being slow
- **THEN** the session remains active and other streams remain open

### Requirement: Chat message sending

A signed-in reader SHALL be able to send a chat message to the active session, and the message SHALL be persisted before it is delivered to anyone.

#### Scenario: Message is stored then delivered
- **WHEN** a signed-in reader sends a message to the active session
- **THEN** the message is stored and then delivered to all watching readers, including the sender

#### Scenario: Anonymous readers cannot send
- **WHEN** a reader who is not signed in attempts to send a chat message
- **THEN** the request is refused as unauthorized and nothing is stored

#### Scenario: Sending while nothing is live
- **WHEN** a reader sends a message while no session is active
- **THEN** the request is refused and nothing is stored

#### Scenario: Message content is plain text
- **WHEN** a message is stored
- **THEN** it is stored and later rendered as plain text, is limited to the configured maximum length, and is rejected rather than truncated when longer

#### Scenario: Message content rejects control characters
- **WHEN** a message contains control characters other than line breaks
- **THEN** the request is refused and nothing is stored

#### Scenario: Sender identity is taken from the session, not the request
- **WHEN** a message is sent
- **THEN** the sender is determined from the reader's session, and no request field can set the sender's identity

#### Scenario: Sender name is recorded as displayed
- **WHEN** a message is stored
- **THEN** the sender's display name at the time of sending is stored with it, so that a later rename does not rewrite what was displayed

### Requirement: Chat rate limiting

The portal SHALL limit how often a reader may send chat messages, applying limits both per reader account and per originating address.

#### Scenario: Per-account limit
- **WHEN** a reader sends messages faster than the per-account limit allows
- **THEN** further messages are refused for the configured window and the refusal states that the reader is sending too quickly

#### Scenario: Per-address limit applies across accounts
- **WHEN** many accounts send from the same originating address faster than the per-address limit allows
- **THEN** further messages from that address are refused, so that creating a new account is not a way around the limit

#### Scenario: A rejected message does not consume quota
- **WHEN** a send is refused for a reason other than rate limiting, such as empty content, over-length content, or no active session
- **THEN** the reader's quota is not reduced

#### Scenario: Limits survive a restart and apply across replicas
- **WHEN** the server restarts, or more than one instance is running
- **THEN** the limits continue to apply, because the counters are not held only in process memory

#### Scenario: Rate-limit storage failure does not open the gate
- **WHEN** the counter store is unavailable
- **THEN** limiting falls back to in-process counting rather than permitting unlimited sending

### Requirement: Chat history

The portal SHALL provide recent chat history for the active session so that a reader who joins late can see what was said.

#### Scenario: History is returned for the active session
- **WHEN** a reader requests chat history for the active session
- **THEN** recent messages are returned in chronological order

#### Scenario: Deleted messages are absent
- **WHEN** a message has been moderated away
- **THEN** it does not appear in the history returned to readers

#### Scenario: History is bounded
- **WHEN** a reader requests chat history
- **THEN** the number of messages returned is capped by the server, and a request asking for more than the cap is served at the cap rather than refused

### Requirement: Chat moderation

An administrator with the livestream permission SHALL be able to remove a chat message from the public conversation, and removal SHALL NOT destroy the record.

#### Scenario: Moderator removes a message
- **WHEN** an administrator removes a message
- **THEN** the message is marked removed, no longer appears in the history returned to readers, and an event telling viewers to remove it is broadcast

#### Scenario: Removal is recorded
- **WHEN** an administrator removes a message
- **THEN** the activity log records the action with the message and session identifiers and the administrator who performed it

#### Scenario: Removal is not deletion
- **WHEN** a message is removed
- **THEN** its row remains in the database, so that the moderation action is auditable

#### Scenario: Removing an already-removed message
- **WHEN** an administrator removes a message that has already been removed
- **THEN** the request succeeds without creating a second record of the same action

#### Scenario: Removing an unknown message
- **WHEN** an administrator removes a message identifier that does not exist
- **THEN** the request is refused as not found

### Requirement: Save session as a recording

An administrator SHALL be able to turn a stopped session into a media item, so that the broadcast remains watchable afterwards.

#### Scenario: Recording is created from a stopped session
- **WHEN** an administrator saves a stopped session as a recording
- **THEN** a media item is created that references the session's source, and the session records which media item it produced

#### Scenario: Saving an active session
- **WHEN** an administrator attempts to save a session that is still active
- **THEN** the request is refused, because a recording of an unfinished broadcast is not a recording

#### Scenario: Session removal does not remove the recording
- **WHEN** a session is removed by data retention
- **THEN** the media item it produced remains, and the reference from the session is cleared rather than the recording being deleted

#### Scenario: Saving is recorded
- **WHEN** a session is saved as a recording
- **THEN** the activity log records the action with the session and media item identifiers

### Requirement: Livestream retention

Stopped livestream sessions SHALL be subject to a configurable retention window, and SHALL NOT be removed while still active.

#### Scenario: Old stopped sessions are purged
- **WHEN** a session ended longer ago than the configured retention window
- **THEN** the session row is removed and its chat messages are removed with it

#### Scenario: Active sessions are never purged
- **WHEN** a retention pass runs while a session is active
- **THEN** that session is not removed, and its chat messages are not removed

#### Scenario: Age is measured from the end of the session
- **WHEN** the retention window is applied
- **THEN** a session's age is measured from when it ended, not from when it started, so that a long broadcast is not purged while it is still running

#### Scenario: Window is configurable and reports its source
- **WHEN** an administrator views the data-retention settings
- **THEN** the livestream window is shown with the value in effect and where that value came from, and saving it is recorded in the activity log

#### Scenario: A session with no end time is not treated as old
- **WHEN** a session has no end time recorded
- **THEN** it is excluded from age-based purging

### Requirement: Livestream administration interface

Administrators SHALL have an interface to start and stop sessions, see the running session, and moderate its chat.

#### Scenario: Starting and stopping from the interface
- **WHEN** an administrator starts or stops a session from the interface
- **THEN** the interface reflects the new state without a full page reload

#### Scenario: Conflict is reported clearly
- **WHEN** starting a session fails because another is active
- **THEN** the interface reports that a session is already running rather than a generic failure

#### Scenario: Error state is announced and recoverable
- **WHEN** the livestream administration page fails to load its data
- **THEN** the error is announced as an alert and a retry control re-runs the failed request

#### Scenario: Permission is reflected in the interface
- **WHEN** an administrator lacks the livestream permission
- **THEN** the livestream administration entry is not offered to them
