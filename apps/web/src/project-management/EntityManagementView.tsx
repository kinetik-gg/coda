import { ArrowDownIcon } from '@phosphor-icons/react/dist/csr/ArrowDown';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/csr/ArrowUp';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import styles from '../ProjectManagementScreen.styles';
import {
  useEntityManagementController,
  type EntityManagementController,
  type EntityManagementProps,
} from './EntityManagement';
import { FieldEditorDialog } from './FieldEditorDialog';
import { readableFieldType } from './field-utils';
import { getDeleteLevelState } from './entity-utils';
import type { ManagedEntityType } from './types';

function AddEntityLevelForm({ controller }: { controller: EntityManagementController }) {
  const {
    entityTypes,
    deepest,
    setAddingLevel,
    newSingularName,
    setNewSingularName,
    newPluralName,
    setNewPluralName,
    newPrefix,
    setNewPrefix,
    addEntityType,
  } = controller;
  return (
    <form
      className={styles.addLevelForm}
      onSubmit={(event) => {
        event.preventDefault();
        addEntityType.mutate();
      }}
    >
      <div className={styles.addLevelCopy}>
        <strong>Level {entityTypes.length + 1}</strong>
        <span>Added beneath {deepest?.pluralName}.</span>
      </div>
      <label className={styles.field}>
        <span>Singular name</span>
        <input
          required
          maxLength={80}
          value={newSingularName}
          onChange={(event) => setNewSingularName(event.target.value)}
          placeholder="Item"
        />
      </label>
      <label className={styles.field}>
        <span>Plural name</span>
        <input
          required
          maxLength={80}
          value={newPluralName}
          onChange={(event) => setNewPluralName(event.target.value)}
          placeholder="Items"
        />
      </label>
      <label className={styles.field}>
        <span>Prefix</span>
        <input
          maxLength={20}
          value={newPrefix}
          onChange={(event) => setNewPrefix(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <div className={styles.addLevelActions}>
        <button
          type="button"
          className={styles.iconTextButton}
          onClick={() => setAddingLevel(false)}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={addEntityType.isPending || !newSingularName.trim() || !newPluralName.trim()}
        >
          <PlusIcon size={12} aria-hidden="true" />
          {addEntityType.isPending ? 'Adding…' : 'Add level'}
        </button>
      </div>
      {addEntityType.error && (
        <p className={styles.error} role="alert">
          {addEntityType.error.message}
        </p>
      )}
    </form>
  );
}

function EntityLevelSection({
  controller,
  selected,
}: {
  controller: EntityManagementController;
  selected: ManagedEntityType;
}) {
  const {
    entityTypes,
    canManageEntities,
    deepest,
    fields,
    addingLevel,
    setAddingLevel,
    singularName,
    setSingularName,
    pluralName,
    setPluralName,
    displayPrefix,
    setDisplayPrefix,
    setEntityToDelete,
    rename,
  } = controller;
  const levelDirty =
    singularName !== selected.singularName ||
    pluralName !== selected.pluralName ||
    displayPrefix !== (selected.displayPrefix ?? '');
  const { mayDeleteLevel, deleteLevelHelp } = getDeleteLevelState({
    selected,
    deepest,
    entityTypeCount: entityTypes.length,
    canManageEntities,
    hasItems: (selected._count?.items ?? 0) > 0,
    hasFields: (fields.data?.length ?? selected.fields?.length ?? 0) > 0,
  });

  return (
    <section className={styles.levelWorkspace}>
      <div className={styles.levelDetails}>
        <div className={styles.levelDetailsHeader}>
          <div>
            <h2>Level {selected.level} definition</h2>
          </div>
          <div className={styles.levelHeaderActions}>
            <span className={styles.entityCount}>{selected._count?.items ?? 0} items</span>
            {entityTypes.length < 3 && canManageEntities && (
              <button
                type="button"
                className={styles.iconTextButton}
                aria-expanded={addingLevel}
                onClick={() => setAddingLevel((current) => !current)}
              >
                <PlusIcon size={12} aria-hidden="true" /> Add level
              </button>
            )}
          </div>
        </div>
        {addingLevel && <AddEntityLevelForm controller={controller} />}
        <form
          className={styles.levelForm}
          onSubmit={(event) => {
            event.preventDefault();
            rename.mutate();
          }}
        >
          <label className={styles.field}>
            <span>Singular name</span>
            <input
              required
              maxLength={80}
              value={singularName}
              disabled={!canManageEntities}
              onChange={(event) => setSingularName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Plural name</span>
            <input
              required
              maxLength={80}
              value={pluralName}
              disabled={!canManageEntities}
              onChange={(event) => setPluralName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Display prefix</span>
            <input
              maxLength={20}
              value={displayPrefix}
              disabled={!canManageEntities}
              onChange={(event) => setDisplayPrefix(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className={styles.levelActions}>
            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={!canManageEntities || !levelDirty || rename.isPending}
            >
              <FloppyDiskIcon size={12} aria-hidden="true" />
              {rename.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className={styles.iconTextButton}
              disabled={!mayDeleteLevel}
              aria-describedby={deleteLevelHelp ? `delete-level-help-${selected.id}` : undefined}
              onClick={() => setEntityToDelete(selected)}
            >
              <TrashIcon size={12} aria-hidden="true" /> Delete level…
            </button>
          </div>
          {deleteLevelHelp && canManageEntities && (
            <p id={`delete-level-help-${selected.id}`} className={styles.inlineHelp}>
              {deleteLevelHelp}
            </p>
          )}
          {rename.error && (
            <p className={styles.error} role="alert">
              {rename.error.message}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

function CustomFieldsSection({
  controller,
  selected,
}: {
  controller: EntityManagementController;
  selected: ManagedEntityType;
}) {
  const {
    canManageFields,
    fields,
    reorderField,
    setFieldEditor,
    setFieldEditorError,
    setFieldToDelete,
  } = controller;
  const createField = () => {
    setFieldEditorError(undefined);
    setFieldEditor({ mode: 'create' });
  };

  return (
    <section className={styles.fieldsWorkspace}>
      <div className={styles.fieldsHeader}>
        <div>
          <h2>Custom fields</h2>
          <p>Define the information captured on every {selected.singularName.toLowerCase()}.</p>
        </div>
        {canManageFields && (
          <button type="button" className={styles.primaryButton} onClick={createField}>
            <PlusIcon size={12} aria-hidden="true" /> Add field
          </button>
        )}
      </div>
      <div
        className={styles.fieldTableFrame}
        aria-busy={fields.isLoading || reorderField.isPending}
      >
        <div className={styles.fieldTableHeader} aria-hidden="true">
          <span>Field</span>
          <span>Key</span>
          <span>Type</span>
          <span>Required</span>
          <span>Order</span>
          <span>Actions</span>
        </div>
        {fields.isLoading && (
          <SkeletonGroup
            label={`Loading fields for ${selected.pluralName}`}
            className={styles.fieldLoading}
          >
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} height={42} />
            ))}
          </SkeletonGroup>
        )}
        {!fields.isLoading && fields.error && (
          <div className={styles.queryState} role="alert">
            <strong>Fields could not be loaded.</strong>
            <span>{fields.error.message}</span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => fields.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {!fields.isLoading && !fields.error && !fields.data?.length && (
          <div className={styles.fieldEmpty}>
            <strong>No custom fields yet</strong>
            <p>
              Add the first field to shape what your team captures for{' '}
              {selected.pluralName.toLowerCase()}.
            </p>
            {canManageFields && (
              <button type="button" className={styles.secondaryButton} onClick={createField}>
                <PlusIcon size={12} aria-hidden="true" /> Add first field
              </button>
            )}
          </div>
        )}
        {!fields.isLoading && !fields.error && Boolean(fields.data?.length) && (
          <div className={styles.fieldRows}>
            {fields.data!.map((field, index) => (
              <div className={styles.fieldRow} key={field.id}>
                <strong>{field.name}</strong>
                <code>{field.key}</code>
                <span className={styles.typeBadge}>{readableFieldType(field.type)}</span>
                <span>{field.required ? 'Yes' : 'No'}</span>
                <span className={styles.reorderButtons}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${field.name} up`}
                    disabled={!canManageFields || index === 0 || reorderField.isPending}
                    onClick={() => reorderField.mutate({ field, direction: -1 })}
                  >
                    <ArrowUpIcon size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${field.name} down`}
                    disabled={
                      !canManageFields ||
                      index === fields.data!.length - 1 ||
                      reorderField.isPending
                    }
                    onClick={() => reorderField.mutate({ field, direction: 1 })}
                  >
                    <ArrowDownIcon size={12} aria-hidden="true" />
                  </button>
                </span>
                <span className={styles.fieldRowActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Edit ${field.name}`}
                    disabled={!canManageFields}
                    onClick={() => {
                      setFieldEditorError(undefined);
                      setFieldEditor({ mode: 'edit', field });
                    }}
                  >
                    <PencilSimpleIcon size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Delete ${field.name}`}
                    disabled={!canManageFields}
                    onClick={() => setFieldToDelete(field)}
                  >
                    <TrashIcon size={12} aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {reorderField.error && (
        <p className={styles.error} role="alert">
          {reorderField.error.message}
        </p>
      )}
    </section>
  );
}

function EntityManagementDialogs({
  controller,
  selected,
}: {
  controller: EntityManagementController;
  selected: ManagedEntityType;
}) {
  const {
    fieldEditor,
    setFieldEditor,
    fieldEditorError,
    setFieldEditorError,
    fieldToDelete,
    setFieldToDelete,
    entityToDelete,
    setEntityToDelete,
    saveField,
    deleteField,
    deleteEntityType,
  } = controller;
  return (
    <>
      {fieldEditor && (
        <FieldEditorDialog
          field={fieldEditor.mode === 'edit' ? fieldEditor.field : undefined}
          entityType={selected}
          busy={saveField.isPending}
          error={fieldEditorError}
          onClose={() => {
            if (!saveField.isPending) {
              setFieldEditor(undefined);
              setFieldEditorError(undefined);
            }
          }}
          onSubmit={(value) => saveField.mutate({ editor: fieldEditor, value })}
        />
      )}
      {fieldToDelete && (
        <ConfirmationDialog
          title="Delete custom field?"
          description={
            <>
              “{fieldToDelete.name}” will move to breakdown trash and disappear from{' '}
              {selected.pluralName}. Existing values are retained for restoration.
            </>
          }
          confirmLabel="Delete field"
          busyLabel="Deleting…"
          busy={deleteField.isPending}
          error={deleteField.error?.message}
          onCancel={() => {
            if (!deleteField.isPending) setFieldToDelete(undefined);
          }}
          onConfirm={() => deleteField.mutate(fieldToDelete)}
        />
      )}
      {entityToDelete && (
        <ConfirmationDialog
          title={`Delete ${entityToDelete.pluralName} level?`}
          description={
            <>
              This removes the hierarchy level. This action is only available for an empty deepest
              level.
            </>
          }
          confirmLabel="Delete level"
          busyLabel="Deleting…"
          busy={deleteEntityType.isPending}
          error={deleteEntityType.error?.message}
          onCancel={() => {
            if (!deleteEntityType.isPending) setEntityToDelete(undefined);
          }}
          onConfirm={() => deleteEntityType.mutate(entityToDelete.id)}
        />
      )}
    </>
  );
}

export function EntityManagementView({
  controller,
  selected,
}: {
  controller: EntityManagementController;
  selected: ManagedEntityType;
}) {
  return (
    <div className={styles.entityManager}>
      <EntityLevelSection controller={controller} selected={selected} />
      <CustomFieldsSection controller={controller} selected={selected} />
      <EntityManagementDialogs controller={controller} selected={selected} />
    </div>
  );
}

export function EntityManagement(props: EntityManagementProps) {
  const controller = useEntityManagementController(props);
  if (!controller.selected)
    return <div className={styles.queryState}>No hierarchy levels are configured.</div>;
  return <EntityManagementView controller={controller} selected={controller.selected} />;
}
