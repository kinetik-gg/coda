import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

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
  formatViolations,
  type DocFile,
  type DriftViolation,
} from './docs-drift';

// Documents this gate holds to the source. `docs/` is the shipped public
// documentation; README.md is the front door; AGENTS.md is the contributor map
// and states the same facts about scripts and directories.
const ROOT_DOCS = ['README.md', 'AGENTS.md'];

const OPENAPI_JSON = 'docs/openapi.json';
const EXTERNAL_API_DOC = 'docs/external-api.md';
const MCP_DOC = 'docs/mcp.md';
const DOCS_INDEX = 'docs/index.md';
const MCP_SERVER = 'apps/mcp/src/server.ts';
const PRISMA_SCHEMA = 'apps/api/prisma/schema.prisma';

// Trees searched for a documented `UPPER_SNAKE_CASE` identifier.
const SOURCE_ROOTS = ['apps', 'packages', 'scripts', 'deploy', '.github'];

// Extensions worth searching for a documented identifier. Markdown is excluded
// on purpose: documentation must not be able to satisfy its own reference.
const SOURCE_EXTENSIONS = [
  '.cjs',
  '.css',
  '.example',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.prisma',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
];

/** Repository-relative paths of every file git tracks under `roots`. */
function trackedFiles(roots: readonly string[]): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...roots], { encoding: 'utf8' });
  return output.split('\0').filter((entry) => entry.length > 0);
}

async function readDocFiles(paths: readonly string[]): Promise<DocFile[]> {
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, 'utf8') })));
}

function isController(path: string): boolean {
  return path.endsWith('.controller.ts') && !path.includes('.test.');
}

async function readSourceCorpus(): Promise<string> {
  const paths = trackedFiles(SOURCE_ROOTS).filter((path) =>
    SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)),
  );
  const contents = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  return contents.join('\n');
}

async function collectViolations(): Promise<{ documents: number; violations: DriftViolation[] }> {
  const documentPaths = [
    ...trackedFiles(['docs']).filter((path) => path.endsWith('.md')),
    ...ROOT_DOCS,
  ];
  const documents = await readDocFiles(documentPaths);
  const controllers = await readDocFiles(trackedFiles(['apps/api/src']).filter(isController));

  const [openapiJson, externalApiDoc, mcpDoc, indexDoc, mcpServer, prismaSchema, sourceCorpus] =
    await Promise.all([
      readFile(OPENAPI_JSON, 'utf8'),
      readFile(EXTERNAL_API_DOC, 'utf8'),
      readFile(MCP_DOC, 'utf8'),
      readFile(DOCS_INDEX, 'utf8'),
      readFile(MCP_SERVER, 'utf8'),
      readFile(PRISMA_SCHEMA, 'utf8'),
      readSourceCorpus(),
    ]);

  const manifest: unknown = JSON.parse(await readFile('package.json', 'utf8'));
  const { scripts } = manifest as { scripts?: Record<string, string> };
  const scriptNames = new Set(Object.keys(scripts ?? {}));

  const docsFileNames = trackedFiles(['docs'])
    .filter((path) => !path.slice('docs/'.length).includes('/'))
    .map((path) => path.slice('docs/'.length));

  return {
    documents: documents.length,
    violations: [
      ...checkOpenApiCoverage(openapiJson, externalApiDoc),
      ...checkRouteCoverage(controllers, externalApiDoc),
      ...checkMcpTools(mcpServer, mcpDoc),
      ...checkDocsIndex(indexDoc, docsFileNames),
      ...checkDocLinks(documents, existsSync),
      ...checkRepoPaths(documents, existsSync),
      ...checkPnpmScripts(documents, scriptNames),
      ...checkEnvNames(documents, sourceCorpus),
      ...checkPrismaDocRefs(prismaSchema, existsSync),
    ],
  };
}

async function main(): Promise<void> {
  const { documents, violations } = await collectViolations();

  if (violations.length > 0) {
    console.error(
      'Documentation states facts the source no longer supports. Update the document (or the ' +
        'source of truth it cites):\n' +
        formatViolations(violations),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-docs-drift: ${documents} documents clean — every documented path, route, tool, link, script, and identifier resolves.`,
  );
}

main().catch((error: unknown) => {
  console.error('Unable to check documentation drift.', error);
  process.exitCode = 1;
});
