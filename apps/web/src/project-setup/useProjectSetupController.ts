import { useMemo, useRef, useState } from 'react';
import type { ProjectTemplateId } from '@coda/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { validateSourceFile } from './source-validation';
import {
  canContinueSetupStep,
  defaultLevelNames,
  entitiesAreComplete,
  levelsForTemplate,
  stepIds,
} from './setup-state';
import {
  addProjectMember,
  configureEntityTypes,
  publishProjectWorkspace,
  uploadProjectSource,
} from './setup-operations';
import type { CreationOptions, EntityLevelName, PendingSetup, Project } from './types';

export function useProjectSetupController(onCreated: (projectId: string) => void) {
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState<'blank' | ProjectTemplateId>('blank');
  const [levelCount, setLevelCount] = useState(3);
  const [levels, setLevels] = useState(defaultLevelNames);
  const [sourceFile, setSourceFile] = useState<File>();
  const [sourceError, setSourceError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRoleName, setSelectedRoleName] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<PendingSetup>({});
  const options = useQuery({
    queryKey: ['project-creation-options'],
    queryFn: () => api<CreationOptions>('/api/v1/projects/creation-options'),
  });
  const step = stepIds[stepIndex]!;
  const detailsComplete = Boolean(name.trim());
  const entitiesComplete = entitiesAreComplete(levels, levelCount);
  const sourceRequired = templateId === 'blank';
  const canContinue = canContinueSetupStep({
    step,
    detailsComplete,
    entitiesComplete,
    hasSource: Boolean(sourceFile),
    templateId,
  });
  const selectedUser = options.data?.users.find((user) => user.id === selectedUserId);
  const selectedRole = options.data?.roles.find((role) => role.name === selectedRoleName);
  const selectedTemplate = options.data?.templates.find((template) => template.id === templateId);
  const roleOptions = useMemo(
    () =>
      (options.data?.roles ?? []).map((role) => ({
        value: role.name,
        label: role.name.charAt(0).toUpperCase() + role.name.slice(1),
      })),
    [options.data?.roles],
  );
  const userOptions = useMemo(
    () => [
      { value: '', label: 'No member' },
      ...(options.data?.users ?? []).map((user) => ({
        value: user.id,
        label: `${user.displayName} · ${user.email}`,
      })),
    ],
    [options.data?.users],
  );
  const templateOptions = useMemo(
    () => [
      { value: 'blank', label: 'Blank breakdown' },
      ...(options.data?.templates ?? []).map((template) => ({
        value: template.id,
        label: template.name,
      })),
    ],
    [options.data?.templates],
  );
  const chooseTemplate = (value: string) => {
    const next = value as 'blank' | ProjectTemplateId;
    setTemplateId(next);
    const nextLevels = levelsForTemplate(next, options.data?.templates);
    if (!nextLevels) return;
    setLevelCount(nextLevels.length);
    setLevels(nextLevels);
  };
  const updateLevel = (index: number, key: 'singular' | 'plural', value: string) => {
    setLevels((current) =>
      current.map((entry, itemIndex) => (itemIndex === index ? { ...entry, [key]: value } : entry)),
    );
  };
  const chooseSource = (file?: File) => {
    if (!file) return;
    const validation = validateSourceFile(file);
    setSourceError(validation ?? '');
    setSourceFile(validation ? undefined : file);
  };
  const getOrCreateProject = async (): Promise<string> => {
    if (pending.current.projectId) return pending.current.projectId;
    setProgress('Creating the breakdown…');
    const project = await api<{ id: string }>(
      templateId === 'blank' ? '/api/v1/projects' : '/api/v1/projects/from-template',
      {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          ...(templateId === 'blank' ? {} : { templateId }),
        }),
      },
    );
    pending.current.projectId = project.id;
    return project.id;
  };
  const create = async () => {
    if (!detailsComplete || !entitiesComplete || (sourceRequired && !sourceFile) || busy) return;
    setBusy(true);
    setError('');
    try {
      const projectId = await getOrCreateProject();
      const detail =
        templateId === 'blank'
          ? await configureEntityTypes({ projectId, levelCount, levels, onProgress: setProgress })
          : await api<Project>(`/api/v1/projects/${projectId}`);
      await publishProjectWorkspace({ projectId, detail, onProgress: setProgress });
      await uploadProjectSource({ projectId, sourceFile, pending, onProgress: setProgress });
      await addProjectMember({
        projectId,
        selectedUserId,
        selectedRoleName,
        onProgress: setProgress,
      });
      setProgress('Opening workspace…');
      onCreated(projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Breakdown setup failed.');
      setProgress('');
      setBusy(false);
    }
  };
  const previousStep = () => setStepIndex((current) => current - 1);
  const nextStep = () => setStepIndex((current) => current + 1);

  return {
    stepIndex,
    step,
    name,
    setName,
    description,
    setDescription,
    templateId,
    levelCount,
    setLevelCount,
    levels,
    sourceFile,
    sourceError,
    selectedUserId,
    setSelectedUserId,
    selectedRoleName,
    setSelectedRoleName,
    busy,
    progress,
    error,
    pending,
    options,
    detailsComplete,
    entitiesComplete,
    sourceRequired,
    canContinue,
    selectedUser,
    selectedRole,
    selectedTemplate,
    roleOptions,
    userOptions,
    templateOptions,
    chooseTemplate,
    updateLevel,
    chooseSource,
    create,
    previousStep,
    nextStep,
  };
}

export type ProjectSetupController = ReturnType<typeof useProjectSetupController>;

export type { EntityLevelName };
