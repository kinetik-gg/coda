# ADR: Collaboration engine and transport

Status: Accepted
Scope: `apps/api`, `apps/web` — the conflict-free text model, its transport, durable storage,
presence protocol, undo model, offline persistence, comment anchoring and export hygiene for live
screenplay collaboration.

This is the timeboxed spike deliverable for the live-collaboration epic. It **binds** the
implementation issues: the durable update log, the CodeMirror 6 collaborative binding, offline/undo,
comment threads, and the two-client release gate all build directly from the decisions below. Where
a decision genuinely cannot be made without implementation it is called out explicitly under
[Left open](#left-open-with-the-decision-procedure), with the procedure that settles it.

## Context

Screenplays today are single-writer documents. `Screenplay.sourceText` is the canonical Fountain
string in Postgres; the editor autosaves it with a debounce and an optimistic `version` check that
returns `409 Conflict` when another session got there first. Everything downstream — the lossless
Fountain parser, the preview/pagination model, PDF export, Final Draft (`.fdx`) export, the MCP
adapter — reads that one string.

Five existing constraints shape every decision here.

1. **The CodeMirror 6 editor is not a blank slate.** `apps/web/src/screenplays/FountainEditor.tsx`
   composes `basicSetup` with a Fountain decoration `StateField`, a focus-paragraph `ViewPlugin`,
   typewriter scrolling, a cross-panel scroll-intent arbiter, and — crucially — a **controlled
   `value` prop** that reconciles React state into the document with a string diff. Split editor
   panels mean **two `EditorView`s can be live on one screenplay at once**.
2. **A socket.io gateway already exists and already authenticates.**
   `apps/api/src/realtime/realtime.gateway.ts` parses the session cookie in `handleConnection`,
   hashes it with `hashToken`, resolves `prisma.session` (expiry + `user.status === 'ACTIVE'`), and
   stashes `userId`/`sessionId` on `socket.data`. It fans out `project:<id>` room invalidations and
   degrades to direct delivery on the single-user desktop profile via
   `runtimeCapabilities().realtimeFanout`.
3. **Revisions are immutable and must stay that way.** `ScreenplayRevision` carries a composite
   `(screenplayId, ownerUserId)` foreign key into a row-immutability trigger, a
   `@@unique([screenplayId, screenplayVersion])`, and a per-owner storage quota. Checkpoints are
   deliberate snapshots, not autosave history.
4. **The access-control graph is in place.** The choke point is
   `ScreenplayPermissionService.assert()`: a non-member gets `404` (tenant isolation), a member
   lacking the permission gets `403`. The vocabulary is `read_screenplay`, `edit_screenplay`,
   `invite_members`, `manage_member_roles`, `manage_roles`, `manage_screenplay_settings`
   (see [ADR: Screenplay access control](adr-screenplay-access-control.md)).
5. **Appended tables may not depend on core objects.** Restore runs
   `pg_restore --clean --if-exists`, whose `DROP`s are scoped to objects present in the dump. A
   table that an older dump does not know about, holding a foreign key onto `screenplays`/`users`,
   a column typed by a shared enum, or a `citext` column, makes restoring an N-1 backup fail
   (`cannot drop constraint screenplays_pkey`, `cannot drop type`, extension-type dependency). See
   [Data compatibility](data-compatibility.md); the precedents are `user_two_factor`,
   `scheduled_job_status`, `screenplay_panel_layouts` and the screenplay access-control tables.

## How this was decided

A throwaway walking skeleton on branch
[`spike/collab-skeleton-throwaway-153`](https://github.com/kinetik-gg/coda/tree/spike/collab-skeleton-throwaway-153)
(`spike/collab-153/`, never merged, outside the pnpm workspace globs so the repository root gains no
dependency). It contains a socket.io gateway shaped like `realtime.gateway.ts` — cookie-session
authentication, a `join-screenplay` handshake authorised against a membership table, an append-only
update log on disk, and a compaction tick — plus a CodeMirror 6 client and two headless probes.

Both probes pass end to end:

- **Two real Chromium contexts** (owner + invited editor, separate cookie jars) type into one
  screenplay through the gateway: edits flow both ways, remote cursor and selection render in the
  peer, an identity chip appears, disconnecting and typing offline then reconnecting converges, and
  `Mod-Z` reverts only the invoking user's edit while the collaborator's edit survives.
- **A multi-client probe** covers the parts a browser makes awkward: an unauthenticated socket is
  dropped, a non-member gets `404`, a trashed screenplay gets `404`, a read-only member subscribes
  but is refused `403` on publish, two clients converge under genuinely concurrent edits, presence
  relays, a `SIGKILL` of the server followed by a restart replays the document byte-identically from
  the log, and the compaction tick folds 85 log rows into a single 721-byte checkpoint with the
  document unchanged.

Measurements ran against a deterministic feature-length fixture: 168,157 characters, 6,063 lines,
≈110 pages at 55 lines/page, 237 scenes, regenerated byte-for-byte from a fixed LCG seed with no
clocks or randomness (sha256 `e7cb587fb99de1d0a18e787f35976df24e445c93139301584081dad530d4c4ad`).
It parses with the real `@coda/fountain` parser into 6,058 elements — 237 scene headings, 1,185
character/dialogue pairs, 830 action blocks, 236 parentheticals, 65 transitions — so the shape of
the edit stream is representative rather than synthetic filler.

Both engines were driven through the **same fixture and the same seeded edit scripts**.

## Measurements

`yjs@13.6.31` versus `@automerge/automerge@3.3.2`, macOS, Node 25.

### Authoring a 110-page screenplay from empty

Transaction granularity is the number of characters committed per CRDT transaction: `1` is what a
naive binding produces (one transaction per keystroke), higher values model a provider that
coalesces before publishing.

| Chars per transaction | Yjs updates | Yjs log  | Yjs B/update | Automerge changes | Automerge log | Automerge B/change |
| --------------------- | ----------- | -------- | ------------ | ----------------- | ------------- | ------------------ |
| 1                     | 168,157     | 3.50 MiB | 21.8         | 168,158           | 16.48 MiB     | 102.8              |
| 8                     | 21,020      | 0.58 MiB | 28.8         | 21,021            | 2.23 MiB      | 111.1              |
| 64                    | 2,628       | 0.21 MiB | 84.8         | 2,629             | 0.44 MiB      | 173.7              |
| 512                   | 329         | 0.17 MiB | 532.9        | 330               | 0.20 MiB      | 621.9              |

**Automerge's per-change overhead is 4.7× Yjs's** (102.8 B versus 21.8 B for a single keystroke).
Coalescing helps both: at 8 characters per transaction Yjs's log drops 6× to 0.58 MiB.

### Compacted document size

| Measure                                   | Yjs       | Automerge |
| ----------------------------------------- | --------- | --------- |
| Compacted snapshot of the authored script | 164.2 KiB | 46.2 KiB  |
| Same, gzipped                             | 46.1 KiB  | 46.3 KiB  |
| Plain Fountain source, for reference      | 164.2 KiB | 164.2 KiB |

Automerge's `save()` looks 3.6× smaller only because it compresses internally. **Gzipped, the two
are within 0.4% of each other** (47,182 versus 47,354 bytes), and Postgres TOAST compresses a large
`bytea` column on the same terms. The apparent size advantage does not survive contact with the
storage layer.

### Compaction strategy (the non-obvious result)

Folding a full keystroke-level log for Yjs:

| Strategy                                                                | Result bytes                    | Time     |
| ----------------------------------------------------------------------- | ------------------------------- | -------- |
| Replay all 168,157 updates into a `Y.Doc`, then `Y.encodeStateAsUpdate` | 164.2 KiB (byte-identical text) | 264 ms   |
| `Y.mergeUpdates` over 2,000 updates                                     | 19,883                          | 45 ms    |
| `Y.mergeUpdates` over 8,000 updates                                     | 79,883                          | 401 ms   |
| `Y.mergeUpdates` over 32,000 updates                                    | 335,499                         | 7,468 ms |
| Replay+encode over the same 32,000 updates                              | 32,021                          | —        |

`Y.mergeUpdates` is the obvious server-side compactor and it is a trap: it preserves per-update item
boundaries (so the "compacted" output is 10× the text it encodes) and its cost grows superlinearly.
Run over the whole 168k-update log in an earlier probe it took **483 seconds** and produced
1.83 MiB. Replaying into a `Y.Doc` and re-encoding does the job in 264 ms at 164 KiB.

### Revision pass — 2,000 scattered edits on a finished script

| Measure                       | Yjs                          | Automerge                   |
| ----------------------------- | ---------------------------- | --------------------------- |
| Delta log                     | 63.8 KiB (32.7 B/edit)       | 255.1 KiB (130.6 B/edit)    |
| Wall time for the 2,000 edits | 13 ms                        | 263 ms                      |
| Compacted after the pass      | 226.8 KiB (1.33× plain text) | 87.3 KiB (0.51× plain text) |

Automerge is ~20× slower per edit here but both remain comfortably interactive. (An earlier run
showed 8.6 s; that was an artefact of reading `doc.source.length` off the proxy inside the change
callback — a WASM round trip per edit. The number above is with the length tracked outside.)

### Offline catch-up

One writer makes 900 scattered edits online while a peer drafts ~6,000 characters offline, then they
reconnect.

| Measure                            | Yjs                  | Automerge         |
| ---------------------------------- | -------------------- | ----------------- |
| Offline queue                      | 9.0 KiB              | 24.5 KiB          |
| Handshake payload the client sends | 16-byte state vector | full sync message |
| Server → reconnecting client       | 20.2 KiB             | 69.1 KiB          |
| Client → server                    | 7.3 KiB              | 47.5 KiB          |
| Round trips to converge            | 1                    | 3                 |

Yjs's state vector is 16 bytes for a two-writer document, so the reconnect handshake is effectively
free and the server replies with exactly the missing delta in one round trip.

### Per-user undo

| Engine    | Result                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yjs       | `Y.UndoManager` with `trackedOrigins` reverts only the invoking user's edit and leaves the collaborator's intact, including when the collaborator edited _above_ the undone range. Replicas stay converged. Verified again in two real browsers through `Mod-Z`.                                                                                                                                                            |
| Automerge | **No undo manager exists** — no `undo`, `redo` or `UndoManager` in the package's exports. Both hand-rolled approaches corrupt the document: rewinding to the pre-edit heads (`A.view`) also discards the collaborator's edit, and inverting the local change with `A.diff` and replaying it applies stale absolute offsets, producing `"BOB PREPENCE WROTE THIS. "` from `"BOB PREPENDED. FADE IN:\n\nALICE WROTE THIS. "`. |

### Range anchors

| Engine    | Anchor size                                               | Survives a concurrent insert above plus a 5,000-char deletion above    | When the anchored range itself is deleted |
| --------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| Yjs       | 10 bytes (`Y.encodeRelativePosition`)                     | Yes — quoted range preserved verbatim, offset remapped 90,000 → 85,050 | Collapses to a zero-width point, no throw |
| Automerge | 22 bytes (`A.getCursor`, e.g. `"90002@3141592653589793"`) | Yes — same remapping                                                   | Collapses to a zero-width point, no throw |

## Decision 1 — Engine: **Yjs**

Adopt `yjs` with `y-codemirror.next`.

Automerge is a credible CRDT with a smaller uncompressed document, a cleaner change model and a
first-class sync protocol. It loses on three counts that matter to this product:

- **Per-user undo does not exist and cannot be cheaply built.** Issue #156's acceptance criterion is
  "undo only reverts the invoking user's edits". Yjs ships that; with Automerge we would be writing
  an operation-inverting undo manager that correctly rebases through concurrent edits — a research
  task, not a feature task, and the measured naive attempts silently corrupt text.
- **The CM6 binding is materially less mature.** `y-codemirror.next` 0.3.5 is maintained by the Yjs
  author, ships awareness-driven remote cursors and selections, and wires an undo manager scoped to
  the local view automatically. `@automerge/automerge-codemirror` is at 0.2.0 with no presence
  layer, so we would be building remote cursors ourselves on top of `A.getCursor`.
- **Its log is 4.7× larger per edit** and its size advantage on the compacted document evaporates
  under gzip/TOAST.

Yjs's costs are accepted knowingly: a compacted document 1.33× the plain text after a revision pass
against Automerge's 0.51×, and an encoding that is not self-compressing. On the authored script —
the case that was measured both ways — that gap closes to nothing once compressed (47,182 bytes
gzipped versus Automerge's 47,354). The post-revision figures above are uncompressed on both sides;
gzipped post-revision sizes were not measured, so the 1.33×/0.51× contrast should be read as an
upper bound on the real storage difference, not as the number TOAST will see.

## Decision 2 — Transport: **reuse `realtime.gateway.ts`**, do not add a provider

Extend the existing NestJS socket.io gateway with a screenplay channel. Do **not** introduce
`y-websocket` or any dedicated provider process.

The whole authentication story already exists and is already tested: `handleConnection` resolves the
session cookie against `prisma.session`, checks expiry and `user.status`, and stashes
`userId`/`sessionId` on `socket.data`. A dedicated provider would need that entire chain rebuilt,
plus a second listening port in every Compose topology, every deploy template, and the Coolify
service definitions — and the desktop runtime profile would gain a second process it does not want.
The skeleton demonstrates the whole feature set (sync, presence, offline replay, permission
enforcement) over plain socket.io acknowledgements, so the provider buys nothing we do not already
have.

The room follows the existing convention: `screenplay:<id>`, joined through a `join-screenplay`
handshake authorised against `ScreenplayMembership`, exactly as `join-project` is authorised against
`ProjectMembership`.

### Wire protocol

Payloads are `Uint8Array`; socket.io encodes binary attachments natively.

Client → server:

| Message                | Body                                              | Acknowledgement                                                                                                    |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `join-screenplay`      | `{ screenplayId, stateVector }`                   | `{ status: 200, permissions, identity: { userId, displayName }, update, serverStateVector }`, or `{ status: 404 }` |
| `screenplay-update`    | `{ screenplayId, update }`                        | `{ status: 200, seq }`, `{ status: 403 }`, or `{ status: 404 }`                                                    |
| `screenplay-awareness` | `{ screenplayId, update }` (y-protocols encoding) | none — relay only                                                                                                  |

Server → client:

| Message                    | Body         |
| -------------------------- | ------------ |
| `screenplay-update`        | `{ update }` |
| `screenplay-awareness`     | `{ update }` |
| `screenplay-presence-drop` | `{ userId }` |

### Permission enforcement

Attached at exactly two points, both resolving through `ScreenplayPermissionService` so there is one
authorisation code path:

- **`join-screenplay`** asserts `read_screenplay`. A non-member, and a trashed screenplay
  (`deletedAt IS NOT NULL`), both return `{ status: 404 }` — indistinguishable, per the
  tenant-isolation convention. Never `403` here: a `403` would confirm the screenplay exists.
- **`screenplay-update`** asserts `edit_screenplay`. A read-only member (viewer role) that
  subscribed successfully and then publishes gets a `403` acknowledgement carrying
  `Missing permission: edit_screenplay`. Its socket is not dropped; it keeps receiving updates.

Re-authorisation on fan-out follows the pattern `emitToAuthorizedMembers` already uses: membership
and session are re-checked before delivery, and the check is skipped when
`runtimeCapabilities().realtimeFanout === 'single-user'`. A membership revoked mid-session must also
force the socket out of the room — see [Left open](#left-open-with-the-decision-procedure).

Everything the desktop profile needs already holds: with one member and no peers the gateway
delivers nothing, awareness stays empty, and the editor behaves exactly as it does today. Any
desktop-versus-server divergence must be expressed as a **named capability key** in
`runtime-capabilities.ts` — `scripts/check-runtime-profile-portability.ts` fails the build on a bare
`RUNTIME_PROFILE` read or a `'desktop'`/`'server'` string literal anywhere else in `apps/api/src`.

### Client-side coalescing

`y-codemirror.next` emits one Yjs update per CodeMirror transaction, i.e. per keystroke. The
provider **must buffer and flush on a ~100 ms timer**, merging the small pending buffer with
`Y.mergeUpdates` before emitting. The measurements make the case: coalescing to ~8 characters cuts
the authoring log from 3.50 MiB to 0.58 MiB, and `Y.mergeUpdates` is cheap at this size (45 ms for
2,000 updates, microseconds for the ~20 a flush actually holds). This is the one place
`Y.mergeUpdates` is appropriate; see Decision 3 for why it is wrong on the server.

## Decision 3 — Durability: an append-only log, with `sourceText` as the canonical projection

Three layers, with one rule: **`Screenplay.sourceText` stays canonical.** Every existing reader —
`export.fountain`, the PDF exporter, `exportFinalDraft`, the preview model, the MCP adapter — keeps
reading a plain Fountain string and needs no knowledge of the CRDT.

1. **`screenplay_collab_updates`** — the append-only log. Authoritative for convergence.
2. **`screenplay_collab_checkpoints`** — one compacted Yjs state per screenplay, written by the
   compaction job.
3. **`Screenplay.sourceText`** — the canonical Fountain projection. The gateway materialises the
   server-side `Y.Doc` and writes `sourceText` + `sourceByteLength` on the same ~700 ms debounce the
   editor's autosave uses today, bumping `version`. This is a projection, not a merge point: the
   CRDT is always the source of truth for content, so the `409 Conflict` path becomes structurally
   unreachable for text (it stays live for `paperSize`/`filename`, which are not CRDT-managed).

`ScreenplayRevision` is **not** touched by collaboration. It remains the immutable, explicit
checkpoint model, created by `POST /screenplays/:id/checkpoints` from the current `sourceText`,
attributed to `Screenplay.ownerUserId`, quota-checked, and covered by the row-immutability trigger.
Compaction folds the _update log_ into the checkpoint table; it never writes a revision. Anything
else would turn deliberate snapshots back into autosave history, which the screenplay model
explicitly rejects.

### Schema (dump-compatible form)

Appended at the end of `schema.prisma` per house convention, with the same comment the
access-control tables carry. **Plain `uuid`/`TEXT`/`VarChar`/`bytea` columns and indexes; no foreign
key onto `screenplays` or `users`; no shared enum type; no `citext`.** Foreign keys strictly among
tables introduced together are fine.

```prisma
// Live collaboration (ADR: docs/adr-collaboration-engine-and-transport.md). Like the other appended
// operational tables (screenplay_panel_layouts, screenplay_memberships, user_two_factor, ...) these
// carry plain `screenplayId`/`userId` columns with NO relation/foreign key onto the core
// `Screenplay`/`User` tables, no shared enum type and no citext: an older backup dump does not know
// these tables exist, so a `pg_restore --clean` of that dump would be unable to drop a core
// constraint (e.g. screenplays_pkey) or a core type that a dependent column relied on.

model ScreenplayCollabUpdate {
  id            String   @id @default(uuid()) @db.Uuid
  screenplayId  String   @map("screenplay_id") @db.Uuid
  seq           Int
  authorUserId  String   @map("author_user_id") @db.Uuid
  actorClientId String   @map("actor_client_id") @db.VarChar(32)
  payload       Bytes
  byteLength    Int      @map("byte_length")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([screenplayId, seq])
  @@index([screenplayId, createdAt])
  @@map("screenplay_collab_updates")
}

model ScreenplayCollabCheckpoint {
  screenplayId   String   @id @map("screenplay_id") @db.Uuid
  throughSeq     Int      @map("through_seq")
  payload        Bytes
  byteLength     Int      @map("byte_length")
  documentDigest String   @map("document_digest") @db.Char(64)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("screenplay_collab_checkpoints")
}
```

`seq` is `Int` rather than `BigInt` deliberately: 2.1 billion coalesced frames per screenplay is
unreachable, and `Int` avoids `BigInt` serialisation in the SQLite portability lane. `payload` is
`Bytes` (`bytea` on Postgres, `BLOB` on SQLite) — no extension dependency either way.
`documentDigest` is a `CHAR(64)` sha256 of the materialised Fountain text, so compaction can assert
byte-identity before it truncates anything.

Adding these models requires `pnpm sqlite:schema:generate` and committing the regenerated
`schema.sqlite.prisma`, plus a local `scripts/ops/validate-app-backup-roundtrip.ts` run including
the N-1 fixture.

### Compaction

A job on the existing scheduler (`apps/api/src/scheduler/`), registered from a feature module's
`onModuleInit` via `JobRegistry.register({ key: 'collab.compaction', intervalMs, handler })`. Every
tick runs under `SchedulerAdvisoryLock.runExclusively`, which takes a transaction-scoped
`pg_try_advisory_xact_lock` so exactly one replica compacts, and which no-ops the lock entirely when
`runtimeCapabilities().schedulerCoordination === 'single-process'`. Outcomes land in
`scheduled_job_status` like every other job; a failure is recorded and retried on the next tick.

Per screenplay whose log exceeds a row/byte threshold:

1. Load the existing checkpoint (if any) into a fresh `Y.Doc`.
2. Apply every log row with `seq > throughSeq`, in `seq` order.
3. Materialise the text, compare its sha256 against the digest of the current `sourceText`, and
   **abort the fold if they differ**.
4. Write `Y.encodeStateAsUpdate(doc)` as the new checkpoint with the new `throughSeq` and digest.
5. Delete log rows with `seq <= throughSeq`.

**Step 4 uses replay-and-re-encode, never `Y.mergeUpdates` over the log.** This is the measured
result above: `Y.mergeUpdates` over 32,000 single-character updates took 7.5 s and produced 335 KiB,
while replaying the full 168k-update log and re-encoding took 264 ms and produced 164 KiB. Choosing
the wrong one here is a production incident that looks like a slow job.

Steady-state cost: with 100 ms coalescing, a full feature script authored live accumulates ≈0.58 MiB
of log before compaction, folding to a ≈164 KiB checkpoint (≈46 KiB once compressed — gzip stands
in for TOAST in the measurement). The log is derived
state and is **not** counted against the per-owner `sourceByteLength` quota, which continues to
measure the canonical Fountain source.

## Decision 4 — Presence

`y-protocols/awareness`, relayed by the gateway and never persisted. Awareness state per client:

```ts
{
  user: { userId: string; displayName: string; color: string; colorLight: string };
  cursor: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null;
}
```

`y-codemirror.next` writes and reads the `cursor` field itself, so the binding gets remote carets
(`.cm-ySelectionCaret`, a widget decoration carrying the collaborator's name) and remote selection
ranges (`.cm-ySelection`, a mark decoration) without bespoke code — both confirmed rendering in a
second real browser. `user.userId` comes from the server's join acknowledgement, never from the
client, so a client cannot claim another member's identity. Colour is derived deterministically from
`userId` against the design tokens so the same collaborator is the same colour in all 11 themes.

Two non-obvious requirements the skeleton surfaced:

- **Guard the awareness rebroadcast by origin.** Applying a peer's awareness update fires the local
  `awareness.on('update')` handler; without an origin check the room ping-pongs forever. The
  skeleton hit this exactly.
- **Remote carets inside a collapsed boneyard have no rendered position.** `fountain-syntax.ts`
  emits `Decoration.replace` for boneyards ≥240 characters. Clamp the caret to the widget edge, or
  auto-expand the boneyard when a remote caret enters it.

## Decision 5 — Per-user undo

Pass a **single shared `Y.UndoManager` per screenplay** into every `yCollab()` call for that
screenplay. `y-codemirror.next`'s undo plugin calls `undoManager.addTrackedOrigin(syncConf)` on init
and `removeTrackedOrigin` on destroy, where `syncConf` identifies _that_ `EditorView`'s local
binding. Remote updates arrive with the provider's origin and are untracked, so undo is scoped to
this user's own edits automatically — and because split panes each register their own `syncConf` on
the shared manager, "undo my last edit" works across panes, matching how the Edit menu already acts
on the active editor.

This replaces `@codemirror/commands` `history()` while collaborating. That is the single largest
structural change in the editor, because `history()` and `historyKeymap` are buried inside
`basicSetup` at `FountainEditor.tsx:116` and are not compartmentalised. Either wrap them in a
`Compartment` or hand-roll the setup array. The command target's `undo`/`redo` delegation
(`codemirror-command-target.ts:38-39`) is the **only** non-keymap entry point — the Edit menu,
shortcut layer and everything else route through it — so redirecting those two lines plus the keymap
covers the whole surface.

Verified in two real browsers: with the collaborator having typed _above_ the undone range, `Mod-Z`
removed only the invoking user's text, left the collaborator's intact, and both browsers stayed
converged.

## Decision 6 — Offline persistence

`y-indexeddb` (`IndexeddbPersistence`), keyed per screenplay. The browser holds the whole CRDT
locally, so a reload with no network still opens the document, and edits made offline queue as
ordinary Yjs updates.

Reconnect is the standard Yjs handshake and needs no bespoke queue: the client sends its state
vector with `join-screenplay` (16 bytes in the measured two-writer case), the server replies with
exactly the missing delta, and the client pushes `Y.encodeStateAsUpdate(doc, serverStateVector)` —
whatever the server is missing. One round trip. Measured at 20.2 KiB down / 7.3 KiB up after 900
online edits and ~6,000 characters written offline. Confirmed in the browser probe: an offline edit
does not leak while disconnected and replays on reconnect with both clients converging.

`apps/web` already carries `fake-indexeddb` as a dev dependency, so the offline path is unit-testable
without a browser.

The existing `useScreenplayRecovery` local-storage snapshot becomes redundant for content once the
CRDT is the local store. Keep it until the collaboration path is the default, then retire it in a
separate change rather than deleting a recovery mechanism in the same PR that adds a new one.

## Decision 7 — Comment anchors

Range anchors are `Y.RelativePosition` pairs, encoded with `Y.encodeRelativePosition` (10 bytes
each, measured) and stored as `Bytes`. Measured behaviour: after a concurrent writer inserted above
the anchor and deleted 5,000 characters above it, the anchor resolved to the shifted offset with the
quoted range preserved verbatim. When the anchored range itself is deleted, both ends resolve to the
same position — a zero-width point, no exception — which is exactly the signal for "orphaned
thread". Render such a thread as detached, using the stored `quotedText` for context, rather than
deleting it.

```prisma
model ScreenplayCommentThread {
  id           String              @id @default(uuid()) @db.Uuid
  screenplayId String              @map("screenplay_id") @db.Uuid
  authorUserId String              @map("author_user_id") @db.Uuid
  anchorStart  Bytes               @map("anchor_start")
  anchorEnd    Bytes               @map("anchor_end")
  quotedText   String              @map("quoted_text") @db.VarChar(512)
  status       String              @default("OPEN") @db.VarChar(20)
  resolvedAt   DateTime?           @map("resolved_at") @db.Timestamptz(3)
  resolvedById String?             @map("resolved_by_id") @db.Uuid
  createdAt    DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)
  comments     ScreenplayComment[]

  @@index([screenplayId, status])
  @@map("screenplay_comment_threads")
}

model ScreenplayComment {
  id           String                  @id @default(uuid()) @db.Uuid
  threadId     String                  @map("thread_id") @db.Uuid
  authorUserId String                  @map("author_user_id") @db.Uuid
  body         String                  @db.Text
  createdAt    DateTime                @default(now()) @map("created_at") @db.Timestamptz(3)
  editedAt     DateTime?               @map("edited_at") @db.Timestamptz(3)
  deletedAt    DateTime?               @map("deleted_at") @db.Timestamptz(3)
  thread       ScreenplayCommentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@map("screenplay_comments")
}
```

`status` is a plain `VarChar(20)`, not a shared enum — the `InvitationStatus` precedent is exactly
the failure mode ("cannot drop type" on an N-1 restore). The `threadId` foreign key is safe because
both tables are introduced together.

**Commenting requires `read_screenplay`, not `edit_screenplay`.** A viewer's whole purpose is to give
notes; requiring edit rights to comment would make the viewer role useless for the workflow it
exists to serve. Comments do not mutate the screenplay, so this does not widen write access.
Resolving another member's thread requires `edit_screenplay`; deleting another member's comment
requires `manage_screenplay_settings`.

## Decision 8 — Export hygiene

Collaboration metadata never enters an export **by construction**, not by filtering. All three export
paths take a plain Fountain string and nothing else:

- `GET /screenplays/:id/export.fountain` and the checkpoint variant return `sourceText` verbatim.
- `createScreenplayPdf` takes either that string or a preview model derived purely from it.
- `exportFinalDraft(fountain)` in `packages/fountain/src/interchange/fdx.ts` parses that string.

The binding rule that keeps this true: **no collaboration state is ever encoded into `sourceText`.**
CRDT updates, presence and comment threads live in their own tables and their own channels. Nothing
writes a marker, an anchor id or a `[[note]]` into the document.

Regression tests to add: `export.fountain` byte-identical for a screenplay with and without comment
threads, collab-update rows and live presence; the same for PDF bytes and `.fdx` output; and a
screenplay-service assertion that the materialised CRDT text written to `sourceText` equals the Yjs
document text exactly, with no wrapper.

## Editor collision register

The binding in the CM6 issue lands in an editor with real existing behaviour. Verified survey — no
`transactionFilter`, `transactionExtender`, `inputHandler`, `Annotation` or `Prec` exists anywhere in
`apps/web/src`, so the field is clean, but these sites will collide:

| Risk                                                       | Site                                                                   | What must happen                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Critical** — whole-document diff replace                 | `FountainEditor.tsx:189-195`                                           | The controlled `value` prop dispatches a `minimalDocumentChange` diff on every React state change. Two independent string diffs converging on one `Y.Text` produce spurious delete+insert pairs that destroy collaborator intent and any anchors inside the span. The `value`/`onChange` round trip must dissolve: `Y.Text` becomes the sync channel, including between split panes. |
| **High** — `history()` not compartmentalised               | `FountainEditor.tsx:116` (inside `basicSetup`)                         | See Decision 5.                                                                                                                                                                                                                                                                                                                                                                      |
| **High** — typewriter re-centres on every `docChanged`     | `FountainEditor.tsx:159-161`                                           | With typewriter mode on, every remote keystroke smooth-scrolls the local viewport. Gate on a remote-transaction check: `update.transactions.some(tr => tr.annotation(ySyncAnnotation) !== undefined)`.                                                                                                                                                                               |
| **High** — scroll-intent arbiter reset by remote echo      | `FountainEditor.tsx:147-149` → `ScreenplayEditorWorkspace.tsx:101-105` | A remote insert above the viewport fires `onViewportChange`, which calls `scrollIntent.reset()` and wipes a legitimately armed claim, then scrolls the preview. Same annotation gate. Note `revealSource` writes `scrollDOM.scrollTop` directly (`ScreenplayEditorScreen.tsx:249`) and is invisible to transactions — gate that in React.                                            |
| **Medium** — two `EditorView`s per screenplay              | `useActiveScreenplayEditors.ts:18`, `panel-layout-reducer.ts:69-90`    | One `Y.Doc` per screenplay owned above the workspace, threaded into each `FountainEditor` as an extension; awareness per view. `FountainEditor.test.tsx:37-96` is the split-sync regression test to keep green.                                                                                                                                                                      |
| **Medium** — remote caret inside a collapsed boneyard      | `fountain-syntax.ts:365-367`                                           | See Decision 4.                                                                                                                                                                                                                                                                                                                                                                      |
| **Medium** — full re-parse 120 ms after _every_ doc change | `fountain-syntax.ts:432-458`                                           | `deferredFountainDecorationRefresh` does not discriminate by origin, so N collaborators typing becomes a continuous full-document `parseFountain` loop. Extend the debounce for remote-only changes.                                                                                                                                                                                 |
| **Medium** — other whole-doc resets                        | `useScreenplayAutosave.ts:35-46, 64-70, 220-226`                       | `installScreenplay`, `applyRecovery` and `reloadLatest` all assign the draft wholesale and feed the diff channel above. Each must become an explicit `Y.Doc` operation.                                                                                                                                                                                                              |
| **Low** — decoration precedence                            | `fountain-syntax.ts` `StateField` vs a remote-cursor `ViewPlugin`      | Remote selection marks placed after the Fountain layer nest inside per-line decorations and inherit `cm-fountain-*` styling. Expect explicit `Prec` ordering and CSS specificity work.                                                                                                                                                                                               |

`SaveState` needs no new members: the union in `apps/web/src/workspace/shell/save-state.ts:9-10`
(`loading | updating | saving | saved | unsaved | conflict | failed | offline`) already covers
`saving`/`saved`/`offline`. `conflict` becomes unreachable for the text channel and stays live for
`paperSize`.

## Licences

Every dependency this ADR commits to is **MIT**, compatible with a public repository:

| Package             | Version | Licence |
| ------------------- | ------- | ------- |
| `yjs`               | 13.6.31 | MIT     |
| `y-codemirror.next` | 0.3.5   | MIT     |
| `y-protocols`       | 1.0.7   | MIT     |
| `y-indexeddb`       | 9.0.12  | MIT     |
| `lib0` (transitive) | 0.2.117 | MIT     |

Evaluated and rejected: `@automerge/automerge` 3.3.2 (MIT), `@automerge/automerge-codemirror` 0.2.0
(MIT) — the rejection is technical, not licensing. `y-websocket` 3.0.0 (MIT) is not needed under
Decision 2.

These land in the issue that first uses them (`yjs` and `y-protocols` in the server work,
`y-codemirror.next` and `y-indexeddb` in the editor work), not here: this ADR is docs-only.

## Left open, with the decision procedure

1. **Mid-session permission revocation.** The room-join check happens once. `emitToAuthorizedMembers`
   re-checks membership per fan-out for projects, but a _publishing_ client is only checked against
   `socket.data.permissions` captured at join. Options are per-publish re-assertion (a query per
   flush) or an eviction signal from `ScreenplayAccessService` when a membership or role changes.
   **Procedure:** implement the eviction signal first, since role changes already flow through one
   service; measure the per-publish re-assertion cost against the compose test stack, and adopt it
   only if the eviction path proves leaky under the two-client suite.
2. **Compaction thresholds.** Whether to trigger on row count, byte total, or idle time is not
   determinable from a synthetic edit stream. **Procedure:** ship row-count and byte thresholds as
   environment-tunable values with conservative defaults (fold at 2,000 rows or 1 MiB), record the
   observed distribution via the existing `scheduled_job_status` counters, and tighten in a follow-up
   once real documents exist.
3. **Whether the collaborative path is default-on or opt-in per screenplay.** This is a product
   decision, not a technical one, and it changes how much of the current autosave path must keep
   working in parallel. **Procedure:** decide before the editor binding merges; if opt-in, the
   controlled-`value` path in `FountainEditor.tsx` must survive alongside the CRDT path behind a
   prop, which roughly doubles the fidelity matrix.
4. **Presence for read-only members.** Whether a viewer's cursor should be visible to editors is a
   privacy call. **Procedure:** default to showing it (a viewer is an invited collaborator, and the
   membership already discloses their identity) and revisit if a reviewer objects during #155.

## Consequences

- Yjs and `y-codemirror.next` become load-bearing dependencies of the editor; the CM6 setup array
  must be restructured so `history()` is replaceable.
- Two new appended table families join the dump-compatibility discipline; both must appear in the
  backup round-trip fixture and the SQLite portability lane.
- `Screenplay.sourceText` remains the single canonical artefact, so every export path, the parser,
  the preview model and the MCP adapter are untouched by collaboration.
- `ScreenplayRevision` semantics are unchanged: explicit, immutable, owner-attributed checkpoints.
- The realtime gateway gains a second resource type. It stays a single process on a single port, and
  the desktop profile keeps its single-user shortcuts.
- The `409 Conflict` recovery path for screenplay text becomes unreachable while collaborating; its
  UI must not be deleted, because it still serves `paperSize` and the non-collaborative path.
