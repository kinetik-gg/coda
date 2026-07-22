# External REST API

The versioned API at `/api/v1` lets an integration work inside one Coda project. Create a project-scoped API key from **Profile → Developer**, choose only the required permissions, and copy the secret when it is shown. Coda stores only a hash and cannot display the secret again.

The machine-readable contract is available in the repository at [`openapi.json`](openapi.json) and from a running instance at `GET /api/v1/openapi.json`.

## Authentication

Send the API key as a bearer credential:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  -H "Accept: application/json" \
  "$CODA_URL/api/v1/token/context"
```

The context response identifies the single bound `projectId` and the credential permissions. Supplying another project ID returns a not-found response. API keys cannot call setup, login, account, instance-administration, membership, role, invitation, ownership-transfer, workspace-layout, import, trash, or purge routes.

The project-detail response uses the explicit external schema. It omits project membership and role lists as well as internal object-store keys and deletion metadata, even though the browser session view may contain additional collaboration data.

An MCP token uses the same bearer scheme and additionally sends `X-Coda-Token-Audience: mcp`. An API key uses the default `api` audience.

## Response format

JSON resources use a data envelope:

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001"
  }
}
```

Paginated item responses add `meta.nextCursor`. Pass a non-null cursor to the next request without inspecting or modifying it.

Errors use `application/problem+json` and the RFC 9457 problem-details fields. Validation failures can add an `errors` object. Conflict responses indicate a stale record version or a violated project invariant.

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "The record changed; refresh and retry.",
  "requestId": "00000000-0000-4000-8000-000000000002"
}
```

Include the returned request ID when reporting an operational problem.

## Read the project schema

First read the project to discover its configured hierarchy levels and source document. Then list the fields for each level.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID"

curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/entity-types/$ENTITY_TYPE_ID/fields"
```

Do not infer meaning from a level number or field name. Projects define their own level labels and typed fields.

## List and edit items

Item listing is cursor-paginated and requires an entity type:

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $CODA_API_KEY" \
  --data-urlencode "entityTypeId=$ENTITY_TYPE_ID" \
  --data-urlencode "limit=100" \
  --data-urlencode "sort=manual" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/items"
```

Create an item using identifiers returned by the project API:

```sh
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $CODA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entityTypeId":"00000000-0000-4000-8000-000000000010","title":"Opening"}' \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/items"
```

Updates, reordering, and field-value writes require the latest item or field `version`. On `409 Conflict`, fetch the current record, reconcile the intended change, and retry with its new version.

Typed field values use a discriminated `value` object. Clearing a value uses `null`:

```json
{
  "value": {
    "type": "boolean",
    "value": true
  },
  "itemVersion": 3
}
```

The OpenAPI document defines the accepted shapes for text, long text, integer, float, boolean, date, enum, multi-enum, file, image, and video fields.

## Upload a source PDF

Uploads are direct to the instance's private S3-compatible store:

1. `POST /api/v1/uploads` with the project, filename, MIME type, byte size, and kind.
2. Upload the exact bytes to the returned short-lived `uploadUrl` with HTTP `PUT` and the declared content type.
3. `POST /api/v1/projects/{projectId}/uploads/{storageObjectId}/complete` using the returned object version.
4. For a source PDF, `POST /api/v1/projects/{projectId}/source-documents` to attach the ready object.

Source documents must be PDFs. A project has at most one active source document. Page-range references are added to an item with `POST /api/v1/projects/{projectId}/items/{itemId}/source-references` and are validated against the source page count.

Signed upload and download URLs are temporary credentials. Do not log, persist, or share them.

## Activity, comments, and exports

- `GET /api/v1/projects/{projectId}/activity` returns up to 100 newest events. Use the last event ID as the next cursor when the page is full.
- Item comment routes support listing, creation, and author-only edits.
- CSV export downloads one hierarchy level; JSON export downloads the active project model. Binary files are not included.

## Contract maintenance

Request-body schemas in `openapi.json` are generated from `packages/contracts`. Response schemas document stable public fields and are maintained explicitly because runtime response serializers are not yet shared contracts. The generated document records that distinction in `x-coda-contract-generation`.

After changing an external controller or shared request contract, run:

```sh
pnpm openapi:generate
pnpm openapi:check
pnpm --filter @coda/api test
```
