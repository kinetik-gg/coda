import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTE } from '../auth/public.decorator';
import { ExternalApiDocsController } from './external-api-docs.controller';
import { buildExternalOpenApiDocument } from './external-openapi';

describe('external OpenAPI contract', () => {
  it('keeps the committed public document identical to the generated contract', async () => {
    const committed = JSON.parse(
      await readFile(resolve(__dirname, '../../../../docs/openapi.json'), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(buildExternalOpenApiDocument());
  });

  it('documents only the public bearer-credential surface', () => {
    const document = buildExternalOpenApiDocument() as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(document.openapi).toBe('3.1.0');
    expect(document.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(document.paths).toHaveProperty('/api/v1/token/context');
    expect(document.paths).toHaveProperty('/api/v1/projects/{projectId}/items');
    expect(document.paths).toHaveProperty(
      '/api/v1/projects/{projectId}/items/{itemId}/source-references',
    );

    const paths = Object.keys(document.paths).join('\n');
    expect(paths).not.toMatch(/setup|auth\/|account|instance|membership|roles|invitation/);
    expect(paths).not.toMatch(/workspace-layout|transfer-ownership|purge|\/trash/);
  });

  it('uses the shared contracts for request body schemas', () => {
    const document = buildExternalOpenApiDocument() as {
      components: { schemas: Record<string, Record<string, unknown>> };
    };
    const createItem = document.components.schemas.CreateItemInput as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(createItem.required).toEqual(expect.arrayContaining(['entityTypeId', 'title']));
    expect(createItem.properties).toHaveProperty('beforeId');
  });

  it('uses RFC 9457 problem details for errors', () => {
    const document = buildExternalOpenApiDocument() as {
      components: {
        schemas: Record<string, { required?: string[] }>;
        responses: Record<string, { content?: Record<string, unknown> }>;
      };
    };
    expect(document.components.schemas.ProblemDetails!.required).toEqual([
      'type',
      'title',
      'status',
    ]);
    expect(document.components.responses.Conflict!.content).toHaveProperty(
      'application/problem+json',
    );
  });

  it('resolves every local component reference and exposes the document publicly', () => {
    const document = buildExternalOpenApiDocument();
    const references: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        if (key === '$ref' && typeof nested === 'string') references.push(nested);
        else visit(nested);
      }
    };
    visit(document);

    for (const reference of references) {
      expect(reference).toMatch(/^#\//);
      const resolved = reference
        .slice(2)
        .split('/')
        .reduce<unknown>((value, segment) => {
          if (!value || typeof value !== 'object') return undefined;
          return (value as Record<string, unknown>)[segment];
        }, document);
      expect(resolved, `Unresolved OpenAPI reference: ${reference}`).toBeDefined();
    }

    const routeHandler = Object.getOwnPropertyDescriptor(
      ExternalApiDocsController.prototype,
      'document',
    )?.value as object;
    expect(Reflect.getMetadata(PUBLIC_ROUTE, routeHandler)).toBe(true);
  });
});
