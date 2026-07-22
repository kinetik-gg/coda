import type { EditorView } from '@codemirror/view';

export type FountainFormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'transition'
  | 'lyric'
  | 'centered'
  | 'note'
  | 'page-break';

const wrappers: Partial<Record<FountainFormatCommand, readonly [string, string]>> = {
  bold: ['**', '**'],
  centered: ['> ', ' <'],
  italic: ['*', '*'],
  note: ['[[', ']]'],
  parenthetical: ['(', ')'],
  underline: ['_', '_'],
};

const markers: Partial<Record<FountainFormatCommand, string>> = {
  action: '!',
  character: '@',
  lyric: '~',
  'scene-heading': '.',
  transition: '> ',
};

export function applyFountainFormat(view: EditorView, command: FountainFormatCommand): boolean {
  if (command === 'page-break') {
    const position = view.state.selection.main.head;
    const line = view.state.doc.lineAt(position);
    const insert = `${line.to === view.state.doc.length ? '\n' : ''}\n===\n`;
    view.dispatch({
      changes: { from: line.to, insert },
      selection: { anchor: line.to + insert.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const wrapper = wrappers[command];
  if (wrapper) {
    const [open, close] = wrapper;
    const insert = `${open}${selectedText}${close}`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: selectedText
        ? {
            anchor: selection.from + open.length,
            head: selection.from + open.length + selectedText.length,
          }
        : { anchor: selection.from + open.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  const marker = markers[command];
  if (!marker) return false;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes = [];
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const text = line.text.trimStart();
    const whitespace = line.text.slice(0, line.text.length - text.length);
    const knownMarker = /^[.!@~>]+\s*/u.exec(text)?.[0] ?? '';
    changes.push({
      from: line.from,
      to: line.from + whitespace.length + knownMarker.length,
      insert: `${whitespace}${marker}`,
    });
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
  return true;
}
