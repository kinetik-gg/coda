import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CustomMultiSelect, CustomSelect } from '../../components/CustomSelect';
import { Tooltip } from '../../components/Tooltip';
import type {
  InspectorEditorKind as EditorKind,
  InspectorEditorValue as EditorValue,
} from './inspector-values';
import styles from './Panels.styles';

type EditorControl = HTMLInputElement | HTMLTextAreaElement;

export function InlineValue({
  value,
  display,
  kind = 'text',
  options = [],
  onSave,
}: {
  value: EditorValue;
  display?: ReactNode;
  kind?: EditorKind;
  options?: Array<{ id: string; label: string }>;
  onSave: (value: EditorValue) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditorValue>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [editingHeight, setEditingHeight] = useState<number>();
  const cancelBlur = useRef(false);
  const editorRef = useRef<EditorControl>(null);
  const shellRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);
  useLayoutEffect(() => {
    if (editing) editorRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const captureEditor = (control: EditorControl | null) => {
    editorRef.current = control;
  };
  const beginEditing = () => {
    cancelBlur.current = false;
    setEditingHeight(shellRef.current?.getBoundingClientRect().height);
    setDraft(value);
    setError(undefined);
    setEditing(true);
  };
  const cancel = () => {
    cancelBlur.current = true;
    setDraft(value);
    setError(undefined);
    setEditing(false);
    setEditingHeight(undefined);
  };
  const save = async (nextDraft: EditorValue = draft) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(nextDraft);
      setEditing(false);
      setEditingHeight(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Value could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      cancelBlur.current = true;
      void save();
    }
  };
  const fallbackDisplay = Array.isArray(value)
    ? options
        .filter((option) => value.includes(option.id))
        .map((option) => option.label)
        .join(', ')
    : kind === 'enum'
      ? options.find((option) => option.id === value)?.label
      : value;
  const blur = () => {
    if (cancelBlur.current) cancelBlur.current = false;
    else void save();
  };
  const explicitActions = kind === 'multiline' || kind === 'multi';
  let control: ReactNode = (
    <button type="button" className={styles.propertyValueButton} onClick={beginEditing}>
      {display ?? (fallbackDisplay || '—')}
    </button>
  );
  if (editing && kind === 'boolean')
    control = (
      <CustomSelect
        ariaLabel="Boolean value"
        autoFocus
        className={styles.inlineSelect}
        triggerClassName={styles.inlineSelectTrigger}
        value={String(draft)}
        placeholder="—"
        onChange={(next) => {
          setDraft(next);
          void save(next);
        }}
        options={[
          { value: '', label: '—' },
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
      />
    );
  else if (editing && kind === 'enum')
    control = (
      <CustomSelect
        ariaLabel="Field option"
        autoFocus
        className={styles.inlineSelect}
        triggerClassName={styles.inlineSelectTrigger}
        value={String(draft)}
        placeholder="—"
        onChange={(next) => {
          setDraft(next);
          void save(next);
        }}
        options={[
          { value: '', label: '—' },
          ...options.map((option) => ({ value: option.id, label: option.label })),
        ]}
      />
    );
  else if (editing && kind === 'multi')
    control = (
      <CustomMultiSelect
        ariaLabel="Field options"
        autoFocus
        className={styles.inlineSelect}
        triggerClassName={styles.inlineSelectTrigger}
        value={draft as string[]}
        onChange={setDraft}
        options={options.map((option) => ({ value: option.id, label: option.label }))}
      />
    );
  else if (editing && kind === 'multiline')
    control = (
      <textarea
        ref={captureEditor}
        value={String(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
    );
  else if (editing)
    control = (
      <input
        ref={captureEditor}
        type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
        step={kind === 'number' ? 'any' : undefined}
        value={String(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={keyDown}
        onBlur={blur}
      />
    );

  return (
    <span
      ref={shellRef}
      className={styles.inlineEditor}
      data-editor-kind={kind}
      data-editing={editing}
      aria-busy={saving}
      style={editingHeight ? { minHeight: editingHeight } : undefined}
    >
      {control}
      <span className={styles.inlineEditorFooter} aria-live="polite">
        {error && (
          <Tooltip
            className={styles.inlineEditorErrorTooltip}
            content={`Full validation error: ${error}`}
          >
            <small role="alert">{error}</small>
          </Tooltip>
        )}
        {!error && saving && <small className={styles.inlineEditorStatus}>Saving…</small>}
        {editing && explicitActions && (
          <span className={styles.inlineEditorActions}>
            <button type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        )}
      </span>
    </span>
  );
}
