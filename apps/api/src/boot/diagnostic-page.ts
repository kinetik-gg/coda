import type { DatabaseErrorClass } from './database-error';

export interface DiagnosticView {
  readonly host: string;
  readonly port: number;
  readonly errorClass: DatabaseErrorClass;
  readonly label: string;
  readonly hints: readonly string[];
  readonly attempt: number;
  readonly checkedAt: string;
  readonly nextRetryAt: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ESCAPES[character] ?? character);
}

/**
 * Render the minimal static diagnostic page served in place of the application while the initial
 * database connection cannot be established. It intentionally carries no application data and no
 * credentials — only the target host/port, an error classification, and operator hints.
 */
export function renderDiagnosticPage(view: DiagnosticView): string {
  const hints = view.hints.map((hint) => `<li>${escapeHtml(hint)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="15" />
<title>Coda — database unavailable</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e7e7e7; background: #16171a; } code { background: #26282d; } }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .status { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; background: #b91c1c; color: #fff; font-size: 0.85rem; font-weight: 600; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 1.25rem 0; }
  dt { font-weight: 600; opacity: 0.75; }
  dd { margin: 0; }
  code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
  ul { padding-left: 1.25rem; }
  footer { margin-top: 2rem; font-size: 0.85rem; opacity: 0.7; }
</style>
</head>
<body>
<span class="status">Database unavailable</span>
<h1>${escapeHtml(view.label)}</h1>
<p>Coda cannot reach its database yet. It is retrying automatically with backoff and will start
normally as soon as the database becomes reachable — no restart is required.</p>
<dl>
  <dt>Target</dt><dd><code>${escapeHtml(view.host)}:${view.port}</code></dd>
  <dt>Error class</dt><dd><code>${escapeHtml(view.errorClass)}</code></dd>
  <dt>Attempt</dt><dd>${view.attempt}</dd>
  <dt>Last checked</dt><dd>${escapeHtml(view.checkedAt)}</dd>
  <dt>Next retry</dt><dd>${escapeHtml(view.nextRetryAt)}</dd>
</dl>
<h2>Suggested next steps</h2>
<ul>${hints}</ul>
<footer>This page never displays credentials or application data. See docs/operations.md for
database connection troubleshooting.</footer>
</body>
</html>
`;
}
