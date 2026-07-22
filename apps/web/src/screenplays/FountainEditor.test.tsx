// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { EditorView } from '@codemirror/view';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FountainEditor } from './FountainEditor';
import { typewriterScrollDelta } from './fountain-editor-ergonomics';
import { buildScreenplayPreview } from './screenplay-preview-model';

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

  it('reconfigures line numbers without rebuilding the editor document', async () => {
    let view: EditorView | undefined;
    const result = render(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        showLineNumbers={false}
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );
    const host = result.getByLabelText('Screenplay editor');
    expect(host).toHaveAttribute('data-show-line-numbers', 'false');
    expect(result.container.querySelector('.cm-lineNumbers')).not.toBeInTheDocument();
    const originalView = view;

    result.rerender(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        showLineNumbers
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );
    expect(host).toHaveAttribute('data-show-line-numbers', 'true');
    await waitFor(() =>
      expect(result.container.querySelector('.cm-lineNumbers')).toBeInTheDocument(),
    );
    expect(view).toBe(originalView);
    expect(view?.state.doc.toString()).toBe('INT. ROOM - DAY');

    result.rerender(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        showLineNumbers={false}
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );
    await waitFor(() =>
      expect(result.container.querySelector('.cm-lineNumbers')).not.toBeInTheDocument(),
    );
    expect(view).toBe(originalView);
    expect(view?.state.doc.toString()).toBe('INT. ROOM - DAY');
  });

  it('publishes deterministic page-column geometry for responsive padding', () => {
    const result = render(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        paperSize="letter"
      />,
    );
    const host = result.getByLabelText('Screenplay editor');
    expect(host).toHaveAttribute('data-editor-columns', '63');
    expect(host).toHaveAttribute('data-min-horizontal-padding', '72');
    expect(host).toHaveStyle({
      '--fountain-page-width': '63ch',
      '--fountain-half-page-width': '31.5ch',
    });
  });

  it('exposes estimated page breaks as a toggle without changing the document', () => {
    const result = render(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        showPageBreaks={false}
      />,
    );
    const host = result.getByLabelText('Screenplay editor');
    expect(host).toHaveAttribute('data-show-page-breaks', 'false');

    result.rerender(
      <FountainEditor
        value="INT. ROOM - DAY"
        onChange={() => undefined}
        onSave={() => undefined}
        showPageBreaks
      />,
    );
    expect(host).toHaveAttribute('data-show-page-breaks', 'true');
    expect(result.container.querySelector('.cm-content')).toHaveTextContent('INT. ROOM - DAY');
  });

  it('marks pagination-derived source lines with their estimated page number', () => {
    const source = Array.from(
      { length: 24 },
      (_, index) => `Action paragraph ${String(index + 1)}.`,
    ).join('\n\n');
    const previewModel = buildScreenplayPreview(source, { linesPerPage: 10 });
    const result = render(
      <FountainEditor
        value={source}
        onChange={() => undefined}
        onSave={() => undefined}
        previewModel={previewModel}
      />,
    );

    expect(result.container.querySelector('[data-fountain-page-index="1"]')).toBeInTheDocument();
    expect(result.container.querySelector('[data-fountain-page-index="2"]')).toBeInTheDocument();
  });

  it('reports the actual caret offset independently from the viewport', () => {
    const onSelectionChange = vi.fn();
    const onSourceSelectionChange = vi.fn();
    let view: EditorView | undefined;
    render(
      <FountainEditor
        value={'FIRST\nSECOND\nTHIRD'}
        onChange={() => undefined}
        onSave={() => undefined}
        onReady={(nextView) => {
          view = nextView;
        }}
        onSelectionChange={onSelectionChange}
        onSourceSelectionChange={onSourceSelectionChange}
      />,
    );

    view?.dispatch({ selection: { anchor: 10 } });

    expect(onSelectionChange).toHaveBeenLastCalledWith(10);
    expect(onSourceSelectionChange).toHaveBeenLastCalledWith({
      anchor: 10,
      head: 10,
      from: 10,
      to: 10,
    });
  });

  it('marks the active Fountain paragraph for optional focus mode', () => {
    let view: EditorView | undefined;
    const source = ['FIRST PARAGRAPH', '', 'SECOND LINE ONE', 'SECOND LINE TWO'].join('\n');
    const result = render(
      <FountainEditor
        value={source}
        onChange={() => undefined}
        onSave={() => undefined}
        focusModeEnabled
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );

    expect(result.getByLabelText('Screenplay editor')).toHaveAttribute('data-focus-mode', 'true');
    view?.dispatch({ selection: { anchor: source.indexOf('SECOND') } });

    const focusedLines = result.container.querySelectorAll('.cm-fountain-focus-paragraph');
    expect(focusedLines).toHaveLength(2);
    expect(focusedLines[0]).toHaveTextContent('SECOND LINE ONE');
    expect(focusedLines[1]).toHaveTextContent('SECOND LINE TWO');
    expect(focusedLines[0]).toHaveClass('cm-fountain-focus-line');
    expect(focusedLines[1]).not.toHaveClass('cm-fountain-focus-line');
    expect(result.container.querySelector('.cm-line')).not.toHaveClass(
      'cm-fountain-focus-paragraph',
    );
  });

  it('keeps typewriter scrolling controlled without rebuilding the editor', async () => {
    let view: EditorView | undefined;
    const result = render(
      <FountainEditor
        value={'FIRST\n\nSECOND'}
        onChange={() => undefined}
        onSave={() => undefined}
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );
    const originalView = view;

    result.rerender(
      <FountainEditor
        value={'FIRST\n\nSECOND'}
        onChange={() => undefined}
        onSave={() => undefined}
        typewriterScrollingEnabled
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );

    expect(result.getByLabelText('Screenplay editor')).toHaveAttribute(
      'data-typewriter-scrolling',
      'true',
    );
    await waitFor(() => expect(view).toBe(originalView));
    expect(view?.state.doc.toString()).toBe('FIRST\n\nSECOND');
  });

  it('places the typewriter caret at forty percent of the visible editor', () => {
    expect(typewriterScrollDelta(420, 100, 500)).toBe(120);
    expect(typewriterScrollDelta(300, 100, 500)).toBe(0);
    expect(typewriterScrollDelta(280, 100, 500)).toBe(0);
    expect(typewriterScrollDelta(350, 100, 500)).toBe(50);
  });

  it('keeps Fountain source intact while adding semantic line and token styling', () => {
    let view: EditorView | undefined;
    const source = [
      'Title: Example',
      '',
      '.INT. ROOM - DAY #12#',
      '',
      '!Forced action.',
      '',
      '@NARRATOR (V.O.)^',
      '(quietly)',
      'This is *dialogue*.',
      '',
      '>THE END<',
      '',
      '## Act Two',
      '=A darker turn',
      '',
      '~A lyric line',
      '',
      '>CUT TO:',
      '',
      '===',
      '',
      '[[A note]]',
      '',
      '/* A short boneyard */',
    ].join('\n');
    const result = render(
      <FountainEditor
        value={source}
        onChange={() => undefined}
        onSave={() => undefined}
        onReady={(nextView) => {
          view = nextView;
        }}
      />,
    );

    expect(view?.state.doc.toString()).toBe(source);
    expect(result.container.querySelector('[data-fountain-kind="scene"]')).toHaveTextContent(
      '.INT. ROOM - DAY #12#',
    );
    expect(result.container.querySelector('[data-fountain-kind="character"]')).toHaveTextContent(
      '@NARRATOR (V.O.)^',
    );
    expect(
      result.container.querySelector('[data-fountain-kind="parenthetical"]'),
    ).toHaveTextContent('(quietly)');
    expect(result.container.querySelector('[data-fountain-kind="dialogue"]')).toHaveTextContent(
      'This is *dialogue*.',
    );
    expect(result.container.querySelector('.cm-fountain-title-key')).toHaveTextContent('Title:');
    expect(result.container.querySelector('.cm-fountain-scene-prefix')).toHaveTextContent('INT.');
    expect(result.container.querySelector('.cm-fountain-scene-number')).toHaveTextContent('#12#');
    expect(result.container.querySelector('.cm-fountain-character-extension')).toHaveTextContent(
      '(V.O.)',
    );
    expect(result.container.querySelector('[data-fountain-section-depth="2"]')).toHaveTextContent(
      '## Act Two',
    );
    expect(result.container.querySelector('[data-fountain-kind="synopsis"]')).toHaveTextContent(
      '=A darker turn',
    );
    expect(result.container.querySelector('[data-fountain-kind="lyric"]')).toHaveTextContent(
      '~A lyric line',
    );
    expect(result.container.querySelector('[data-fountain-kind="transition"]')).toHaveTextContent(
      '>CUT TO:',
    );
    expect(result.container.querySelector('[data-fountain-kind="page-break"]')).toHaveTextContent(
      '===',
    );
    expect(result.container.querySelectorAll('.cm-fountain-marker').length).toBeGreaterThan(5);
  });

  it('maps existing decorations during typing and refreshes syntax after the edit burst', () => {
    vi.useFakeTimers();
    try {
      let view: EditorView | undefined;
      const result = render(
        <FountainEditor
          value="A plain action."
          onChange={() => undefined}
          onSave={() => undefined}
          onReady={(nextView) => {
            view = nextView;
          }}
        />,
      );

      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'INT. ROOM - DAY' },
      });
      expect(result.container.querySelector('[data-fountain-kind="action"]')).toHaveTextContent(
        'INT. ROOM - DAY',
      );

      vi.advanceTimersByTime(120);
      expect(result.container.querySelector('[data-fountain-kind="scene"]')).toHaveTextContent(
        'INT. ROOM - DAY',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses long imported boneyards without removing their source', () => {
    const metadata = `/* Review Ranges: ${'revision-data '.repeat(30)} */`;
    const result = render(
      <FountainEditor value={metadata} onChange={() => undefined} onSave={() => undefined} />,
    );

    const summary = result.getByRole('button', { name: /imported revision metadata/i });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(result.container.querySelector('.cm-content')).not.toHaveTextContent('revision-data');

    fireEvent.click(summary);
    expect(result.getByRole('button', { name: /collapse boneyard/i })).toBeInTheDocument();
    expect(result.container.querySelector('.cm-content')).toHaveTextContent('revision-data');
  });
});
