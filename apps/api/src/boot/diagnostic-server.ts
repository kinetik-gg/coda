import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { renderDiagnosticPage, type DiagnosticView } from './diagnostic-page';

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? '/').split('?')[0] ?? '/';
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  getView: () => DiagnosticView,
): void {
  const path = requestPath(request);
  if (path === '/api/v1/health/live') {
    sendJson(response, 200, { data: { status: 'ok' } });
    return;
  }
  if (path === '/api/v1/health/ready') {
    sendJson(response, 503, {
      type: 'https://coda.local/problems/503',
      status: 503,
      title: 'Service Unavailable',
      detail: 'A required service is unavailable',
      instance: path,
      requestId: randomUUID(),
    });
    return;
  }
  response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
  response.end(renderDiagnosticPage(getView()));
}

/**
 * A minimal static HTTP server (no Nest, no app data) served in place of the application while the
 * initial database connection is unavailable. Liveness always reports healthy; readiness always
 * fails; every other request receives the diagnostic page.
 */
export function createDiagnosticServer(getView: () => DiagnosticView): Server {
  return createServer((request, response) => handleRequest(request, response, getView));
}

export function listenDiagnosticServer(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

export function closeDiagnosticServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}
