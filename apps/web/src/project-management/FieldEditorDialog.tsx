import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { FieldType } from '@coda/contracts';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../ProjectManagementScreen.styles';
import { fieldKeyFromName, fieldTypes, normalizedFieldType } from './field-utils';
import type { FieldEditorValue, ManagedEntityType, ManagedFieldDefinition } from './types';

export function FieldEditorDialog({
  field,
  entityType,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  field?: ManagedFieldDefinition;
  entityType: ManagedEntityType;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (value: FieldEditorValue) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(field?.name ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [type, setType] = useState<FieldType>(field ? normalizedFieldType(field.type) : 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<
    Array<{ id?: string; label: string; color?: string | null }>
  >(field?.options.map((option) => ({ ...option })) ?? []);
  const [keyEdited, setKeyEdited] = useState(Boolean(field));
  const optionType = type === 'enum' || type === 'multi_enum';
  const validOptions =
    !optionType || (options.length > 0 && options.every((option) => option.label.trim()));
  const validKey = /^[a-z][a-z0-9_]{0,63}$/.test(key);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [busy, onClose]);

  return createPortal(
    <div
      className={styles.modalBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.fieldDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className={styles.fieldDialogHeader}>
          <div>
            <span className={styles.eyebrow}>{entityType.pluralName.toUpperCase()}</span>
            <h2 id={titleId}>{field ? 'Edit custom field' : 'Add custom field'}</h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close field editor"
            disabled={busy}
            onClick={onClose}
          >
            <XIcon size={12} aria-hidden="true" />
          </button>
        </header>
        <form
          className={styles.fieldDialogBody}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ name: name.trim(), key, type, required, options });
          }}
        >
          <div className={styles.fieldDialogGrid}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!keyEdited) setKey(fieldKeyFromName(next));
                }}
                placeholder="e.g. Shooting location"
              />
            </label>
            <label className={styles.field}>
              <span>Key</span>
              <input
                required
                maxLength={64}
                spellCheck={false}
                value={key}
                aria-describedby="field-key-help"
                onChange={(event) => {
                  setKeyEdited(true);
                  setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                }}
                placeholder="shooting_location"
              />
              <small id="field-key-help">
                Stable API key. Lowercase letters, numbers, and underscores.
              </small>
            </label>
          </div>
          <label className={styles.field}>
            <span>Field type</span>
            <CustomSelect
              ariaLabel="Field type"
              value={type}
              disabled={Boolean(field)}
              onChange={(next) => setType(next as FieldType)}
              options={fieldTypes}
            />
            {field && <small>Field type cannot be changed after creation.</small>}
          </label>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              aria-label="Required field"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
            <span>
              <strong>Required field</strong>
              <small>New and edited entities must include a value.</small>
            </span>
          </label>
          {optionType && (
            <fieldset className={styles.optionEditor}>
              <legend>Options</legend>
              <div className={styles.optionList}>
                {options.map((option, index) => (
                  <div className={styles.optionRow} key={option.id ?? `new-${index}`}>
                    <span className={styles.optionIndex}>{index + 1}</span>
                    <input
                      required
                      maxLength={120}
                      aria-label={`Option ${index + 1} label`}
                      value={option.label}
                      onChange={(event) =>
                        setOptions((current) =>
                          current.map((entry, optionIndex) =>
                            optionIndex === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="Option label"
                    />
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() =>
                        setOptions((current) =>
                          current.filter((_, optionIndex) => optionIndex !== index),
                        )
                      }
                    >
                      <TrashIcon size={12} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={styles.iconTextButton}
                onClick={() => setOptions((current) => [...current, { label: '' }])}
              >
                <PlusIcon size={12} aria-hidden="true" /> Add option
              </button>
            </fieldset>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <footer className={styles.fieldDialogActions}>
            <button
              type="button"
              className={styles.iconTextButton}
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={busy || !name.trim() || !validKey || !validOptions}
            >
              <FloppyDiskIcon size={12} aria-hidden="true" />
              {busy ? 'Saving…' : field ? 'Save field' : 'Create field'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
