import { useState, type FormEvent } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import type { Permission } from '@coda/contracts';
import { api } from '../api';
import { credentialExpiration } from '../account-validation';
import type { ApiCredential, CredentialProject } from './types';

const defaultCredentialPermissions: Permission[] = ['read_project'];

export function permissionsForProject(
  projects: CredentialProject[] | undefined,
  projectId: string,
): Permission[] {
  return (
    projects
      ?.find((project) => project.id === projectId)
      ?.currentMembership?.role.permissions.map((entry) => entry.permission) ?? []
  );
}

/** Owns credential-form state, the create/revoke mutations, and the derived
 * permission set for the selected breakdown -- kept out of AccountScreen to
 * stay within the file's function-size budget. */
export function useCredentialsPanel(
  queryClient: QueryClient,
  credentialProjects: CredentialProject[] | undefined,
) {
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState<'api_key' | 'mcp_token'>('api_key');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [permissions, setPermissions] = useState<Permission[]>(defaultCredentialPermissions);
  const [createdToken, setCreatedToken] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ApiCredential>();

  const create = useMutation({
    mutationFn: () =>
      api<ApiCredential & { token: string }>('/api/v1/account/credentials', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          kind,
          name: name.trim(),
          permissions,
          expiresAt: credentialExpiration(expiry),
        }),
      }),
    onSuccess: (credential) => {
      setCreatedToken(credential.token);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['api-credentials'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (credentialId: string) =>
      api<ApiCredential>(`/api/v1/account/credentials/${credentialId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRevokeTarget(undefined);
      void queryClient.invalidateQueries({ queryKey: ['api-credentials'] });
    },
  });

  const chooseProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    const available = permissionsForProject(credentialProjects, nextProjectId);
    setPermissions(available.includes('read_project') ? ['read_project'] : []);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.reset();
    if (!projectId || !name.trim() || !permissions.length) return;
    create.mutate();
  };

  return {
    projectId,
    setProjectId,
    kind,
    setKind,
    name,
    setName,
    expiry,
    setExpiry,
    permissions,
    setPermissions,
    createdToken,
    revokeTarget,
    setRevokeTarget,
    create,
    revoke,
    chooseProject,
    submit,
    availablePermissions: permissionsForProject(credentialProjects, projectId),
  };
}
