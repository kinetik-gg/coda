// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import * as Y from 'yjs';
import type { ScreenplayCommentThreadView } from '@coda/contracts';
import { createScreenplayCommentAnchor } from './screenplay-comment-anchors';
import { ScreenplayCommentsPanel } from './ScreenplayCommentsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function documentWithText(source: string) {
  const document = new Y.Doc();
  const text = document.getText('source');
  text.insert(0, source);
  return { document, text };
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: string | undefined): { body?: string } {
  return JSON.parse(body ?? '{}') as { body?: string };
}

function threadFixture(
  text: Y.Text,
  overrides: Partial<ScreenplayCommentThreadView> = {},
): ScreenplayCommentThreadView {
  const anchor = createScreenplayCommentAnchor(text, 0, 17);
  return {
    id: 'thread-id',
    screenplayId: 'screenplay-id',
    authorUserId: 'current-user',
    author: { id: 'current-user', displayName: 'Ari' },
    ...anchor,
    status: 'OPEN',
    resolvedAt: null,
    resolvedById: null,
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T01:00:00.000Z',
    comments: [
      {
        id: 'comment-id',
        threadId: 'thread-id',
        authorUserId: 'current-user',
        author: { id: 'current-user', displayName: 'Ari' },
        body: 'The opening needs detail.',
        createdAt: '2026-07-29T01:00:00.000Z',
        editedAt: null,
        deletedAt: null,
      },
    ],
    ...overrides,
  };
}

function renderPanel(
  text: Y.Text,
  sourceText: string,
  fetchMock: ReturnType<typeof vi.fn>,
  overrides: Partial<ComponentProps<typeof ScreenplayCommentsPanel>> = {},
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onReveal = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ScreenplayCommentsPanel
        screenplayId="screenplay-id"
        status="open"
        text={text}
        sourceText={sourceText}
        selection={{ anchor: 0, head: 17, from: 0, to: 17 }}
        canEdit={false}
        canManage={false}
        onReveal={onReveal}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { client, onReveal };
}

describe('ScreenplayCommentsPanel thread workflow', () => {
  it('renders anchored context and lets a viewer create and reply', async () => {
    const source = 'INT. ROOM - DAY\n\nAction.\n';
    const { text } = documentWithText(source);
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      const method = init?.method ?? 'GET';
      requests.push({ path, method, body: init?.body as string | undefined });
      if (path === '/api/v1/auth/session') {
        return Promise.resolve(envelope({ id: 'current-user' }));
      }
      if (method === 'GET') return Promise.resolve(envelope([threadFixture(text)]));
      if (path.endsWith('/comments')) {
        return Promise.resolve(
          envelope({
            ...threadFixture(text).comments[0],
            id: 'reply-id',
            body: 'Reply body',
          }),
        );
      }
      return Promise.resolve(envelope(threadFixture(text)));
    });
    const { onReveal } = renderPanel(text, source, fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: /Anchored range/u }));
    expect(onReveal).toHaveBeenCalledWith(0, 17);

    fireEvent.change(screen.getByLabelText('New thread comment'), {
      target: { value: '  New anchored note  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith('/comment-threads') &&
            request.method === 'POST' &&
            requestBody(request.body).body === 'New anchored note',
        ),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText(/Reply to thread/u), {
      target: { value: 'A reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith('/thread-id/comments') &&
            request.method === 'POST' &&
            requestBody(request.body).body === 'A reply',
        ),
      ).toBe(true),
    );
  });

  it('shows detached context and applies author-aware moderation controls', async () => {
    const source = 'INT. ROOM - DAY\n\nAction.\n';
    const { text } = documentWithText(source);
    const original = threadFixture(text);
    text.delete(0, 17);
    const requests: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === '/api/v1/auth/session') {
        return Promise.resolve(envelope({ id: 'current-user' }));
      }
      if (init?.method) requests.push(`${init.method} ${path}`);
      return Promise.resolve(envelope(init?.method ? original : [original]));
    });
    renderPanel(text, text.toJSON(), fetchMock, {
      selection: { anchor: 0, head: 0, from: 0, to: 0 },
    });

    expect(await screen.findByText('Detached thread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detached thread/u })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit comment' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => {
      expect(requests).toContain('DELETE /api/v1/screenplays/screenplay-id/comments/comment-id');
      expect(requests).toContain(
        'PATCH /api/v1/screenplays/screenplay-id/comment-threads/thread-id/resolution',
      );
    });
  });
});
