# Open-source credits manifest

The in-app Help → Open Source Credits dialog reads a generated, checked-in
manifest. Its scope is the production dependency closure of `@coda/web` and
`@coda/api`—the renderer and local service shipped to end users—plus font files
bundled directly by the web client. Development-only dependencies and the
separately operated MCP service are excluded. Environment-selected native
optional packages (those declaring `os`, `cpu`, or `libc`) are represented by
their portable parent package rather than emitted as host-specific duplicate
rows. This keeps the checked artifact identical on macOS and Linux.

Regenerate it after changing runtime dependencies or bundled fonts:

```sh
pnpm credits:generate
```

Verify that the checked-in artifact is current:

```sh
pnpm credits:check
```

The generator uses `pnpm licenses list --prod --json`, removes workspace-local
packages and host-selected optional delivery artifacts, de-duplicates
dependencies shared by the two runtime roots, and sorts by license, package
name, and version. It emits no timestamps or local paths.
