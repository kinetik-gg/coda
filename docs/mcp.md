# MCP server

Coda's MCP server exposes a small project-scoped tool set over stdio. It uses the external REST API; it does not connect directly to Postgres or object storage.

## Create a token

Open **Profile → Developer**, create an **MCP token**, choose a project and the minimum permissions needed, and copy the token when it appears. Each token is bound to one user and one project. Revoking the token, disabling the user, removing the user's project membership, or deleting the project prevents further access.

## Build and configure

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @coda/mcp build
```

Configure an MCP client to start the compiled stdio server. Replace placeholders locally; never commit the token.

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

`CODA_API_URL` must be an HTTPS origin without credentials, a path, query parameters, or a fragment. Plain HTTP is accepted only for loopback development origins such as `http://127.0.0.1:3000`. `CODA_MCP_TIMEOUT_MS` is optional and accepts 1,000–30,000 milliseconds; the default is 10,000.

## Tools

| Tool            | Behavior                                                                      | Required capability |
| --------------- | ----------------------------------------------------------------------------- | ------------------- |
| `projects.get`  | Returns safe metadata and hierarchy levels for the bound project.             | Read project        |
| `schema.get`    | Returns hierarchy levels, fields, and enum options.                           | Read project        |
| `items.list`    | Returns one bounded page of active items.                                     | Read project        |
| `items.create`  | Creates one item in an existing level.                                        | Manage items        |
| `items.update`  | Updates one item using optimistic concurrency.                                | Manage items        |
| `source.get`    | Returns source-document and storage metadata, not file bytes or a signed URL. | Read project        |
| `activity.list` | Returns up to 100 recent project events.                                      | Read project        |

The MCP server does not expose instance administration, accounts, memberships, roles, invitations, project ownership, project deletion, trash, purge, imports, workspace layout, or unrestricted SQL/storage access.

## Operational guidance

- Use a separate token per client or automation so it can be revoked independently.
- Set an expiry for short-lived integrations.
- Treat the token as a password and keep it in the MCP client's secret environment configuration.
- The server writes protocol messages to stdout and startup errors to stderr; it does not print the token.
- A failed tool call returns a bounded public error rather than a raw server response or stack trace.
