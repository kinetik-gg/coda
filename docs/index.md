# Coda documentation

Coda is a self-hosted workspace for Fountain-native screenplay writing and structured source
breakdowns. Screenplays are collaborative Fountain documents; a breakdown combines a
one-to-three-level hierarchy, typed custom fields, source-page references, comments, activity, and
recoverable deletion. Both live inside **Spaces**, the containers that group resources and share
them with a team.

Each document below states who it is for and what it answers.

## Start here

| Document                                | Audience     | Answers                                                                                                                                            |
| --------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)         | Contributors | How the system is built: package boundaries, Spaces and the two access graphs, live collaboration, and the rules a new database table must follow. |
| [Deploy with generic Docker](docker.md) | Operators    | The exact generic Docker support boundary, release-bundle install steps, and lifecycle qualification checklist.                                    |
| [Deploy with Coolify](coolify.md)       | Operators    | The fastest path to a running instance: one-click service templates and the supported topologies.                                                  |
| [External REST API](external-api.md)    | Integrators  | How to authenticate and work with breakdown data from outside Coda.                                                                                |

## Deploy and operate

For operators running an instance.

- [Deploy with generic Docker](docker.md) — the supported host and app-only topology, verified
  release-bundle install path, and lifecycle qualification checklist.
- [Deploy with Coolify](coolify.md) — the one-click service templates, the canonical app-only
  topology, the standalone object-storage stack, and the all-in-one full-stack quickstart.
- [Deployment and operations](operations.md) — the full topology, environment contract, in-app
  backups, storage migration, the update checker and upgrade ceremony, the doctor page, and metrics.
- [Security model](security.md) — credential, authorization, storage, and deployment controls.
- [Required checks on `main`](ci-required-checks.md) — the branch-protection status checks
  recorded as a committed manifest, and why `Classify changes` is not one of them.
- [Data compatibility](data-compatibility.md) — the standing policy operators depend on and
  contributors must follow: backup-format versions and the N / N-1 / N-2 import window, forward-only
  expand–contract migrations, and schema-versioned config blobs.

## Understand the system

For contributors changing Coda.

- [Architecture](architecture.md) — the system as built, and the entry point to the ADRs below. Read
  this before adding a database table, a resource type, or anything that touches authorization.

### Architecture decisions

Each ADR records one decision, its constraints, and what a future contributor must not undo. The
architecture overview links to them from the relevant section.

- [Spaces containers and additive access](adr-spaces.md) — why resource placement is a join table
  rather than a column, why access is `resourceMember OR spaceMember`, why the upgrade creates zero
  memberships, and why the Default Space is high-exposure by design.
- [Screenplay access control](adr-screenplay-access-control.md) — screenplay-scoped memberships,
  roles, invitations, ownership transfer, and the permission vocabulary the Space tiers project
  into.
- [Collaboration engine and transport](adr-collaboration-engine-and-transport.md) — the CRDT engine,
  socket transport, durable update log and compaction, presence protocol, undo model, comment
  anchoring, and export hygiene for live screenplay collaboration.
- [RTF and DOCX parser dependency qualification](adr-rtf-docx-parser-qualification.md) — why DOCX
  access is built on `yauzl` and `sax` rather than a one-call library, why RTF import is
  purpose-built with no new dependency, and the adversarial fixtures behind both decisions.

## Build against Coda

For integrators and tool authors.

- [External REST API](external-api.md) — authenticate and work with breakdown data.
- [MCP server](mcp.md) — connect an MCP client to one Coda breakdown.
- [Reference for language models](llm.md) — a condensed orientation for an LLM integrating with
  Coda: which surface to use, how credentials are scoped, and the naming compatibility between the
  `projects` REST paths and the "breakdown" product term. See also [llms.txt](llms.txt).

The [OpenAPI 3.1 document](openapi.json) is generated from Coda's shared request contracts where
possible. Run `pnpm openapi:check` to verify that it is current.

## Attribution

- [Open-source credits](open-source-credits.md) — how the generated credits manifest behind Help →
  Open Source Credits is scoped and regenerated.
