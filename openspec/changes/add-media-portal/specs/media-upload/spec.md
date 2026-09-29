# Spec Delta

## Purpose

Lets staff publish large video files to the portal's own storage, by accepting an upload that survives an interrupted connection and turning it into a set of streamable renditions in the background, without a failed job leaving a video permanently unusable.

## ADDED Requirements

### Requirement: Upload availability gate

The portal SHALL refuse to start an upload when the deployment has not been configured to accept video uploads, and SHALL report the refusal as a service-unavailable condition naming the reason.

#### Scenario: Uploads disabled
- **WHEN** an administrator starts an upload on a deployment where video upload is disabled
- **THEN** the request is refused with a service-unavailable status and a message stating that uploads are turned off on this server

#### Scenario: Gate is evaluated at upload start, not only in the interface
- **WHEN** an upload is started by a direct API call on a deployment where video upload is disabled
- **THEN** the request is refused, so that hiding the control in the interface is not the only protection

### Requirement: Chunked resumable upload

An authenticated administrator SHALL be able to upload a video in fixed-size chunks, and SHALL be able to resume after an interruption without re-sending the chunks already received.

#### Scenario: Resume reports received chunks
- **WHEN** an administrator requests the status of an upload in progress after a dropped connection
- **THEN** the response lists which chunk indexes have already been received

#### Scenario: Re-sending a received chunk is harmless
- **WHEN** an administrator sends a chunk index that has already been received
- **THEN** the upload state is unchanged and the request succeeds, so that a retry after an ambiguous failure is safe

#### Scenario: Out-of-order chunks are accepted
- **WHEN** chunks arrive in an order other than ascending
- **THEN** each is stored under its own index and completion succeeds once every index has been received

#### Scenario: Chunk index is validated
- **WHEN** a chunk request carries an index that is not a non-negative integer within the expected range, or a body larger than the declared chunk size
- **THEN** the request is rejected and the upload state is not modified

### Requirement: Upload size limit

The portal SHALL enforce a configured maximum total size per upload, and SHALL reject an upload that would exceed it before storing further data.

#### Scenario: Declared size over the limit
- **WHEN** an administrator starts an upload whose declared total size exceeds the configured maximum
- **THEN** the request is rejected with a message naming the limit, and no upload record is created

#### Scenario: Accumulated size over the limit
- **WHEN** the chunks received so far would exceed the configured maximum even though the declared size did not
- **THEN** further chunks are rejected and the upload is marked failed

### Requirement: Upload ownership

Each upload SHALL be bound to the administrator who started it, and every subsequent request for that upload SHALL verify that binding server-side.

#### Scenario: Another administrator cannot act on the upload
- **WHEN** an administrator sends a chunk, status, or completion request for an upload started by a different administrator
- **THEN** the request is refused as not found, and the upload is not modified

#### Scenario: Unknown upload identifier
- **WHEN** any upload request carries an identifier that does not exist
- **THEN** the request is refused as not found, with the same response shape as the ownership refusal

#### Scenario: Storage path is not derived from request input
- **WHEN** the server writes received chunks to disk
- **THEN** the location is derived from the server-generated upload identifier only, so that no request field can influence the path

### Requirement: Upload completion

On completion the portal SHALL verify that every expected chunk is present, assemble the parts into a single file, validate that the result is a supported video container, and create a media item for it.

#### Scenario: Successful completion
- **WHEN** an administrator completes an upload whose chunks are all present and whose assembled file is a supported video container
- **THEN** a media item is created in a non-published state with processing pending, and the response identifies it

#### Scenario: Missing chunks
- **WHEN** completion is requested while some expected chunk indexes are absent
- **THEN** the request is refused and names how many are missing, and no media item is created

#### Scenario: Assembled file is not a supported video
- **WHEN** the assembled file's leading bytes do not match a supported video container, regardless of the declared content type or file extension
- **THEN** the upload is marked failed, no media item is created, and the temporary data is removed

### Requirement: Transcode pipeline

The portal SHALL process a completed upload in the background into a set of streamable renditions, and SHALL publish each rendition as soon as it is ready rather than waiting for the whole job.

#### Scenario: Renditions become available progressively
- **WHEN** a transcode job completes its first rendition while later renditions are still running
- **THEN** the completed rendition is recorded as ready and becomes playable for a published item before the job finishes

#### Scenario: Processing is recorded and recoverable
- **WHEN** a transcode job starts
- **THEN** the media item records that it is processing, together with the identity of the process performing it and a timestamp that is refreshed while the job runs

#### Scenario: Probe results are stored
- **WHEN** a transcode job inspects the assembled file
- **THEN** the item's duration and the available source dimensions are recorded on the media item

#### Scenario: Transcode does not hold a database connection for its duration
- **WHEN** a transcode job runs for a long period
- **THEN** it does not hold a pooled database connection for that period; its liveness is recorded on the item's row and refreshed periodically instead

#### Scenario: Manifest is replaced atomically
- **WHEN** a rendition finishes and the stream manifest is updated
- **THEN** readers fetching the manifest concurrently see either the previous complete manifest or the new complete manifest, never a partially written one

#### Scenario: Failed job is recorded
- **WHEN** a transcode job fails
- **THEN** the item is marked failed with a reason, and it is not presented as playable

### Requirement: Disk space guard

The portal SHALL monitor free disk space while processing and SHALL abort a job before the volume is exhausted.

#### Scenario: Free space falls below the threshold
- **WHEN** free space on the media volume falls below the configured minimum during a job
- **THEN** the job aborts, the item is marked failed with a disk-space reason, the event is logged, and temporary files are removed

#### Scenario: Guard failure does not crash the process
- **WHEN** the free-space check itself errors
- **THEN** the error is logged and the job is aborted rather than continuing without a guard

### Requirement: Stuck job reclamation

The portal SHALL periodically detect media items left in the processing state by a process that is no longer running and SHALL return them to a retryable state.

#### Scenario: Dead job is reclaimed
- **WHEN** an item is in the processing state, its liveness timestamp is older than the staleness window, and the process recorded on it is no longer running
- **THEN** the item is returned to a retryable state and the event is logged

#### Scenario: Live job is not reclaimed
- **WHEN** an item is in the processing state and its process is still running
- **THEN** its liveness timestamp is refreshed and the item is left alone

#### Scenario: Reaper runs on a schedule without blocking shutdown
- **WHEN** the process starts
- **THEN** the reaper runs on a fixed interval, its timer does not keep the process alive, and an error inside a tick is logged and swallowed rather than terminating the process

#### Scenario: Only one reaper acts at a time
- **WHEN** the reaper interval fires while a previous pass is still running, or while another replica holds the same work
- **THEN** the overlapping pass performs no work

### Requirement: Upload session housekeeping

The portal SHALL remove abandoned upload sessions and their temporary files, and SHALL NOT remove an upload that is still being received.

#### Scenario: Abandoned upload is removed
- **WHEN** an upload session has been inactive for longer than the configured retention window
- **THEN** its temporary directory and its session record are removed

#### Scenario: Recent upload is kept
- **WHEN** an upload session has been modified within the retention window
- **THEN** it and its temporary files are left in place

### Requirement: Media item administration

Administrators holding the media permission SHALL be able to create, read, update, and delete media items, and every write SHALL be recorded in the activity log.

#### Scenario: Permission is required
- **WHEN** an administrator without the media permission calls any media administration endpoint
- **THEN** the request is refused

#### Scenario: Slug is generated and unique
- **WHEN** an administrator creates or renames a media item
- **THEN** a slug is derived from the title and made unique against existing items, and a slug already in the database is not rewritten

#### Scenario: Deletion removes stored assets
- **WHEN** an administrator deletes a media item
- **THEN** the item's row and its stored renditions, segments, and thumbnails are removed, and the deletion is recorded in the activity log with the item's identifier and slug

#### Scenario: Deletion of stored assets does not roll back the row deletion
- **WHEN** removing stored assets fails after the item's row has been deleted
- **THEN** the failure is logged and reported, and the row deletion is not reversed, because a row that claims an asset still exists is worse than a missing asset

#### Scenario: Publishing is explicit
- **WHEN** an administrator creates a media item
- **THEN** it is created unpublished, and it appears in the public listing only after its status is set to published

#### Scenario: Failed items are visible to administrators
- **WHEN** an administrator lists media items
- **THEN** items in a failed processing state are listed with their failure reason, so that a failed upload is not silently absent from the administration screen

### Requirement: External video reference

An administrator SHALL be able to register a media item that plays from an external video platform instead of an uploaded file, by supplying that platform's video address or identifier.

#### Scenario: Identifier is extracted from a shared address
- **WHEN** an administrator supplies any common form of an external platform's video address
- **THEN** the platform's video identifier is extracted and stored, and the item is playable

#### Scenario: Address that is not a video is refused
- **WHEN** an administrator supplies an address or identifier that cannot be resolved to a video identifier
- **THEN** the request is refused with a message stating that the video could not be recognised

#### Scenario: Thumbnail is not hot-linked
- **WHEN** an item sourced from an external platform is displayed
- **THEN** its thumbnail is served from the portal's own origin rather than requested from the external platform's image host

### Requirement: Streaming endpoint does not disclose the storage location

The portal SHALL serve self-hosted media bytes through its own origin, and SHALL NOT redirect the reader's browser to the underlying storage provider's address.

#### Scenario: Bytes are proxied
- **WHEN** a reader requests the stream of a published self-hosted item
- **THEN** the response body is the media content served from the portal's origin, and the response is not a redirect

#### Scenario: Storage credentials are not exposed
- **WHEN** the stream response is inspected by the reader
- **THEN** it contains no storage-provider address, signature, or credential

#### Scenario: Unpublished item is not streamable
- **WHEN** a reader requests the stream of an item that is not published
- **THEN** the portal responds as not found

### Requirement: Media administration interface

The media administration page SHALL provide loading, error, and empty states for its listing and SHALL provide the upload control, processing progress, and item management.

#### Scenario: Error state is announced and recoverable
- **WHEN** the media administration page fails to load its data
- **THEN** the error is announced as an alert and a retry control re-runs the failed request rather than reloading the page

#### Scenario: Upload progress is visible
- **WHEN** an administrator uploads a video
- **THEN** the interface shows progress, permits resuming after an interruption, and reports a failure with a message rather than appearing to complete

#### Scenario: Processing state is visible
- **WHEN** an item is being processed
- **THEN** the administration listing shows that the item is processing, and shows the failure reason when processing has failed

#### Scenario: Loading placeholders respect reduced motion
- **WHEN** the reader has requested reduced motion
- **THEN** the loading placeholders do not animate
