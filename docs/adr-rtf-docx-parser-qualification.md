# ADR: RTF and DOCX parser dependency qualification

Status: Accepted
Scope: `apps/api/src/imports` — the dependency choice #248 (DOCX) and #249 (RTF) build on.

## Context

The adapter runtime landed in #245 (`apps/api/src/imports/adapter-runtime/`) before any format
adapter beyond the runtime's own test fixture existed. It runs one conversion per throwaway
`worker_threads` thread with:

- No config, DB, network, or filesystem access — an adapter that shells out, spawns a converter
  process (e.g. LibreOffice), or writes a temp file cannot run here.
- A V8 `resourceLimits.maxOldGenerationSizeMb` ceiling, 256 MB by default
  (`SCREENPLAY_ADAPTER_MAX_OLD_GENERATION_MB`). This bounds the **V8 heap only** — a `Buffer`'s
  backing store is external memory the ceiling cannot see
  (`apps/api/src/imports/adapter-runtime/adapters/runtime-test.adapter.ts` calls this out directly
  for its own `#!balloon` fixture).
- A two-tier time bound: a cooperative soft deadline at `SCREENPLAY_ADAPTER_TIMEOUT_MS` (default
  30,000 ms) an adapter can observe via `context.throwIfCancelled()`, and a hard `terminate()` at
  that deadline plus `SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS` that the host enforces regardless
  (`screenplay-adapter-worker-host.ts`). An adapter that never yields to the event loop is killed,
  not reported as an attributable `timeout`.
- Bounded input (20 MB, `SCREENPLAY_ADAPTER_MAX_INPUT_BYTES`), output
  (5,000,000 characters, `SCREENPLAY_ADAPTER_MAX_OUTPUT_CHARACTERS`), and element count (50,000,
  `SCREENPLAY_ADAPTER_MAX_ELEMENTS`).
- Lazy dispatch: `screenplay-adapter-registry.ts` only `import()`s an adapter's module the first
  time its format arrives, so a format's dependency must have no import-time side effects and must
  cost nothing for an unrelated conversion.

Every dependency-bearing change here must also pass `pnpm audit` (zero unresolved advisories),
`pnpm credits:check` (the generated open-source-credits manifest, which fails on a license the
checker cannot classify), and must never be reachable from `apps/web` (that bundle has its own
512,000-byte entry-chunk budget, irrelevant here only because the parser must stay server-side).
The repository ships under MIT (`LICENSE`), so a candidate's own license must be compatible with
redistribution under that license.

The input is hostile by construction: both formats parse user-uploaded files, and DOCX is a ZIP
archive, so it inherits the zip-bomb, deeply-nested-archive, and path-traversal history of every
ZIP-consuming library.

## Method

Fixtures are generated in
[`apps/api/src/imports/parser-qualification/adversarial-zip-fixtures.ts`](../apps/api/src/imports/parser-qualification/adversarial-zip-fixtures.ts):
a zip bomb (a single entry declaring 500 MiB uncompressed from ~510 KB compressed), a "modest"
bomb just over the input ceiling, a path-traversal entry name (`../../../../etc/passwd`), an entry
whose declared size lies about its real inflated size, a 5-level nested archive, a billion-laughs
XML entity expansion, and RTF group-nesting/control-word-flood fixtures for #249 to reuse. Each
candidate below was installed, run against these fixtures, and against `pnpm audit`,
`pnpm view <pkg> license`, and its npm publish history, then removed again if rejected. The chosen
DOCX primitive is checked in at
[`apps/api/src/imports/parser-qualification/bounded-zip-reader.ts`](../apps/api/src/imports/parser-qualification/bounded-zip-reader.ts)
with its test suite.

## Decision: DOCX

**Use `yauzl` for archive access, paired with a streaming/no-DTD XML parser (`sax`) in #248, in
front of a hand-written OOXML paragraph walker. Do not adopt a one-call DOCX library.**

### Rejected candidates

| Candidate                      | Version | License                   | Last publish | Verdict                            |
| ------------------------------ | ------- | ------------------------- | ------------ | ---------------------------------- |
| `mammoth`                      | 1.12.0  | BSD-2-Clause              | 2026-03      | Rejected — see below               |
| `jszip` (mammoth's zip engine) | 3.10.1  | MIT/GPL-3.0-or-later dual | 2025-03      | Rejected — see below               |
| `docx4js`                      | 3.3.0   | MIT                       | 2024-09      | Rejected — ancient transitive deps |
| `officeparser`                 | 7.5.0   | MIT                       | 2026-07      | Rejected — wrong shape entirely    |

**`mammoth` / `jszip`:** `jszip.loadAsync` inflates a whole entry into an in-memory `Buffer` before
the caller can inspect anything about it. Measured against the zip-bomb fixture (a 509,730-byte
deflate stream declaring 524,288,000 bytes): `jszip` produced the full 500 MiB buffer in 1.2 s,
taking process RSS from 47.8 MB to 1,169.0 MB while `heapUsed` moved from 10.6 MB to only 13.8 MB.
The configured 256 MB V8 heap ceiling never saw this allocation — it is external memory — so the
worker host's `ERR_WORKER_OUT_OF_MEMORY` detection (`outOfMemory()` in
`screenplay-adapter-worker-host.ts`) would not fire either; the conversion would consume real
process memory shared with the API's other workers until the OS, not the runtime, intervened. This
is disqualifying on its own. Independently, `mammoth` produces HTML directly and does not track
source offsets or produce a per-element report classification — the issue's own text calls this out
as insufficient ("must prove how it preserves source locations and report classifications rather
than merely producing HTML"), and #248 cannot get that fidelity back out of an HTML string.

**`docx4js`:** pulls `jszip@2.x`, `cheerio@0.22`, and `htmlparser2@3.9` — all multiple major
versions behind current, unmaintained lines with their own histories of fixed CVEs upstream that
this pinned range predates. Last publish of the wrapper itself (2024) does not reflect the age of
what it actually resolves to.

**`officeparser`:** scope mismatch. It is a universal document-to-many-formats converter whose
`docx` path is one of twelve formats, and its dependency tree includes `tesseract.js` and
`pdfjs-dist` for an OCR feature. `tesseract.js` fetches language training data over the network at
run time — a direct violation of the adapter runtime's no-network constraint — and the dependency
weight (OCR engine plus a PDF renderer) is entirely unjustified for parsing a DOCX paragraph tree.

### Why `yauzl`

`yauzl` (3.4.0, MIT, last published 2026-06) exposes a per-entry `Readable` stream instead of an
inflate-then-hand-back-a-buffer API. That is the entire reason a caller can enforce a limit
**during** inflation:

- `entry.uncompressedSize` and `entry.compressedSize` come from the central directory and can be
  checked, and their ratio bounded, before a single byte is decompressed
  (`bounded-zip-reader.ts`'s `guardEntry`). Both the zip-bomb and modest-bomb fixtures are rejected
  at this stage — confirmed by the test suite, with zero bytes streamed.
- The streaming reader counts bytes as they arrive and destroys the stream past a cap — this is
  checked independently of the declared size, so a lie in the header does not help. Tested with a
  fixture whose header declares 100 bytes but whose real deflate stream is 60 MiB: `yauzl` itself
  detected the mismatch after the first 16,384-byte chunk and errored with "too many bytes in the
  stream" — before this reader's own cap logic even had to act.
- `yauzl` rejects `..`-relative and absolute entry names by construction (observed: "invalid
  relative path" on the `../../../../etc/passwd` fixture), which `bounded-zip-reader.ts` also
  normalizes to its own `unsafe-entry-name` reason and re-checks itself so the behavior does not
  depend on `yauzl` alone.
- `yauzl`'s only dependency is `pend` (a tiny callback-counting helper); `pnpm audit` reports no
  advisory for either package, and `pnpm credits:check` classifies both licenses (MIT) cleanly.

For the XML side (`word/document.xml` and its relationships), `sax` (1.6.1, BlueOak-1.0.0, last
published 2026-07) was checked against the billion-laughs fixture
(`adversarial-zip-fixtures.ts#billionLaughsXml`): it only recognizes the five predefined XML
entities and rejected the custom `<!ENTITY>` expansion outright ("Invalid character entity") rather
than resolving it — DTD/entity expansion is not a code path that exists to disable, it is simply
never implemented. Combined with its streaming (SAX) API, it lets #248 walk `document.xml` without
holding a DOM tree in memory and without an entity-expansion attack surface. `sax` and `yauzl` are
both added to `apps/api/package.json` now; `@types/yauzl` is a dev dependency for the primitive's
types.

### What #248 must still do

- Reuse `readBoundedZipEntry` (or extend it) for every OOXML part it reads, with limits derived
  from `resolveScreenplayAdapterLimits()` rather than new constants.
- Enforce the same declared-size/ratio checks recursively if it ever opens an entry that is itself
  an archive (DOCX does not nest archives under normal production, but the nested-zip fixture
  documents that the reader composes if that assumption is ever wrong).
- Reject any `r:id` relationship or `Content_Types` override that resolves outside the archive's
  own namespace before dereferencing it — `yauzl`'s protection is on physical zip entry names, not
  on relationship indirection a malicious `document.xml` could still construct.
- Call `context.throwIfCancelled()` between top-level XML elements (SAX gives natural
  per-element yield points) so long documents cooperate with the soft deadline instead of relying
  solely on the hard `terminate()`.

## Decision: RTF

**Ship no third-party RTF parsing dependency. Write a purpose-built, depth-bounded RTF tokenizer in
#249.**

### Rejected candidates

| Candidate           | Version | License | Last publish | Verdict                                               |
| ------------------- | ------- | ------- | ------------ | ----------------------------------------------------- |
| `rtf-parser`        | 1.3.3   | ISC     | 2022-06      | Rejected — unmaintained, crashes on adversarial input |
| `rtf.js`            | 3.0.9   | MIT     | 2022-07      | Rejected — unmaintained, browser/canvas-oriented      |
| `word-extractor`    | 1.0.4   | MIT     | 2022-06      | Rejected — parses legacy `.doc` OLE2, not RTF         |
| `rtf-stream-parser` | 3.8.1   | MIT     | 2025-11      | Rejected — wrong problem                              |

**`rtf-parser`:** tested against a 200,000-level deeply nested group fixture
(`deeplyNestedRtfGroups()`). It crashed with an uncaught `RangeError: Maximum call stack size
exceeded` thrown synchronously out of `RTFGroup.getStyle`'s recursive walk, outside of its own
callback-style error path — the caller's `(err, result) => ...` callback never received the error,
because the call stack blew up on the parser's own internal recursion, not the tokenizer, before
its documented API had a chance to catch it cleanly. Inside the adapter runtime this would surface
as `worker.onError` firing without `ERR_WORKER_OUT_OF_MEMORY` (an `internal` failure, not an
attributable parse rejection) — survivable, but with no useful diagnostic, and it demonstrates the
library was never hardened against nesting depth. Combined with no publish since 2022, it is not a
dependency this project should carry.

**`rtf.js`:** also last published 2022, and its architecture assumes a `<canvas>` for rendering
embedded pictures — a browser/DOM dependency with no purpose in a server-side worker thread.

**`word-extractor`:** parses the legacy binary `.doc` OLE2 compound-file format, not RTF, despite
adjacent branding; wrong format entirely, and also unmaintained since 2022.

**`rtf-stream-parser`:** actively maintained (2025-11) and the only candidate with a real update
cadence, but it solves a narrower, different problem: _de-encapsulating_ RTF that exists only as a
wrapper around plain text or HTML, per `[MS-OXRTFEX]` — the format Outlook/Exchange produce for
mail bodies. It is not a general RTF-to-structured-document parser; it does not expose element or
run-level structure, formatting, or source offsets for a document that was authored as RTF (e.g. a
screenplay exported from a word processor), which is what #249 actually needs to produce a
per-element conversion report. Adopting it would mean writing the same structural walker on top of
it that a purpose-built tokenizer needs anyway, for no security or maintenance benefit.

### Why purpose-built

RTF's grammar is a bounded, well-specified token stream: balanced `{`/`}` groups, `\controlword`
(optionally signed numeric parameter) and `\controlsymbol` tokens, and literal text with `\'hh`
hex-escaped bytes. There is no external DTD-equivalent, no schema indirection, and no archive
layer — the entire attack surface is unbounded nesting depth, unbounded control-word/run counts,
and oversized embedded binary (`\bin`) or hex-escape runs, all of which are directly bounded by the
same primitives #249 needs regardless of dependency choice:

- An explicit group-depth counter that raises a `ScreenplayAdapterSourceError` past a fixed limit,
  rather than recursing with the call stack (the `deeplyNestedRtfGroups()` and
  `rtfControlWordFlood()` fixtures in `adversarial-zip-fixtures.ts` are sized for exactly this
  check).
- A running output-character counter checked against `resolveScreenplayAdapterLimits()` as tokens
  are emitted, not after the document is fully walked.
- `context.throwIfCancelled()` on every group boundary or every N tokens, which only a tokenizer
  #249 controls directly can guarantee — no black-box library exposes this hook, and none of the
  four rejected candidates offer cancellable, chunked parsing.

A hand-written tokenizer also carries zero new `pnpm audit` surface, zero new license to
reconcile, and no lazy-`import()` cost beyond the module itself. If a future candidate emerges with
an active maintenance record, a general (not de-encapsulation-only) RTF object model, and evidence
of bounded recursion, it should be re-evaluated against these same fixtures before RTF import ships
past its current test-format-only fallback.

## Consequences

- `apps/api/package.json` gains `yauzl` and `sax` as runtime dependencies and `@types/yauzl` as a
  dev dependency. No RTF dependency is added.
- `pnpm audit`, `pnpm credits:check`, and `pnpm quality` are green with these two additions (see the
  PR's verification section for command output).
- #248 builds its DOCX adapter on `readBoundedZipEntry` plus a `sax`-based OOXML walker and must
  implement the recursive-archive and relationship-indirection mitigations noted above.
- #249 builds a purpose-built RTF tokenizer with explicit depth and byte counters; it does not
  block on a dependency decision because there is no dependency.
- If a document import format is ever found where no acceptable dependency exists and a
  purpose-built parser is out of scope, the honest answer is to not ship that format's import
  rather than adopt an unmaintained or scope-mismatched library — this ADR's RTF decision is that
  answer applied narrowly (a minimal tokenizer, not "no RTF at all"), because RTF's grammar is
  simple enough to make purpose-built tractable.
