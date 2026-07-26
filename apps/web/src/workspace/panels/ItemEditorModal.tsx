import { useRef, useState } from 'react';
import { CustomSelect } from '../../components/CustomSelect';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../../components/ModalShell';
import type { BreakdownItem, EntityType } from './types';
import styles from './Panels.styles';

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

/**
 * Creates or edits a breakdown item, in the shared modal shell (#169).
 *
 * Raised from inside the workspace's panels, so it relies on the shell's dialog stack: whichever
 * dialog is topmost owns `Escape`, and focus returns to the panel control that opened this one.
 */
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
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(item?.title ?? '');
  const [displayCode, setDisplayCode] = useState(item?.displayCode ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? defaultParentId ?? '');
  const [validation, setValidation] = useState<string>();

  const submit = () => {
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

  return (
    <ModalShell
      title={item ? `Edit ${entityType.singularName}` : `New ${entityType.singularName}`}
      description={
        <p>
          {item
            ? 'Update the item identity and hierarchy.'
            : `Add an item to ${entityType.pluralName}.`}
        </p>
      }
      busy={busy}
      initialFocus={titleRef}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button
            type="button"
            className={modalButtonStyles.secondary}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className={modalButtonStyles.primary} disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save changes' : `Create ${entityType.singularName}`}
          </button>
        </>
      }
    >
      <div className={modalFormStyles.fields}>
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
    </ModalShell>
  );
}
