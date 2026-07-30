/**
 * Documentation drift rules (issue #258).
 *
 * The shipped documentation in `docs/` and `README.md` drifted for several
 * releases without anything failing, because every other invariant in this
 * repository is gated and documentation was not. These rules close that gap.
 *
 * Every rule here compares a **fact stated in a document** against the
 * **source of truth for that fact**. None of them judges prose: a rule either
 * resolves a reference or it does not. That is deliberate — a documentation
 * gate that guesses gets switched off the first time it is wrong, so a missed
 * drift is a cheaper failure than a false alarm.
 *
 * The rules, and the source of truth each one reads:
 *
 * 1. `openapi-coverage` — every path in `docs/openapi.json` is spelled out in
 *    `docs/external-api.md`. This is exactly the drift that happened.
 * 2. `route-coverage` — every REST route declared by a Nest controller is
 *    either spelled out in `docs/external-api.md` or matched by an entry in
 *    `INTERNAL_ROUTE_PATTERNS`, the machine-readable mirror of that document's
 *    "Not part of the external API" section.
 * 3. `mcp-tools` — the tool names registered by the MCP server and the tool
 *    names documented in `docs/mcp.md` are the same set.
 * 4. `docs-index` — every file in `docs/` is reachable from `docs/index.md`,
 *    and every document `docs/index.md` links to exists.
 * 5. `doc-links` — relative Markdown links resolve to a real file, and a
 *    `#fragment` resolves to a heading in the target document.
 * 6. `repo-paths` — a backticked repository path (`apps/…`, `scripts/…`, …)
 *    names something that exists.
 * 7. `pnpm-scripts` — a documented `pnpm <script>` exists in the root
 *    `package.json`.
 * 8. `env-names` — a documented `UPPER_SNAKE_CASE` identifier still appears
 *    somewhere in tracked source, so a renamed or deleted environment
 *    variable cannot stay documented.
 * 9. `prisma-doc-refs` — documents cited from `schema.prisma` comments exist.
 */

/** One violated documentation fact. `check` names the rule that found it. */
export interface DriftViolation {
  check: string;
  detail: string;
}

/** A file the rules read, keyed by its repository-relative path. */
export interface DocFile {
  path: string;
  content: string;
}

/** A REST route declared by a Nest controller, with OpenAPI-style params. */
export interface ApiRoute {
  method: string;
  path: string;
  source: string;
}

/** Answers whether a repository-relative path exists. Injected for testing. */
export type PathExists = (candidate: string) => boolean;

/**
 * Routes that exist on a running instance and are deliberately outside the
 * external contract. This list is the executable form of the "Not part of the
 * external API" section of `docs/external-api.md`; each entry cites the bullet
 * it mirrors. Adding an internal route means adding it there and here, which
 * is the point: the categories stay in step, and a route that belongs to
 * neither category fails the gate.
 */
const INTERNAL_ROUTE_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'Setup and authentication', pattern: /^\/api\/v1\/setup\// },
  { label: 'Setup and authentication', pattern: /^\/api\/v1\/auth\// },
  { label: 'Setup and authentication', pattern: /^\/api\/v1\/invitations\// },
  { label: 'Account self-service', pattern: /^\/api\/v1\/account(\/|$)/ },
  { label: 'Instance administration', pattern: /^\/api\/v1\/instance(\/|$)/ },
  { label: 'Update and upgrade ceremony', pattern: /^\/api\/v1\/updates(\/|$)/ },
  { label: 'Health probes', pattern: /^\/api\/v1\/health\// },
  { label: 'Signed blob proxy', pattern: /^\/api\/v1\/blob\// },
  {
    label: 'Project lifecycle and sharing',
    pattern: /^\/api\/v1\/projects(\/(from-template|creation-options|import))?$/,
  },
  {
    label: 'Project lifecycle and sharing',
    pattern:
      /^\/api\/v1\/projects\/\{projectId\}\/(management|roles|memberships|available-users|invitations|transfer-ownership)(\/|$)/,
  },
  {
    label: 'Trash, restore, and purge',
    pattern: /^\/api\/v1\/projects\/(trash|restore|purge)(\/|$)/,
  },
  {
    label: 'Trash, restore, and purge',
    pattern:
      /^\/api\/v1\/projects\/\{projectId\}\/(items|fields|source-documents|storage-objects)\/\{\w+\}\/(trash|restore|purge)$/,
  },
  {
    label: 'Trash, restore, and purge',
    pattern: /^\/api\/v1\/projects\/\{projectId\}\/(trash|restore|purge)(\/|$)/,
  },
  {
    label: 'Trash, restore, and purge',
    pattern: /^\/api\/v1\/screenplays\/(trash|restore|purge)(\/|$)/,
  },
  {
    label: 'Trash, restore, and purge',
    pattern: /^\/api\/v1\/screenplays\/\{screenplayId\}\/(trash|restore|purge)$/,
  },
  {
    label: 'Saved layouts',
    pattern: /^\/api\/v1\/projects\/\{projectId\}\/workspace-layout(\/|$)/,
  },
  {
    label: 'Saved layouts',
    pattern: /^\/api\/v1\/screenplays\/\{screenplayId\}\/panel-layout(\/|$)/,
  },
  {
    label: 'Screenplay sharing',
    pattern:
      /^\/api\/v1\/screenplays\/\{screenplayId\}\/(management|memberships|available-users|invitations|transfer-ownership)(\/|$)/,
  },
  {
    // Cross-aggregate: the actor must reach the screenplay too, and no project-scoped credential
    // can do that, so the link is session-only rather than part of the breakdown contract (#238).
    label: 'Breakdown screenplay link',
    pattern: /^\/api\/v1\/projects\/\{projectId\}\/screenplay-link$/,
  },
];

/** Top-level directories a backticked repository path may start with. */
const REPO_PATH_ROOTS: readonly string[] = [
  '.github/',
  'apps/',
  'deploy/',
  'docs/',
  'e2e/',
  'packages/',
  'prisma/',
  'scripts/',
  'tests/',
];

/**
 * pnpm's own subcommands. `pnpm <name>` is only checked against the root
 * `package.json` when the name is not one of these.
 */
const PNPM_BUILTINS: ReadonlySet<string> = new Set([
  'add',
  'audit',
  'bin',
  'config',
  'create',
  'dedupe',
  'deploy',
  'dlx',
  'env',
  'exec',
  'fetch',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'outdated',
  'pack',
  'patch',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'setup',
  'store',
  'unlink',
  'up',
  'update',
  'why',
]);

const CONTROLLER_PATTERN = /@Controller\(\s*'(?<base>[^']*)'\s*\)/g;
const ROUTE_PATTERN = /@(?<method>Get|Post|Patch|Put|Delete)\(\s*(?:'(?<sub>[^']*)')?/g;
const REGISTER_TOOL_PATTERN = /registerTool\(\s*'(?<tool>[^']+)'/g;
const MARKDOWN_LINK_PATTERN = /\]\((?<target>[^)\s]+)\)/g;
const INLINE_CODE_PATTERN = /`(?<code>[^`\n]+)`/g;
const FENCED_CODE_PATTERN = /```[a-z]*\n(?<code>[\s\S]*?)```/g;
const PNPM_COMMAND_PATTERN = /pnpm\s+(?<script>[a-z][a-z0-9:._-]*)/g;
const HEADING_PATTERN = /^#{1,6}\s+(?<text>.*)$/;
const ENV_NAME_PATTERN = /`(?<name>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g;
const DOC_REFERENCE_PATTERN = /docs\/[A-Za-z0-9._/-]+\.md/g;

/** Path characters that mark a token as a pattern or placeholder, not a path. */
const NON_LITERAL_PATH = /[*?<>{}\s|]/;

function violation(check: string, detail: string): DriftViolation {
  return { check, detail };
}

/** Reads the `paths` keys of an OpenAPI document without trusting its shape. */
export function extractOpenApiPaths(openapiJson: string): string[] {
  const parsed: unknown = JSON.parse(openapiJson);
  if (typeof parsed !== 'object' || parsed === null) return [];
  const { paths } = parsed as { paths?: unknown };
  if (typeof paths !== 'object' || paths === null) return [];
  return Object.keys(paths);
}

/** Rule 1: every published OpenAPI path is spelled out in the external doc. */
export function checkOpenApiCoverage(
  openapiJson: string,
  externalApiDoc: string,
): DriftViolation[] {
  return extractOpenApiPaths(openapiJson)
    .filter((path) => !externalApiDoc.includes(path))
    .map((path) =>
      violation(
        'openapi-coverage',
        `${path} is published in docs/openapi.json but is not documented in docs/external-api.md.`,
      ),
    );
}

function joinRoute(base: string, sub: string): string {
  const segments = [base, sub].filter((segment) => segment.length > 0).join('/');
  return `/${segments}`.replace(/:(?<param>[A-Za-z0-9_]+)/g, '{$<param>}');
}

/**
 * Splits a controller file into one section per `@Controller('…')` so routes
 * are attributed to the decorator that actually precedes them. Two files in
 * `apps/api/src` declare more than one controller.
 */
function splitByController(source: string): { base: string; body: string }[] {
  const sections: { base: string; body: string }[] = [];
  const matches = [...source.matchAll(CONTROLLER_PATTERN)];
  matches.forEach((match, index) => {
    const base = match.groups?.base;
    if (base === undefined) return;
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    sections.push({ base, body: source.slice(start, end) });
  });
  return sections;
}

/** Reads every REST route a set of controller files declares. */
export function extractApiRoutes(controllers: readonly DocFile[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  for (const file of controllers) {
    for (const section of splitByController(file.content)) {
      for (const match of section.body.matchAll(ROUTE_PATTERN)) {
        const method = match.groups?.method;
        if (method === undefined) continue;
        routes.push({
          method: method.toUpperCase(),
          path: joinRoute(section.base, match.groups?.sub ?? ''),
          source: file.path,
        });
      }
    }
  }
  return routes;
}

/** Rule 2: a route is documented, or explicitly internal. Never neither. */
export function checkRouteCoverage(
  controllers: readonly DocFile[],
  externalApiDoc: string,
): DriftViolation[] {
  const undocumented = new Map<string, string>();
  for (const route of extractApiRoutes(controllers)) {
    if (externalApiDoc.includes(route.path)) continue;
    if (INTERNAL_ROUTE_PATTERNS.some(({ pattern }) => pattern.test(route.path))) continue;
    undocumented.set(`${route.method} ${route.path}`, route.source);
  }
  return [...undocumented].map(([route, source]) =>
    violation(
      'route-coverage',
      `${route} (${source}) is neither documented in docs/external-api.md nor listed as internal ` +
        'in INTERNAL_ROUTE_PATTERNS in scripts/docs-drift.ts. Document it, or record it in the ' +
        '"Not part of the external API" section and add a matching pattern.',
    ),
  );
}

/** Tool names the MCP server registers. */
export function extractRegisteredTools(serverSource: string): string[] {
  return [...serverSource.matchAll(REGISTER_TOOL_PATTERN)].flatMap((match) => {
    const tool = match.groups?.tool;
    return tool === undefined ? [] : [tool];
  });
}

/**
 * Tool names documented by `docs/mcp.md`: the first cell of each row of the
 * table under the `## Tools` heading.
 */
export function extractDocumentedTools(mcpDoc: string): string[] {
  const section = mcpDoc.split(/^## Tools$/m)[1] ?? '';
  const table = section.split(/^## /m)[0] ?? '';
  return table
    .split('\n')
    .flatMap((line) => {
      const cell = /^\|\s*`(?<tool>[a-z][a-zA-Z0-9._]*)`\s*\|/.exec(line);
      const tool = cell?.groups?.tool;
      return tool === undefined ? [] : [tool];
    })
    .sort((left, right) => left.localeCompare(right));
}

/** Rule 3: the registered and documented MCP tool sets are identical. */
export function checkMcpTools(serverSource: string, mcpDoc: string): DriftViolation[] {
  const registered = extractRegisteredTools(serverSource);
  const documented = new Set(extractDocumentedTools(mcpDoc));
  const violations: DriftViolation[] = [];
  if (registered.length === 0) {
    return [violation('mcp-tools', 'No registered MCP tools were found; the extractor is stale.')];
  }
  for (const tool of registered) {
    if (!documented.has(tool)) {
      violations.push(
        violation(
          'mcp-tools',
          `MCP tool ${tool} is registered in apps/mcp/src/server.ts but is missing from the tool table in docs/mcp.md.`,
        ),
      );
    }
  }
  const registeredSet = new Set(registered);
  for (const tool of documented) {
    if (!registeredSet.has(tool)) {
      violations.push(
        violation(
          'mcp-tools',
          `MCP tool ${tool} is documented in docs/mcp.md but is not registered in apps/mcp/src/server.ts.`,
        ),
      );
    }
  }
  return violations;
}

/** Rule 4: `docs/index.md` and the contents of `docs/` agree. */
export function checkDocsIndex(
  indexDoc: string,
  docsFileNames: readonly string[],
): DriftViolation[] {
  const linked = new Set(
    [...indexDoc.matchAll(MARKDOWN_LINK_PATTERN)].flatMap((match) => {
      const target = match.groups?.target;
      if (target === undefined || /^(https?:|mailto:|#)/.test(target)) return [];
      return [target.split('#')[0] ?? ''];
    }),
  );
  return docsFileNames
    .filter((name) => name !== 'index.md' && !linked.has(name))
    .map((name) =>
      violation(
        'docs-index',
        `docs/${name} is not linked from docs/index.md, so no reader is routed to it.`,
      ),
    );
}

function headingAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of content.split('\n')) {
    const heading = HEADING_PATTERN.exec(line);
    const text = heading?.groups?.text;
    if (text === undefined) continue;
    anchors.add(
      text
        .replace(/`/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 \-_]/g, '')
        .trim()
        .replace(/ +/g, '-'),
    );
  }
  return anchors;
}

function directoryOf(filePath: string): string {
  const cut = filePath.lastIndexOf('/');
  return cut === -1 ? '' : filePath.slice(0, cut);
}

function resolveRelative(fromFile: string, target: string): string {
  const directory = directoryOf(fromFile);
  const segments = (directory === '' ? target : `${directory}/${target}`).split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

/** Rule 5: relative links resolve, and heading fragments exist. */
export function checkDocLinks(docs: readonly DocFile[], exists: PathExists): DriftViolation[] {
  const contents = new Map(docs.map((doc) => [doc.path, doc.content]));
  const violations: DriftViolation[] = [];
  for (const doc of docs) {
    for (const match of doc.content.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match.groups?.target;
      if (target === undefined || /^(https?:|mailto:)/.test(target)) continue;
      const [relativePath = '', fragment] = target.split('#');
      const resolved = relativePath === '' ? doc.path : resolveRelative(doc.path, relativePath);
      if (relativePath !== '' && !exists(resolved)) {
        violations.push(
          violation('doc-links', `${doc.path} links to ${target}, which is missing.`),
        );
        continue;
      }
      if (fragment === undefined || fragment === '' || !resolved.endsWith('.md')) continue;
      const targetContent = contents.get(resolved);
      if (targetContent === undefined) continue;
      if (!headingAnchors(targetContent).has(fragment)) {
        violations.push(
          violation(
            'doc-links',
            `${doc.path} links to ${target}, but that heading does not exist.`,
          ),
        );
      }
    }
  }
  return violations;
}

function inlineCodeTokens(content: string): string[] {
  return [...content.matchAll(INLINE_CODE_PATTERN)].flatMap((match) => {
    const code = match.groups?.code;
    return code === undefined ? [] : [code.trim()];
  });
}

/**
 * Rule 6: backticked repository paths exist.
 *
 * Only tokens that start with a real top-level directory are considered, and
 * only when they are a literal path: anything with a glob, a placeholder, or
 * whitespace is skipped, as is any `.env` file, because the operator
 * instructions legitimately name env files the repository does not ship. A
 * trailing `:12` or `:9-10` line reference is stripped before the lookup.
 */
export function checkRepoPaths(docs: readonly DocFile[], exists: PathExists): DriftViolation[] {
  const violations: DriftViolation[] = [];
  for (const doc of docs) {
    for (const token of inlineCodeTokens(doc.content)) {
      if (!REPO_PATH_ROOTS.some((root) => token.startsWith(root))) continue;
      if (NON_LITERAL_PATH.test(token) || token.endsWith('.env')) continue;
      const candidate = token
        .replace(/:\d+(-\d+)?$/, '')
        .replace(/[.,;:)]+$/, '')
        .replace(/\/$/, '');
      if (!exists(candidate)) {
        violations.push(
          violation('repo-paths', `${doc.path} references ${token}, which does not exist.`),
        );
      }
    }
  }
  return violations;
}

function codeText(content: string): string {
  const fenced = [...content.matchAll(FENCED_CODE_PATTERN)].map(
    (match) => match.groups?.code ?? '',
  );
  return [...inlineCodeTokens(content), ...fenced].join('\n');
}

/** Rule 7: a documented `pnpm <script>` exists in the root manifest. */
export function checkPnpmScripts(
  docs: readonly DocFile[],
  scriptNames: ReadonlySet<string>,
): DriftViolation[] {
  const violations: DriftViolation[] = [];
  for (const doc of docs) {
    const reported = new Set<string>();
    for (const match of codeText(doc.content).matchAll(PNPM_COMMAND_PATTERN)) {
      const script = match.groups?.script;
      if (script === undefined || PNPM_BUILTINS.has(script)) continue;
      if (scriptNames.has(script) || reported.has(script)) continue;
      reported.add(script);
      violations.push(
        violation(
          'pnpm-scripts',
          `${doc.path} documents \`pnpm ${script}\`, which is not a script in package.json.`,
        ),
      );
    }
  }
  return violations;
}

/**
 * Rule 8: a documented `UPPER_SNAKE_CASE` identifier still appears in source.
 *
 * This is a deliberately weak existence check rather than a claim about
 * meaning: it catches the environment variable or constant that was renamed
 * or deleted while the documentation kept describing it, and it cannot
 * misfire on a name the code still contains.
 */
export function checkEnvNames(docs: readonly DocFile[], sourceCorpus: string): DriftViolation[] {
  const violations: DriftViolation[] = [];
  const reported = new Set<string>();
  for (const doc of docs) {
    for (const match of doc.content.matchAll(ENV_NAME_PATTERN)) {
      const name = match.groups?.name;
      if (name === undefined || reported.has(name) || sourceCorpus.includes(name)) continue;
      reported.add(name);
      violations.push(
        violation(
          'env-names',
          `${doc.path} documents ${name}, which no longer appears anywhere in tracked source.`,
        ),
      );
    }
  }
  return violations;
}

/** Rule 9: documents cited from the Prisma schema exist. */
export function checkPrismaDocRefs(prismaSchema: string, exists: PathExists): DriftViolation[] {
  const referenced = new Set(prismaSchema.match(DOC_REFERENCE_PATTERN) ?? []);
  return [...referenced]
    .filter((reference) => !exists(reference))
    .map((reference) =>
      violation(
        'prisma-doc-refs',
        `apps/api/prisma/schema.prisma cites ${reference}, which does not exist.`,
      ),
    );
}

/** Renders violations one per line, grouped by the rule that found them. */
export function formatViolations(violations: readonly DriftViolation[]): string {
  return [...violations]
    .sort(
      (left, right) =>
        left.check.localeCompare(right.check) || left.detail.localeCompare(right.detail),
    )
    .map(({ check, detail }) => `  [${check}] ${detail}`)
    .join('\n');
}
