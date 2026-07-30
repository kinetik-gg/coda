import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  checkDocLinks,
  checkDocsIndex,
  checkEnvNames,
  checkMcpTools,
  checkOpenApiCoverage,
  checkPnpmScripts,
  checkPrismaDocRefs,
  checkRepoPaths,
  checkRouteCoverage,
  extractApiRoutes,
  extractDocumentedTools,
  extractOpenApiPaths,
  extractRegisteredTools,
  formatViolations,
  type DocFile,
} from './docs-drift';

const externalApiDoc = readFileSync('docs/external-api.md', 'utf8');
const mcpDoc = readFileSync('docs/mcp.md', 'utf8');
const mcpServer = readFileSync('apps/mcp/src/server.ts', 'utf8');
const openapiJson = readFileSync('docs/openapi.json', 'utf8');

function doc(path: string, content: string): DocFile[] {
  return [{ path, content }];
}

describe('checkOpenApiCoverage', () => {
  it('accepts the shipped OpenAPI document against the shipped external API doc', () => {
    expect(checkOpenApiCoverage(openapiJson, externalApiDoc)).toEqual([]);
  });

  it('names a published path the document does not mention', () => {
    const violations = checkOpenApiCoverage(
      JSON.stringify({ paths: { '/api/v1/widgets': {} } }),
      '# nothing here',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.check).toBe('openapi-coverage');
    expect(violations[0]?.detail).toContain('/api/v1/widgets');
  });

  it('tolerates a document without a paths object', () => {
    expect(extractOpenApiPaths('{}')).toEqual([]);
    expect(extractOpenApiPaths('null')).toEqual([]);
  });
});

describe('extractApiRoutes', () => {
  const controller = `
    @Controller('api/v1/projects')
    class ProjectsController {
      @Get('trash') list() {}
    }

    @Controller('api/v1/projects/:projectId')
    class ProjectController {
      @Delete('items/:itemId/trash') trash() {}
      @Get() read() {}
    }
  `;

  it('attributes routes to the controller that precedes them', () => {
    expect(extractApiRoutes(doc('x.controller.ts', controller))).toEqual([
      { method: 'GET', path: '/api/v1/projects/trash', source: 'x.controller.ts' },
      {
        method: 'DELETE',
        path: '/api/v1/projects/{projectId}/items/{itemId}/trash',
        source: 'x.controller.ts',
      },
      { method: 'GET', path: '/api/v1/projects/{projectId}', source: 'x.controller.ts' },
    ]);
  });

  it('reads every route of the shipped API', () => {
    const controllers = ['apps/api/src/spaces/spaces.controller.ts'].map((path) => ({
      path,
      content: readFileSync(path, 'utf8'),
    }));
    const routes = extractApiRoutes(controllers);
    expect(routes.length).toBeGreaterThan(5);
    expect(routes.map((route) => route.path)).toContain('/api/v1/spaces/{spaceId}');
  });
});

describe('checkRouteCoverage', () => {
  it('accepts every controller the repository ships', () => {
    const controllers = ['apps/api/src/trash/trash.controller.ts'].map((path) => ({
      path,
      content: readFileSync(path, 'utf8'),
    }));
    expect(checkRouteCoverage(controllers, externalApiDoc)).toEqual([]);
  });

  it('fails a new external route that no document mentions', () => {
    const controller = `
      @Controller('api/v1/projects/:projectId')
      class C {
        @Post('items/:itemId/attachments') attach() {}
      }
    `;
    const violations = checkRouteCoverage(doc('new.controller.ts', controller), externalApiDoc);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.check).toBe('route-coverage');
    expect(violations[0]?.detail).toContain(
      'POST /api/v1/projects/{projectId}/items/{itemId}/attachments',
    );
  });

  it('accepts a new route under an internal prefix', () => {
    const controller = `
      @Controller('api/v1/instance')
      class C {
        @Get('brand-new-console') read() {}
      }
    `;
    expect(checkRouteCoverage(doc('i.controller.ts', controller), externalApiDoc)).toEqual([]);
  });
});

describe('MCP tool parity', () => {
  it('matches the shipped server against the shipped document', () => {
    expect(checkMcpTools(mcpServer, mcpDoc)).toEqual([]);
    expect(extractRegisteredTools(mcpServer).sort()).toEqual(extractDocumentedTools(mcpDoc));
  });

  it('names a registered tool the document omits', () => {
    const server = `${mcpServer}\nserver.registerTool('items.delete', {}, () => {});`;
    const violations = checkMcpTools(server, mcpDoc);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('items.delete');
    expect(violations[0]?.detail).toContain('missing from the tool table');
  });

  it('names a documented tool the server does not register', () => {
    const document = `${mcpDoc.split('## What the token cannot reach')[0] ?? ''}| \`items.delete\` | none | none | none |\n`;
    const violations = checkMcpTools(mcpServer, document);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('is not registered');
  });

  it('fails loudly when no tool can be extracted at all', () => {
    expect(checkMcpTools('', mcpDoc)[0]?.detail).toContain('extractor is stale');
  });
});

describe('checkDocsIndex', () => {
  it('names a document nothing routes a reader to', () => {
    const violations = checkDocsIndex('[a](architecture.md)', ['architecture.md', 'orphan.md']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('docs/orphan.md');
  });

  it('ignores index.md itself and external links', () => {
    expect(checkDocsIndex('[x](https://example.com) [a](a.md)', ['index.md', 'a.md'])).toEqual([]);
  });
});

describe('checkDocLinks', () => {
  const exists = (candidate: string): boolean => candidate === 'docs/architecture.md';

  it('resolves a relative link and a heading anchor', () => {
    const docs: DocFile[] = [
      { path: 'docs/index.md', content: '[a](architecture.md#package-boundaries)' },
      { path: 'docs/architecture.md', content: '## Package boundaries\n' },
    ];
    expect(checkDocLinks(docs, exists)).toEqual([]);
  });

  it('names a missing file and a missing heading', () => {
    const docs: DocFile[] = [
      { path: 'docs/index.md', content: '[a](gone.md) [b](architecture.md#no-such-heading)' },
      { path: 'docs/architecture.md', content: '## Package boundaries\n' },
    ];
    const violations = checkDocLinks(docs, exists);
    expect(violations.map((entry) => entry.detail)).toEqual([
      'docs/index.md links to gone.md, which is missing.',
      'docs/index.md links to architecture.md#no-such-heading, but that heading does not exist.',
    ]);
  });

  it('resolves a same-document fragment and a parent-directory link', () => {
    const docs: DocFile[] = [
      { path: 'docs/index.md', content: '## Here\n[a](#here) [b](../docs/architecture.md)' },
      { path: 'docs/architecture.md', content: '## Package boundaries\n' },
    ];
    expect(checkDocLinks(docs, exists)).toEqual([]);
  });

  it('holds every shipped document to its own links', () => {
    const paths = ['docs/index.md', 'docs/external-api.md', 'docs/mcp.md', 'README.md'];
    const docs = paths.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
    expect(checkDocLinks(docs, existsSync)).toEqual([]);
  });
});

describe('checkRepoPaths', () => {
  const exists = (candidate: string): boolean => candidate === 'apps/api/src/main.ts';

  it('names a backticked path that no longer exists', () => {
    const violations = checkRepoPaths(doc('README.md', 'see `apps/api/src/gone.ts`'), exists);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('apps/api/src/gone.ts');
  });

  it('accepts a path with a line reference and a trailing slash', () => {
    const content = 'see `apps/api/src/main.ts:9-10` and `apps/api/src/`';
    const withDirectory = (candidate: string): boolean =>
      candidate === 'apps/api/src/main.ts' || candidate === 'apps/api/src';
    expect(checkRepoPaths(doc('README.md', content), withDirectory)).toEqual([]);
  });

  it('skips globs, placeholders, prose, and operator-created env files', () => {
    const content =
      'run `apps/**/*.ts`, copy to `deploy/minio/minio.env`, open `<path-to-coda>/apps/x.ts`, ' +
      'and read `some prose apps/api`';
    expect(checkRepoPaths(doc('README.md', content), exists)).toEqual([]);
  });
});

describe('checkPnpmScripts', () => {
  const scripts = new Set(['quality', 'quality:docs-drift']);

  it('names a documented script the manifest does not define', () => {
    const violations = checkPnpmScripts(doc('README.md', 'run `pnpm quality:gone`'), scripts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('pnpm quality:gone');
  });

  it('accepts defined scripts, pnpm subcommands, and prose outside code', () => {
    const content =
      'run `pnpm quality`, `pnpm install --frozen-lockfile`, `pnpm --filter @coda/mcp build`, ' +
      'inside the pnpm workspace globs\n```sh\npnpm quality:docs-drift\n```\n';
    expect(checkPnpmScripts(doc('README.md', content), scripts)).toEqual([]);
  });

  it('reports one violation per script per document', () => {
    const content = '`pnpm gone` and `pnpm gone` again';
    expect(checkPnpmScripts(doc('README.md', content), scripts)).toHaveLength(1);
  });

  it('accepts a documented pnpm builtin, such as the `pnpm view` from #290', () => {
    expect(checkPnpmScripts(doc('docs/adr-example.md', 'run `pnpm view`'), scripts)).toEqual([]);
  });

  it('still fails a documented non-existent script, so the fix cannot accept any `pnpm <word>`', () => {
    const violations = checkPnpmScripts(
      doc('docs/adr-example.md', 'run `pnpm not-a-real-script`'),
      scripts,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.check).toBe('pnpm-scripts');
    expect(violations[0]?.detail).toContain('pnpm not-a-real-script');
  });
});

describe('checkEnvNames', () => {
  it('names a documented identifier that has left the source', () => {
    const violations = checkEnvNames(doc('docs/operations.md', 'set `LEGACY_S3_KEY`'), 'S3_BUCKET');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('LEGACY_S3_KEY');
  });

  it('ignores single-word tokens such as HTTP verbs and statuses', () => {
    expect(checkEnvNames(doc('docs/x.md', '`PATCH` returns `CONFLICT`'), '')).toEqual([]);
  });

  it('accepts an identifier the source still contains', () => {
    expect(checkEnvNames(doc('docs/x.md', '`APP_ORIGIN`'), 'const x = APP_ORIGIN;')).toEqual([]);
  });
});

describe('checkPrismaDocRefs', () => {
  it('accepts the documents the shipped schema cites', () => {
    const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
    expect(checkPrismaDocRefs(schema, existsSync)).toEqual([]);
  });

  it('names a cited document that does not exist', () => {
    const violations = checkPrismaDocRefs('// see docs/adr-gone.md', () => false);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('docs/adr-gone.md');
  });
});

describe('formatViolations', () => {
  it('groups by rule and prefixes each line with it', () => {
    expect(
      formatViolations([
        { check: 'repo-paths', detail: 'second' },
        { check: 'doc-links', detail: 'first' },
      ]),
    ).toBe('  [doc-links] first\n  [repo-paths] second');
  });
});
