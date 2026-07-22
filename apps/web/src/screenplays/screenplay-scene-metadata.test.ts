import { describe, expect, it } from 'vitest';
import { buildScreenplayContext } from './screenplay-context-model';
import type { ScreenplayLayoutLine, ScreenplayPreviewModel } from './screenplay-preview-model';
import { buildScreenplaySceneMetadata } from './screenplay-scene-metadata';

const source = `INT. ROOM - DAY

MARA
Hello there.

Mara crosses the room.

EXT. ROAD - NIGHT

Rain falls.
`;

function previewLine(sourceStart: number, baselineY: number): ScreenplayLayoutLine {
  return {
    id: `${String(sourceStart)}-${String(baselineY)}`,
    blockId: String(sourceStart),
    kind: 'action',
    text: '',
    x: 0,
    baselineY,
    width: 0,
    columns: 60,
    align: 'left',
    font: 'regular',
    sourceStart,
    sourceEnd: sourceStart + 1,
  };
}

function preview(): ScreenplayPreviewModel {
  const first = source.indexOf('INT. ROOM');
  const second = source.indexOf('EXT. ROAD');
  return {
    paperSize: 'letter',
    printableBlocks: [],
    scenes: [],
    pages: [
      {
        id: 'page-1',
        pageNumber: 1,
        blocks: [],
        lines: [
          previewLine(first, 700),
          previewLine(first + 20, 688),
          previewLine(second, 676),
        ],
      },
    ],
  };
}

describe('screenplay scene metadata', () => {
  it('returns deterministic lightweight outline estimates from rendered rows and source words', () => {
    const context = buildScreenplayContext(source);

    expect(buildScreenplaySceneMetadata(source, context, preview())).toEqual([
      {
        sceneId: context.scenes[0]!.id,
        sceneIndex: 1,
        wordCount: 9,
        estimatedPages: 0.07,
        estimatedDurationSeconds: 4.2,
        dialogueDensity: 1 / 3,
      },
      {
        sceneId: context.scenes[1]!.id,
        sceneIndex: 2,
        wordCount: 5,
        estimatedPages: 0.02,
        estimatedDurationSeconds: 1.2,
        dialogueDensity: 0,
      },
    ]);
  });

  it('omits preview estimates and density when a scene has no measured content', () => {
    const empty = 'INT. EMPTY - DAY\n';
    const context = buildScreenplayContext(empty);
    const noPreview: ScreenplayPreviewModel = {
      paperSize: 'a4',
      printableBlocks: [],
      scenes: [],
      pages: [],
    };

    expect(buildScreenplaySceneMetadata(empty, context, noPreview)).toEqual([
      {
        sceneId: context.scenes[0]!.id,
        sceneIndex: 1,
        wordCount: 3,
      },
    ]);
  });
});
