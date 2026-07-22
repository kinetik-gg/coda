import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { CustomSelect } from '../../components/CustomSelect';
import type { BreakdownItem, EntityType } from './types';
import styles from './Panels.module.css';

export interface ItemEditorInput {
  title: string;
  displayCode: string | null;
  description: string | null;
  parentId: string | null;
}

interface ItemEditorModalProps {
  entityType: EntityType;
  item?: BreakdownItem;
  parentType?: EntityType;
  parents: BreakdownItem[];
  defaultParentId?: string | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: ItemEditorInput) => void;
}

export function ItemEditorModal({
  entityType,
  item,
  parentType,
  parents,
  defaultParentId,
  busy,
  error,
  onClose,
  onSubmit,
}: ItemEditorModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(item?.title ?? '');
  const [displayCode, setDisplayCode] = useState(item?.displayCode ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? defaultParentId ?? '');
  const [validation, setValidation] = useState<string>();

  useEffect(() => {
    titleRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setValidation('Title is required.');
      titleRef.current?.focus();
      return;
    }
    if (parentType && !parentId) {
      setValidation(`Choose a ${parentType.singularName.toLowerCase()}.`);
      return;
    }
    setValidation(undefined);
    onSubmit({
      title: cleanTitle,
      displayCode: displayCode.trim() || null,
      description: description.trim() || null,
      parentId: parentType ? parentId : null,
    });
  };

  return createPortal(
    <div
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onSubmit={submit}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id={titleId}>
              {item ? `Edit ${entityType.singularName}` : `New ${entityType.singularName}`}
            </h2>
            <p id={descriptionId}>
              {item
                ? 'Update the item identity and hierarchy.'
                : `Add an item to ${entityType.pluralName}.`}
            </p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} disabled={busy}>
            <XIcon size={12} />
          </button>
        </header>
        <div className={styles.modalFields}>
          <label>
            <span>Title *</span>
            <input
              ref={titleRef}
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Code</span>
            <input
              value={displayCode}
              maxLength={80}
              onChange={(event) => setDisplayCode(event.target.value)}
            />
          </label>
          {parentType && (
            <label>
              <span>{parentType.singularName} *</span>
              <CustomSelect
                ariaLabel={parentType.singularName}
                value={parentId}
                onChange={setParentId}
                placeholder={`Select ${parentType.singularName.toLowerCase()}…`}
                options={parents.map((parent) => ({
                  value: parent.id,
                  label: `${parent.displayCode ? `${parent.displayCode} — ` : ''}${parent.title}`,
                }))}
              />
            </label>
          )}
          <label>
            <span>Description</span>
            <textarea
              value={description}
              maxLength={20_000}
              rows={5}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {(validation || error) && (
            <p className={styles.formError} role="alert">
              {validation ?? error}
            </p>
          )}
        </div>
        <footer className={styles.modalActions}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save changes' : `Create ${entityType.singularName}`}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
