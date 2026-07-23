// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenplayCommandController } from './screenplay-commands';
import { useActiveScreenplayEditors } from './useActiveScreenplayEditors';

afterEach(cleanup);

describe('useActiveScreenplayEditors', () => {
  it('routes commands and selection sync through the explicitly active split editor', async () => {
    const first = createEditor('FIRST');
    const second = createEditor('SECOND', 2);
    const controller = createScreenplayCommandController();
    const onCursorChange = vi.fn();
    const onSourceSelectionChange = vi.fn();
    const hook = renderHook(() =>
      useActiveScreenplayEditors(
        [{ id: 'first' }, { id: 'second' }],
        'first',
        controller,
        onCursorChange,
        onSourceSelectionChange,
      ),
    );

    act(() => {
      hook.result.current.attachEditor('first', first);
      hook.result.current.attachEditor('second', second);
      hook.result.current.handleActiveSlotChange('second');
    });

    expect(onCursorChange).toHaveBeenLastCalledWith(2);
    expect(onSourceSelectionChange).toHaveBeenLastCalledWith({
      anchor: 2,
      head: 2,
      from: 2,
      to: 2,
    });
    await act(() => controller.execute('select-all'));
    expect(second.state.selection.main).toMatchObject({ anchor: 0, head: 6 });
    expect(first.state.selection.main).toMatchObject({ anchor: 0, head: 0 });

    hook.unmount();
    controller.dispose();
    first.destroy();
    second.destroy();
  });
});

function createEditor(document: string, cursor = 0): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: document,
      selection: EditorSelection.single(cursor),
    }),
  });
}
