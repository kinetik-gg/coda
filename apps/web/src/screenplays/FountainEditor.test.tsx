// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FountainEditor } from './FountainEditor';

afterEach(cleanup);

describe('FountainEditor', () => {
  it('mounts CodeMirror, synchronizes external source, and handles the save shortcut', async () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const result = render(
      <FountainEditor value="INT. ROOM - DAY" onChange={onChange} onSave={onSave} />,
    );
    const editor = result.container.querySelector('.cm-editor');
    const content = result.container.querySelector('.cm-content');
    expect(editor).toBeInTheDocument();
    expect(content).toHaveTextContent('INT. ROOM - DAY');

    fireEvent.keyDown(content!, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(onSave).toHaveBeenCalledOnce();

    result.rerender(
      <FountainEditor value="EXT. STREET - NIGHT" onChange={onChange} onSave={onSave} />,
    );
    await waitFor(() => expect(content).toHaveTextContent('EXT. STREET - NIGHT'));
    expect(onChange).toHaveBeenCalledWith('EXT. STREET - NIGHT');
  });

  it('uses the latest callbacks without rebuilding the editor', () => {
    const firstSave = vi.fn();
    const latestSave = vi.fn();
    const result = render(
      <FountainEditor value="FADE IN:" onChange={() => undefined} onSave={firstSave} />,
    );
    result.rerender(
      <FountainEditor value="FADE IN:" onChange={() => undefined} onSave={latestSave} />,
    );
    fireEvent.keyDown(result.container.querySelector('.cm-content')!, {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
    });
    expect(firstSave).not.toHaveBeenCalled();
    expect(latestSave).toHaveBeenCalledOnce();
  });
});
