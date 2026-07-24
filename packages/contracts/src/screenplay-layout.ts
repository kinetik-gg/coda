import { z } from 'zod';

/**
 * Server-side envelope for a screenplay's per-user panel layout.
 *
 * The full structural schema of the layout tree (`screenplayPanelLayoutSchema`) lives in the web
 * app, where it depends on browser-only panel reducers and UUID helpers. The server therefore
 * treats the layout as an opaque JSON document but pins the envelope it needs to reason about
 * safely: a positive-integer `schemaVersion` (so migrations remain analysable and the stored
 * `schema_version` column can be kept in sync) and a byte cap that bounds row size. Structural
 * validity of the tree is enforced client-side on read, mirroring how the breakdown workspace
 * validates `workspaceLayoutSchema` against a schema that happens to be shared.
 */
export const SCREENPLAY_LAYOUT_MAX_BYTES = 64 * 1024;

export const screenplayLayoutSchema = z
  .object({ schemaVersion: z.number().int().positive() })
  .passthrough()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <= SCREENPLAY_LAYOUT_MAX_BYTES,
    { message: 'Screenplay layout exceeds the maximum stored size' },
  );
export type ScreenplayLayout = z.infer<typeof screenplayLayoutSchema>;

export const saveScreenplayLayoutSchema = z
  .object({
    layout: screenplayLayoutSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type SaveScreenplayLayout = z.infer<typeof saveScreenplayLayoutSchema>;
