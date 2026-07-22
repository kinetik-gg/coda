import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { FieldEditorValue, ManagedEntityType, ManagedFieldDefinition } from './types';

export { getDeleteLevelState } from './entity-utils';

export interface EntityManagementProps {
  projectId: string;
  entityTypes: ManagedEntityType[];
  selectedId: string;
  onSelectId: (entityTypeId: string) => void;
  canManageEntities: boolean;
  canManageFields: boolean;
}

export function useEntityManagementController({
  projectId,
  entityTypes,
  selectedId,
  onSelectId,
  canManageEntities,
  canManageFields,
}: EntityManagementProps) {
  const queryClient = useQueryClient();
  const [addingLevel, setAddingLevel] = useState(false);
  const [newSingularName, setNewSingularName] = useState('');
  const [newPluralName, setNewPluralName] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [entityToDelete, setEntityToDelete] = useState<ManagedEntityType>();
  const [fieldEditor, setFieldEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; field: ManagedFieldDefinition }
  >();
  const [fieldToDelete, setFieldToDelete] = useState<ManagedFieldDefinition>();
  const [fieldEditorError, setFieldEditorError] = useState<string>();
  const selected = entityTypes.find((entityType) => entityType.id === selectedId) ?? entityTypes[0];
  const deepest = entityTypes.at(-1);

  const invalidateProject = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-management', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    ]);
  };
  const fields = useQuery({
    queryKey: ['fields', projectId, selected?.id],
    queryFn: ({ signal }) =>
      api<ManagedFieldDefinition[]>(
        `/api/v1/projects/${projectId}/entity-types/${selected!.id}/fields`,
        { signal },
      ),
    enabled: Boolean(selected),
  });
  const [singularName, setSingularName] = useState(selected?.singularName ?? '');
  const [pluralName, setPluralName] = useState(selected?.pluralName ?? '');
  const [displayPrefix, setDisplayPrefix] = useState(selected?.displayPrefix ?? '');

  useEffect(() => {
    setSingularName(selected?.singularName ?? '');
    setPluralName(selected?.pluralName ?? '');
    setDisplayPrefix(selected?.displayPrefix ?? '');
  }, [selected]);

  const rename = useMutation({
    mutationFn: () =>
      api(`/api/v1/projects/${projectId}/entity-types/${selected!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          singularName,
          pluralName,
          displayPrefix: displayPrefix || null,
          version: selected!.version,
        }),
      }),
    onSuccess: invalidateProject,
  });
  const addEntityType = useMutation({
    mutationFn: () =>
      api<ManagedEntityType>(`/api/v1/projects/${projectId}/entity-types`, {
        method: 'POST',
        body: JSON.stringify({
          singularName: newSingularName,
          pluralName: newPluralName,
          displayPrefix: newPrefix || null,
        }),
      }),
    onSuccess: async (created) => {
      setNewSingularName('');
      setNewPluralName('');
      setNewPrefix('');
      setAddingLevel(false);
      onSelectId(created.id);
      await invalidateProject();
    },
  });
  const deleteEntityType = useMutation({
    mutationFn: (entityTypeId: string) =>
      api(`/api/v1/projects/${projectId}/entity-types/${entityTypeId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      const fallback = entityTypes.at(-2) ?? entityTypes[0];
      if (fallback) onSelectId(fallback.id);
      setEntityToDelete(undefined);
      await invalidateProject();
    },
  });
  const saveField = useMutation({
    mutationFn: ({
      editor,
      value,
    }: {
      editor: NonNullable<typeof fieldEditor>;
      value: FieldEditorValue;
    }) => {
      const options = value.options.map((option) => ({ ...option, label: option.label.trim() }));
      if (editor.mode === 'create') {
        return api<ManagedFieldDefinition>(`/api/v1/projects/${projectId}/fields`, {
          method: 'POST',
          body: JSON.stringify({
            entityTypeId: selected!.id,
            ...value,
            options: value.type === 'enum' || value.type === 'multi_enum' ? options : undefined,
          }),
        });
      }
      return api<ManagedFieldDefinition>(
        `/api/v1/projects/${projectId}/fields/${editor.field.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: value.name,
            key: value.key,
            required: value.required,
            options: value.type === 'enum' || value.type === 'multi_enum' ? options : undefined,
            version: editor.field.version,
          }),
        },
      );
    },
    onSuccess: async () => {
      setFieldEditor(undefined);
      setFieldEditorError(undefined);
      await Promise.all([fields.refetch(), invalidateProject()]);
    },
    onError: (error) => setFieldEditorError(error.message),
  });
  const deleteField = useMutation({
    mutationFn: (field: ManagedFieldDefinition) =>
      api(`/api/v1/projects/${projectId}/fields/${field.id}/trash`, {
        method: 'DELETE',
        body: JSON.stringify({ version: field.version }),
      }),
    onSuccess: async () => {
      setFieldToDelete(undefined);
      await Promise.all([fields.refetch(), invalidateProject()]);
    },
  });
  const reorderField = useMutation({
    mutationFn: ({ field, direction }: { field: ManagedFieldDefinition; direction: -1 | 1 }) => {
      const current = fields.data ?? [];
      const currentIndex = current.findIndex((entry) => entry.id === field.id);
      const targetIndex = currentIndex + direction;
      const remaining = current.filter((entry) => entry.id !== field.id);
      return api(`/api/v1/projects/${projectId}/fields/${field.id}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({
          beforeId: remaining[targetIndex]?.id ?? null,
          afterId: remaining[targetIndex - 1]?.id ?? null,
          version: field.version,
        }),
      });
    },
    onSuccess: async () => {
      await fields.refetch();
    },
  });

  return {
    entityTypes,
    canManageEntities,
    canManageFields,
    selected,
    deepest,
    fields,
    addingLevel,
    setAddingLevel,
    newSingularName,
    setNewSingularName,
    newPluralName,
    setNewPluralName,
    newPrefix,
    setNewPrefix,
    singularName,
    setSingularName,
    pluralName,
    setPluralName,
    displayPrefix,
    setDisplayPrefix,
    entityToDelete,
    setEntityToDelete,
    fieldEditor,
    setFieldEditor,
    fieldToDelete,
    setFieldToDelete,
    fieldEditorError,
    setFieldEditorError,
    rename,
    addEntityType,
    deleteEntityType,
    saveField,
    deleteField,
    reorderField,
  };
}

export type EntityManagementController = ReturnType<typeof useEntityManagementController>;
