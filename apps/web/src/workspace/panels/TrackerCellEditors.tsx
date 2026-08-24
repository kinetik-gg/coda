import { useEffect, useRef, useState } from 'react';
import { CustomMultiSelect, CustomSelect } from '../../components/CustomSelect';
import type { TrackerField } from '../../trackers/types';
import type { ApiFieldValue } from './item-panel-utils';
import {
  inputForCustom,
  type InspectorEditorKind,
  type InspectorEditorValue as EditorValue,
} from './inspector-values';
import { MediaCellEditor } from '../tracker-media/MediaCellEditor';
import { mediaKindOfField } from '../tracker-media/tracker-media-model';

/**
 * Per-type editors for tracker grid cells (#379, #382). One control per field type: text/number/date
 * inputs commit on Enter and cancel on Escape; long text edits in a popover with explicit
 * actions; boolean and enums are selects; multi-enum is a token editor; file/image/video open
 * the shared media editor with upload progress and replace/remove actions. Tab commits and steps
 * one column sideways so keyboard users can traverse the grid without leaving edit mode.
 */
export function cellEditorKind(field: TrackerField): InspectorEditorKind | 'media' {
  const type = field.type.toLowerCase();
  if (type === 'long_text') return 'multiline';
  if (type === 'integer' || type === 'float') return 'number';
  if (type === 'boolean' || type === 'date' || type === 'enum') return type;
  if (type === 'multi_enum') return 'multi';
  if (type === 'file' || type === 'image' || type === 'video') return 'media';
  return 'text';
}

/** Whether a printable keystroke should jump straight into editing (text-family cells only). */
export function typingOpensEditor(kind: string): boolean {
  return kind === 'text' || kind === 'multiline' || kind === 'number';
}

export interface CellEditorProps {
  /** Owning tracker id; media editors need it for upload and content-URL calls. */
  trackerId?: string;
  field: TrackerField;
  recordId: string;
  /** The stored value already mapped into editor vocabulary by the grid. */
  current: EditorValue;
  /** Seed for typing-to-edit; undefined means "start from the stored value". */
  seed?: string;
  onSave: (value: ApiFieldValue | null, move?: { horizontal: number }) => void;
  onCancel: () => void;
}

export function CellEditor({
  trackerId,
  field,
  recordId,
  current,
  seed,
  onSave,
  onCancel,
}: CellEditorProps) {
  const kind = cellEditorKind(field);
  const [error, setError] = useState<string>();
  const label = `${field.name} for record ${recordId}`;
  const commit = (draft: EditorValue, move?: { horizontal: number }) => {
    try {
      onSave(inputForCustom(field, draft), move);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enter a valid value.');
    }
  };

  if (kind === 'media') {
    return (
      <MediaCellEditor
        trackerId={trackerId ?? ''}
        kind={mediaKindOfField(field)}
        recordId={recordId}
        objectId={typeof current === 'string' && current ? current : null}
        onSave={(value) => onSave(value)}
        onCancel={onCancel}
      />
    );
  }
  if (kind === 'boolean' || kind === 'enum') {
    const options = [
      { value: '', label: '—' },
      ...(kind === 'enum'
        ? field.options.map((option) => ({ value: option.id, label: option.label }))
        : [
            { value: 'true', label: 'True' },
            { value: 'false', label: 'False' },
          ]),
    ];
    return (
      <span className="cell-editor" data-editor-kind={kind}>
        <CustomSelect
          ariaLabel={label}
          autoFocus
          value={Array.isArray(current) ? '' : String(current)}
          placeholder="—"
          onChange={(next) => commit(next)}
          options={options}
        />
      </span>
    );
  }
  if (kind === 'multi') {
    return (
      <MultiTokenEditor
        field={field}
        label={label}
        initial={Array.isArray(current) ? current : []}
        onCommit={commit}
        onCancel={onCancel}
      />
    );
  }
  if (kind === 'multiline') {
    return (
      <LongTextPopover
        label={label}
        initial={seed ?? String(current)}
        onCommit={commit}
        onCancel={onCancel}
      />
    );
  }
  return (
    <span className="cell-editor" data-editor-kind={kind}>
      <ValueInput
        kind={kind}
        label={label}
        initial={seed ?? String(current)}
        onCommit={(draft, move) => commit(draft, move)}
        onCancel={onCancel}
      />
      {error && (
        <small role="alert" className="cell-editor-error">
          {error}
        </small>
      )}
    </span>
  );
}

function ValueInput({
  kind,
  label,
  initial,
  onCommit,
  onCancel,
}: {
  kind: InspectorEditorKind;
  label: string;
  initial: string;
  onCommit: (draft: EditorValue, move?: { horizontal: number }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  // A repeat commit is harmless upstream (equal writes are dropped), so all three commit paths
  // simply forward; validation errors surface inline while the editor stays open.
  const commit = (move?: { horizontal: number }) => onCommit(draft, move);
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commit({ horizontal: event.shiftKey ? -1 : 1 });
    }
  };
  return (
    <input
      ref={ref}
      type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
      step={kind === 'number' ? 'any' : undefined}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={keyDown}
      onBlur={() => commit()}
    />
  );
}

/** The TITLE column editor: a plain text input whose commit renames the record. */
export function TitleCellInput({
  recordId,
  initial,
  seed,
  onCommit,
  onCancel,
}: {
  recordId: string;
  initial: string;
  seed?: string;
  onCommit: (title: string, move?: { horizontal: number }) => void;
  onCancel: () => void;
}) {
  return (
    <ValueInput
      kind="text"
      label={`Title for record ${recordId}`}
      initial={seed ?? initial}
      onCommit={(draft, move) => {
        const title = typeof draft === 'string' ? draft.trim() : '';
        if (title) onCommit(title, move);
      }}
      onCancel={onCancel}
    />
  );
}

function LongTextPopover({
  label,
  initial,
  onCommit,
  onCancel,
}: {
  label: string;
  initial: string;
  onCommit: (draft: EditorValue, move?: { horizontal: number }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <span className="cell-editor-popover" data-editor-kind="multiline">
      <textarea
        ref={ref}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onCommit(draft);
          }
        }}
      />
      <span className="cell-editor-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={() => onCommit(draft)}>
          Save
        </button>
      </span>
    </span>
  );
}

function MultiTokenEditor({
  field,
  label,
  initial,
  onCommit,
  onCancel,
}: {
  field: TrackerField;
  label: string;
  initial: string[];
  onCommit: (draft: EditorValue, move?: { horizontal: number }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(initial);
  return (
    <span className="cell-editor" data-editor-kind="multi">
      <CustomMultiSelect
        ariaLabel={label}
        autoFocus
        value={draft}
        onChange={setDraft}
        options={field.options.map((option) => ({ value: option.id, label: option.label }))}
      />
      <span className="cell-editor-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={() => onCommit(draft)}>
          Save
        </button>
      </span>
    </span>
  );
}
