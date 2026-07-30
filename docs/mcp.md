# MCP server

Coda's MCP server (`@coda/mcp`, server name `coda`) exposes a small project-scoped tool set over
stdio. It is a thin client for the [external REST API](external-api.md): every tool call becomes an
`/api/v1` request carrying the MCP token. The server never connects to Postgres or object storage,
and it refuses any request path outside `/api/v1/`.

## Create a token

Open **Profile → Developer**, create an **MCP token**, choose a project and the minimum permissions
needed, and copy the token when it appears. Each token is bound to one user and one project.
Revoking the token, disabling the user, removing the user's project membership, or deleting the
project prevents further access.

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

On startup the server resolves `GET /api/v1/token/context` once and caches the bound `projectId`. If
that call fails — bad URL, bad token, unreachable instance — it prints
`Coda MCP server could not start. Check its API URL and MCP token.` to stderr and exits non-zero.
Every request sends `Authorization: Bearer <token>` together with `X-Coda-Token-Audience: mcp`; an
MCP token presented without that header is rejected as invalid.

## Tools

Seven tools are registered. All of them operate on the token's bound project — none takes a project,
screenplay, or Space identifier, and the client re-checks that the project the API returns matches
the token's scope.

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

## What the token cannot reach

An MCP token is a project-scoped bearer credential, so it inherits every restriction in
[What a bearer credential can reach](external-api.md#what-a-bearer-credential-can-reach). In
particular:

- **Spaces are invisible to it.** API credentials are treated as a non-member of every Space, so the
  server exposes no Space tool and the underlying Space routes would return not-found anyway. If the
  token's user can see the bound project only through a Space membership rather than a direct project
  membership, even `projects.get` returns not-found. Grant a direct project membership instead.
- **Screenplays are out of scope.** Screenplay authoring, sharing, comment threads, and live
  collaboration are session-only surfaces with no bearer path.
- The server exposes no tool for instance administration, accounts, project memberships, roles,
  invitations, ownership transfer, project deletion, trash, purge, imports, exports, uploads, source
  attachment, comments, or workspace and panel layouts — and none for unrestricted SQL or storage
  access. Some of those routes would accept a bearer credential; the MCP tool set is deliberately
  narrower than the credential's REST allowlist.

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
