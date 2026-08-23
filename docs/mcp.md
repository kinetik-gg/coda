# MCP server

Coda's MCP server (`@coda/mcp`, server name `coda`) exposes a small resource-scoped tool set over
stdio. It is a thin client for the [external REST API](external-api.md): every tool call becomes an
`/api/v1` request carrying the MCP token. The server never connects to Postgres or object storage,
and it refuses any request path outside `/api/v1/`.

Each token binds to exactly one resource — a breakdown **project** or a **tracker** — and the
binding decides which tools exist. A project-bound token gets the seven project tools; a
tracker-bound token gets the six tracker tools. No tool takes a project, tracker, screenplay, or
Space identifier.

## Create a token

Open **Profile → Developer**, create an **MCP token**, choose the bound project or tracker and the
minimum permissions needed, and copy the token when it appears. Each token is bound to one user and
one resource. Revoking the token, disabling the user, removing the user's membership of the bound
resource, or deleting the resource prevents further access.

## Build and configure

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @coda/mcp build
```

Configure an MCP client to start the compiled stdio server. Replace placeholders locally; never
commit the token.

```json
{
  "mcpServers": {
    "coda": {
      "command": "node",
      "args": ["<path-to-coda>/apps/mcp/dist/index.js"],
      "env": {
        "CODA_API_URL": "https://coda.example.com",
        "CODA_MCP_TOKEN": "<project-scoped-mcp-token>"
      }
    }
  }
}
```

| Variable              | Required | Default                 | Rules                                                                                                                            |
| --------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `CODA_API_URL`        | no       | `http://127.0.0.1:3000` | An origin only — no credentials, path, query, or fragment. HTTPS, or HTTP for a loopback host (`localhost`, `::1`, `127.x.x.x`). |
| `CODA_MCP_TOKEN`      | yes      | —                       | Must match `coda_mcp_` followed by at least 32 URL-safe characters.                                                              |
| `CODA_MCP_TIMEOUT_MS` | no       | `10000`                 | Per-request timeout, 1,000–30,000 milliseconds.                                                                                  |

On startup the server resolves `GET /api/v1/token/context` once and caches the binding: a
`resourceType` of `project` with its `projectId`, or `tracker` with its `trackerId`. Only the tools
matching that binding are registered. If the call fails — bad URL, bad token, unreachable instance
— it prints `Coda MCP server could not start. Check its API URL and MCP token.` to stderr and exits
non-zero. Every request sends `Authorization: Bearer <token>` together with
`X-Coda-Token-Audience: mcp`; an MCP token presented without that header is rejected as invalid.

## Tools

The tool set is decided by the token's bound resource. All tools operate on that one resource —
none takes a project, tracker, screenplay, or Space identifier, and the client re-checks that the
resource the API returns matches the token's scope.

### Project-bound tokens

Seven tools are registered for a project-bound token.

| Tool            | Input                                                                                                       | Returns                                                                                                                            | Required credential permission |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `projects.get`  | none                                                                                                        | `id`, `name`, `description`, `version`, `revision`, `updatedAt`, `levels[]` (each with `itemCount`), and `hasSourceDocument`.      | `read_project`                 |
| `schema.get`    | none                                                                                                        | `projectId`, `revision`, and `levels[]`, each with its custom `fields[]` including `type`, `required`, `configuration`, `options`. | `read_project`                 |
| `items.list`    | `entityTypeId` (required), `parentId`, `cursor`, `limit` (1–100, default 50), `sort`, `direction`, `search` | `{ items, nextCursor }`. `nextCursor` is `null` on the last page.                                                                  | `read_project`                 |
| `items.create`  | `entityTypeId` and `title` (required), `parentId`, `displayCode`, `description`, `beforeId`, `afterId`      | The created item.                                                                                                                  | `manage_items`                 |
| `items.update`  | `itemId` and `version` (required) plus at least one of `title`, `displayCode`, `description`, `parentId`    | The updated item.                                                                                                                  | `manage_items`                 |
| `source.get`    | none                                                                                                        | `projectId` and `documents[]` — title, page count, version, and file metadata. No file bytes and no signed URL.                    | `read_project`                 |
| `activity.list` | `cursor` (UUID, optional)                                                                                   | `{ events, nextCursor }`. `nextCursor` is the last event ID only when the page is full at 100 events, otherwise `null`.            | `read_project`                 |

`sort` is one of `manual`, `title`, `code`, `created_at`, `updated_at` (default `manual`);
`direction` is `asc` or `desc` (default `asc`). `parentId` accepts `null` to select root items.
`items.update` uses optimistic concurrency: pass the `version` you last read, and on a conflict
refetch the item, reconcile the intended change, and retry.

`projects.get`, `schema.get`, `items.list`, `source.get`, and `activity.list` are annotated read-only
and idempotent; `items.create` and `items.update` are annotated non-destructive writes. A successful
result is JSON in a single text block plus the same object as `structuredContent`.

### Tracker-bound tokens

Six tools are registered for a tracker-bound token — the project tools above do not exist on it.
Tracker tools mirror their project counterparts: a tracker is a flat record grid, so there is no
hierarchy level to name and no source document.

| Tool                    | Input                                                                                 | Returns                                                                                                                 | Required credential permission |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `trackers.get`          | none                                                                                  | `id`, `name`, `description`, `version`, `revision`, and `updatedAt`.                                                    | `read_tracker`                 |
| `tracker.schema.get`    | none                                                                                  | `trackerId`, `revision`, and `fields[]` with `type`, `required`, `configuration`, `version`, and `options[]`.           | `read_tracker`                 |
| `tracker.items.list`    | `cursor`, `limit` (1–100, default 50), `sort`, `direction`, `search`, `filters[]`     | `{ items, nextCursor }`. Each record carries its value cells. `nextCursor` is `null` on the last page.                  | `read_tracker`                 |
| `tracker.items.create`  | `title` (required), `beforeId`, `afterId`                                             | The created record.                                                                                                     | `edit_tracker_records`         |
| `tracker.items.update`  | `itemId` and `version` (required) plus at least one of `title`, `beforeId`, `afterId` | The updated record.                                                                                                     | `edit_tracker_records`         |
| `tracker.activity.list` | `cursor` (UUID, optional)                                                             | `{ events, nextCursor }`. Pagination matches project activity: last event ID when the page is full at 100, else `null`. | `read_tracker`                 |

`sort` is one of `manual`, `title`, `created_at`, `updated_at` (default `manual`) — a flat grid has
no display code. `filters[]` accepts up to 20 typed field filters, each `{ fieldId, operator,
value }` over the shared operator set (`contains`, `equals`, `not_equals`, comparisons,
`is_empty`/`is_not_empty`, `has_any`/`has_all`; every operator except the emptiness pair requires a
value). Records arrive in manual rank order by default; `tracker.items.create` appends unless
`beforeId`/`afterId` names one adjacent gap, and `tracker.items.update` shares one optimistic
`version` guard between renames and moves.

The same annotation scheme applies: the four reads are read-only and idempotent;
`tracker.items.create` and `tracker.items.update` are non-destructive writes.

## What the token cannot reach

An MCP token is a resource-scoped bearer credential, so it inherits every restriction in
[What a bearer credential can reach](external-api.md#what-a-bearer-credential-can-reach). In
particular:

- **The binding is one-way and total.** A tracker-bound token never sees the project tools, and a
  project-bound token never sees the tracker tools; only the tools for the bound resource are
  registered at startup. The client also refuses to build a request against the other resource
  kind if asked directly.
- **Spaces are invisible to it.** API credentials are treated as a non-member of every Space, so the
  server exposes no Space tool and the underlying Space routes would return not-found anyway. If the
  token's user can see the bound project or tracker only through a Space membership rather than a
  direct membership, even the metadata tool returns not-found. Grant a direct membership instead.
- **Screenplays are out of scope.** Screenplay authoring, sharing, comment threads, and live
  collaboration are session-only surfaces with no bearer path.
- The server exposes no tool for instance administration, accounts, project memberships, roles,
  invitations, ownership transfer, project deletion, trash, purge, imports, exports, uploads, source
  attachment, comments, or workspace and panel layouts — and none for unrestricted SQL or storage
  access. Some of those routes would accept a bearer credential; the MCP tool set is deliberately
  narrower than the credential's REST allowlist.
- **Tracker bindings are narrower still.** Within a tracker-bound token there is no tool for record
  or field deletion, bulk writes, field-option management, comments, cell-value writes (the typed
  per-field write stays REST-only), uploads or storage downloads, CSV exports, sharing, custom
  roles, or workspace layouts — and no tracker creation, listing, settings update, or deletion.
  Renaming records and moving them in manual order is as far as `tracker.items.update` goes; use
  the REST API directly where your credential's permissions allow more.

## Operational guidance

- Use a separate token per client or automation so it can be revoked independently.
- Set an expiry for short-lived integrations.
- Grant only the permissions the tools you actually use require; a missing permission fails the call
  with a bounded forbidden error.
- Treat the token as a password and keep it in the MCP client's secret environment configuration.
- The server writes protocol messages to stdout and startup errors to stderr; it does not print the
  token.
- A failed tool call returns `isError: true` with a bounded message of the form
  `Coda API request failed (<status>): <title>: <detail>`, plus field-level messages for a validation
  failure. Raw responses and stack traces are never surfaced.
