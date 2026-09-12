# Spec 176 — Local-volume storage by default

## Context

MinIO/S3 is unnecessary operational overhead for the default single-host
self-hosted installation. Voxen needs local and S3 drivers behind one contract
without silently switching existing installations.

## Requirements

### Ubiquitous

- The system shall support `STORAGE_DRIVER=local|s3`, defaulting to local only
  when no S3/Garage configuration exists.
- The system shall preserve logical `workspaces/<userId>/...` database keys
  regardless of the selected driver.
- The system shall provide provider-neutral put, get/stream, head, delete,
  delete-prefix, health, and upload-capability operations.
- The system shall enforce path containment, traversal/symlink rejection,
  atomic writes, and root-deletion protection in web and worker runtimes.

### Event-driven

- When any legacy S3/Garage discriminator is present without an explicit
  driver, the system shall select S3, validate the complete configuration, and
  emit a deprecation warning.
- When legacy S3 configuration is partial, the system shall fail as S3 and
  never fall back to an empty local directory.
- When a new installation starts, the system shall use `/data/storage` on a
  persistent volume shared by non-root web and worker processes.
- When a client uploads media in local mode, the system shall stream bytes
  through the application with real size limits and bounded memory.

### State-driven

- While local storage is active, the system shall serve files only through
  authenticated routes and support byte-range `200`, `206`, and `416` flows.
- While S3 is active, the system shall preserve external endpoints, presigned
  uploads, and existing integrations.

### Unwanted behavior

- If the driver is invalid, a local path is relative/dangerous, or the mount is
  not writable, then the system shall fail with an actionable diagnostic.
- If a write is cancelled, oversized, or fails, then the system shall remove
  temporary files and preserve the previous object.
- If an operation attempts to escape a workspace or storage root, then the
  system shall reject it before physical access.

## Acceptance criteria

- [x] A new Compose installation starts without MinIO and shares
  `storage_data` between web and worker.
- [x] Existing S3 installations remain on S3 without moving data.
- [x] Web and worker implement the same contract and read each other's objects.
- [x] Application routes no longer execute S3 operations directly.
- [x] Local upload is streamed, bounded, and verified by actual byte length.
- [x] Health, bootstrap, Easypanel, backup, and restore honor the driver.
- [x] Tests cover local/S3 contracts, ranges, isolation, and cross-runtime use.
- [x] English and PT-BR docs explain install, upgrade, and offline migration.

## Out of scope

- Online switching or automatic driver migration.
- Multi-host/high-availability local storage.
- Removing S3 support or build dependencies.
- Serving the storage volume through nginx or a permanent public URL.
