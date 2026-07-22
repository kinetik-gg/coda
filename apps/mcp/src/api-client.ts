import { z } from 'zod';
import type { McpConfig } from './config.js';
import {
  fieldSchema,
  projectSchema,
  sourceDocumentSchema,
  tokenContextSchema,
  type ItemCreateInput,
  type ItemListInput,
  type ItemUpdateInput,
} from './schemas.js';

const envelopeSchema = z.object({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const problemSchema = z.object({
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

type Fetch = typeof fetch;

export class CodaApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly validationErrors?: Record<string, string[]>,
  ) {
    super([title, detail].filter(Boolean).join(': '));
    this.name = 'CodaApiError';
  }

  publicMessage(): string {
    const validation = this.validationErrors
      ? Object.entries(this.validationErrors)
          .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
          .join('; ')
      : undefined;
    return [`Coda API request failed (${this.status})`, this.title, this.detail, validation]
      .filter(Boolean)
      .join(': ');
  }
}

export class CodaApiClient {
  private contextPromise?: Promise<z.infer<typeof tokenContextSchema>>;

  constructor(
    private readonly config: McpConfig,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  context(): Promise<z.infer<typeof tokenContextSchema>> {
    this.contextPromise ??= this.request('/api/v1/token/context').then((envelope) =>
      tokenContextSchema.parse(envelope.data),
    );
    return this.contextPromise;
  }

  async getProject() {
    const { projectId } = await this.context();
    const envelope = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    const project = projectSchema.parse(envelope.data);
    if (project.id !== projectId)
      throw new Error('Coda API returned a project outside token scope');
    return {
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      version: project.version,
      revision: project.revision,
      updatedAt: project.updatedAt,
      levels: project.entityTypes.map((entityType) => ({
        id: entityType.id,
        parentTypeId: entityType.parentTypeId,
        singularName: entityType.singularName,
        pluralName: entityType.pluralName,
        displayPrefix: entityType.displayPrefix,
        level: entityType.level,
        enabled: entityType.enabled,
        version: entityType.version,
        itemCount: entityType._count?.items ?? 0,
      })),
      hasSourceDocument: project.sourceDocuments.length > 0,
    };
  }

  async getSchema() {
    const { projectId } = await this.context();
    const envelope = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    const project = projectSchema.parse(envelope.data);
    if (project.id !== projectId)
      throw new Error('Coda API returned a project outside token scope');
    const levels = await Promise.all(
      project.entityTypes.map(async (entityType) => {
        const fieldsEnvelope = await this.request(
          `/api/v1/projects/${encodeURIComponent(projectId)}/entity-types/${encodeURIComponent(entityType.id)}/fields`,
        );
        const fields = z.array(fieldSchema).parse(fieldsEnvelope.data);
        return {
          id: entityType.id,
          parentTypeId: entityType.parentTypeId,
          singularName: entityType.singularName,
          pluralName: entityType.pluralName,
          displayPrefix: entityType.displayPrefix,
          level: entityType.level,
          enabled: entityType.enabled,
          fields: fields.map((field) => ({
            id: field.id,
            name: field.name,
            key: field.key,
            type: field.type,
            required: field.required,
            configuration: field.configuration,
            version: field.version,
            options: field.options ?? [],
          })),
        };
      }),
    );
    return { projectId, revision: project.revision, levels };
  }

  async listItems(input: ItemListInput) {
    const { projectId } = await this.context();
    const query = new URLSearchParams({
      entityTypeId: input.entityTypeId,
      limit: String(input.limit),
      sort: input.sort,
      direction: input.direction,
    });
    if (input.parentId !== undefined) query.set('parentId', input.parentId ?? '');
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.search) query.set('search', input.search);
    const envelope = await this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/items?${query.toString()}`,
    );
    return {
      items: z.array(z.unknown()).parse(envelope.data),
      nextCursor: envelope.meta?.nextCursor ?? null,
    };
  }

  async createItem(input: ItemCreateInput) {
    const { projectId } = await this.context();
    const envelope = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return envelope.data;
  }

  async updateItem(input: ItemUpdateInput) {
    const { projectId } = await this.context();
    const { itemId, ...body } = input;
    const envelope = await this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    return envelope.data;
  }

  async getSource() {
    const { projectId } = await this.context();
    const envelope = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    const project = projectSchema.parse(envelope.data);
    if (project.id !== projectId)
      throw new Error('Coda API returned a project outside token scope');
    const documents = z.array(sourceDocumentSchema).parse(project.sourceDocuments);
    return {
      projectId,
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        pageCount: document.pageCount ?? null,
        version: document.version,
        createdAt: document.createdAt,
        file: {
          id: document.storageObject.id,
          filename: document.storageObject.originalFilename,
          mimeType: document.storageObject.mimeType,
          sizeBytes: document.storageObject.sizeBytes,
          status: document.storageObject.status,
        },
      })),
    };
  }

  async listActivity(cursor?: string) {
    const { projectId } = await this.context();
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const envelope = await this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/activity${query}`,
    );
    const events = z.array(z.record(z.string(), z.unknown())).parse(envelope.data);
    const last = events.at(-1);
    return {
      events,
      nextCursor: events.length === 100 && typeof last?.id === 'string' ? last.id : null,
    };
  }

  private async request(path: string, init: RequestInit = {}) {
    if (!path.startsWith('/api/v1/')) throw new Error('MCP client path is outside the Coda API');
    const response = await this.fetchImplementation(`${this.config.apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: 'application/json, application/problem+json',
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        'x-coda-token-audience': 'mcp',
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const problem = problemSchema.safeParse(payload);
      throw new CodaApiError(
        response.status,
        problem.success ? (problem.data.title ?? response.statusText) : response.statusText,
        problem.success ? problem.data.detail : undefined,
        problem.success ? problem.data.errors : undefined,
      );
    }
    return envelopeSchema.parse(payload);
  }
}
