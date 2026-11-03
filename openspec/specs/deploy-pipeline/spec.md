# deploy-pipeline Specification

## Purpose
Defines what an automatic deploy to the production VPS must do before, during and after swapping the app container, and which merges deploy at all.

## Requirements

### Requirement: A verified database dump precedes every app swap
Before the app container is replaced, the deploy SHALL create a database dump in the backup directory tagged as pre-deploy and verify it. If the dump or its verification fails, the deploy MUST stop without touching the running container. Pre-deploy dumps SHALL be rotated separately, keeping the newest 5. The manual update path SHALL offer the same dump, defaulting to yes.

#### Scenario: Dump fails
- **WHEN** the pre-deploy dump fails (for example the disk is full)
- **THEN** the deploy exits non-zero and the running app container and image are unchanged

#### Scenario: Normal deploy
- **WHEN** a deploy succeeds
- **THEN** a verified pre-deploy dump named for that deploy exists and at most 5 pre-deploy dumps are kept

### Requirement: Merges that change only documentation do not build or deploy
For a push to `main`, the pipeline SHALL compare the pushed commit with the commit currently deployed in production (taken from the public health endpoint's version, otherwise from the most recent run whose deploy job succeeded). When every file changed since that commit is Markdown, under `docs/`, or under `openspec/`, or when the pushed commit is already deployed, the pipeline SHALL still run the test jobs but SHALL NOT build or push an image and SHALL NOT deploy. When the deployed commit cannot be determined, is not an ancestor of the pushed commit, or the changed-file list cannot be computed, the pipeline SHALL deploy.

#### Scenario: Plan-only merge
- **WHEN** production runs commit A and a merge to `main` changes only files under `openspec/` and `docs/` since A
- **THEN** the image and deploy jobs are skipped and the production container is not restarted

#### Scenario: Mixed merge
- **WHEN** a merge changes a `.md` file and a `.ts` file
- **THEN** the image is built and deployed

#### Scenario: Code push cancelled while pending, then a docs-only push
- **WHEN** production runs A, a code push B is cancelled while waiting, and a docs-only push C follows
- **THEN** C is compared with A, sees B's code change, and is built and deployed

#### Scenario: Deployed commit unknown
- **WHEN** neither the health endpoint nor the run history yields a deployed commit
- **THEN** the pushed commit is built and deployed

### Requirement: Deploy success requires the public site to serve the new version
After the container reports healthy, the deploy SHALL request the public health endpoint through the configured public URL (with cache-busting and 12 attempts 10 seconds apart, each attempt bounded to 10 seconds) and SHALL treat the deploy as successful only when it answers 200 with the version that was just deployed. The health endpoint SHALL answer 200 with `{ ok: true, version }` when the database answers, 503 otherwise, and MUST NOT be cached.

#### Scenario: Public URL serves the old version
- **WHEN** the container is healthy but the public URL keeps returning the previous version for all 12 attempts
- **THEN** the deploy job fails and reports the mismatch

#### Scenario: Database down
- **WHEN** the database does not answer
- **THEN** the health endpoint returns 503 with `Cache-Control: no-store`

### Requirement: A restart-looping container fails the deploy quickly
While waiting for health, the deploy SHALL fail as soon as the new container has restarted more than twice, instead of waiting for the full health timeout, and SHALL then run the existing rollback.

#### Scenario: Crash on boot
- **WHEN** the new container exits on start and is restarted by Docker three times
- **THEN** the deploy stops waiting, prints the container log tail and rolls back

### Requirement: The app container stops gracefully
The app container SHALL be given a stop grace period longer than the server's own shutdown drain, and shutdown SHALL stop the backup scheduler before the process exits.

#### Scenario: Deploy replaces the app
- **WHEN** the app container is stopped during a deploy
- **THEN** Docker waits at least 45 seconds before killing it and no new scheduled backup starts after shutdown begins

### Requirement: Old images are removed by count
After a successful deploy, the VPS SHALL keep the running image and the 5 newest previous app images and remove older app image tags; the registry SHALL keep the newest 20 image versions. The deploy SHALL print a warning when the Docker data filesystem is more than 80 % full.

#### Scenario: Twelfth deploy
- **WHEN** 12 app image tags exist on the VPS after a successful deploy
- **THEN** 6 remain: the running one and the 5 newest others
