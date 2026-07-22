import { Injectable } from '@nestjs/common';
import type { Permission } from '@coda/contracts';
import { AsyncLocalStorage } from 'node:async_hooks';

export type CredentialAudience = 'API_KEY' | 'MCP_TOKEN';

export interface AuthenticatedCredential {
  id: string;
  projectId: string;
  userId: string;
  kind: CredentialAudience;
  permissions: Permission[];
}

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
