// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportFinalDraft } from '@coda/fountain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createScreenplayCommentAnchor } from './screenplay-comment-anchors';
import { createScreenplayPdf } from './screenplay-pdf-export';

const fontDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../assets/fonts/courier-prime',
);

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return 'url' in input ? input.url : input.href;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const source = requestUrl(input);
      const filename = basename(source.split('?')[0] ?? source);
      return new Response(await readFile(join(fontDirectory, filename)), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function exportArtifacts(sourceText: string) {
  return {
    fountain: new TextEncoder().encode(sourceText),
    pdf: await createScreenplayPdf(sourceText, 'letter'),
    fdx: new TextEncoder().encode(exportFinalDraft(sourceText).content),
  };
}

describe('screenplay collaboration export hygiene', () => {
  it('keeps Fountain, PDF, and FDX byte-identical when collaboration metadata exists', async () => {
    const sourceText = `Title: Clean Export

INT. ROOM - DAY

ALICE
This is script content only.
`;
    const withoutCollaboration = await exportArtifacts(sourceText);
    const document = new Y.Doc();
    const text = document.getText('source');
    text.insert(0, sourceText);
    const selectionStart = sourceText.indexOf('script content');
    const collaborationState = {
      threads: [
        {
          id: 'thread-secret-157',
          ...createScreenplayCommentAnchor(
            text,
            selectionStart,
            selectionStart + 'script content'.length,
          ),
          comments: [{ body: 'collaboration-metadata-must-not-export' }],
        },
      ],
      updates: [Y.encodeStateAsUpdate(document)],
      presence: [{ userId: 'presence-user-157', displayName: 'Collaborator' }],
    };
    expect(collaborationState.threads).toHaveLength(1);

    const withCollaboration = await exportArtifacts(sourceText);

    expect(withCollaboration.fountain).toEqual(withoutCollaboration.fountain);
    expect(withCollaboration.pdf).toEqual(withoutCollaboration.pdf);
    expect(withCollaboration.fdx).toEqual(withoutCollaboration.fdx);
    expect(new TextDecoder().decode(withCollaboration.fountain)).not.toContain('thread-secret-157');
    expect(new TextDecoder().decode(withCollaboration.fdx)).not.toContain(
      'collaboration-metadata-must-not-export',
    );
  });
});
