import { Injectable } from '@nestjs/common';
import type { Permission, TrackerPermission } from '@coda/contracts';
import { AsyncLocalStorage } from 'node:async_hooks';

export type CredentialAudience = 'API_KEY' | 'MCP_TOKEN';

/**
 * The resource a credential is bound to. Exactly one variant applies — the discriminated
 * `resourceType` mirrors `createApiCredentialSchema`'s XOR so consumers narrow instead of
 * guessing which id column carries the binding.
 */
export interface ProjectScopedCredential {
  resourceType: 'project';
  projectId: string;
  permissions: Permission[];
}

export interface TrackerScopedCredential {
  resourceType: 'tracker';
  trackerId: string;
  permissions: TrackerPermission[];
}

interface CredentialIdentity {
  id: string;
  userId: string;
  kind: CredentialAudience;
}

export type AuthenticatedCredential = CredentialIdentity &
  (ProjectScopedCredential | TrackerScopedCredential);

interface RequestAuthState {
  credential?: AuthenticatedCredential;
}

@Injectable()
export class RequestAuthContext {
  private readonly storage = new AsyncLocalStorage<RequestAuthState>();

  run(state: RequestAuthState, callback: () => void): void {
    this.storage.run(state, callback);
  }

  credential(): AuthenticatedCredential | undefined {
    return this.storage.getStore()?.credential;
  }
}
