// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackerRecordComment,
  deleteTrackerRecordComment,
  listTrackerRecordComments,
  updateTrackerRecordComment,
} from '../../api';
import type { CursorPage } from '../../api';
import type { TrackerComment, TrackerCurrentUser } from '../../trackers/types';
import { TrackerInspectorComments } from './TrackerInspectorComments';

const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(readonly problem: { status: number; title: string; detail?: string }) {
      super(problem.title);
    }
  }
  return { MockApiError };
});

vi.mock('../../api', () => ({
  ApiError: MockApiError,
  listTrackerRecordComments: vi.fn(),
  createTrackerRecordComment: vi.fn(),
  updateTrackerRecordComment: vi.fn(),
  deleteTrackerRecordComment: vi.fn(),
}));

const currentUser: TrackerCurrentUser = { id: 'user-1', displayName: 'Ari' };

function comment(overrides: Partial<TrackerComment> = {}): TrackerComment {
  return {
    id: 'c-1',
    recordId: 'r-1',
    authorId: 'user-1',
    body: 'First note',
    version: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    editedAt: null,
    author: { id: 'user-1', displayName: 'Ari' },
    ...overrides,
  };
}

function page(items: TrackerComment[], nextCursor: string | null = null): CursorPage<TrackerComment> {
  return { items, nextCursor };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrackerInspectorComments
        trackerId="t1"
        recordId="r-1"
        currentUser={currentUser}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(listTrackerRecordComments).mockReset().mockResolvedValue(page([comment()]));
  vi.mocked(createTrackerRecordComment).mockReset();
  vi.mocked(updateTrackerRecordComment).mockReset();
  vi.mocked(deleteTrackerRecordComment).mockReset();
});

describe('tracker inspector comments section', () => {
  it('renders comments oldest first with authors, timestamps, and the edited marker', async () => {
    const other = comment({
      id: 'c-2',
      authorId: 'user-2',
      body: 'Second note',
      editedAt: '2026-08-21T09:00:00.000Z',
      author: { id: 'user-2', displayName: 'Bea' },
    });
    vi.mocked(listTrackerRecordComments).mockReset().mockResolvedValue(page([comment(), other]));

    const { container } = renderSection();

    await screen.findByText('First note');
    expect(screen.getByText('Second note')).toBeTruthy();
    expect(screen.getByText('Ari')).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.getByText('(edited)')).toBeTruthy();
    const stamps = container.querySelectorAll('article time');
    expect(stamps.length).toBeGreaterThanOrEqual(3);
    expect(stamps[0]?.getAttribute('title')).toBeTruthy();
    const bodies = [...container.querySelectorAll('article p')].map((node) => node.textContent);
    expect(bodies).toEqual(['First note', 'Second note']);
  });

  it('shows an empty state before anything has been posted', async () => {
    vi.mocked(listTrackerRecordComments).mockReset().mockResolvedValue(page([]));
    renderSection();
    expect(await screen.findByText('No comments.')).toBeTruthy();
  });

  it('sends trimmed drafts on Enter, keeps them for Shift+Enter, and clears on success', async () => {
    vi.mocked(createTrackerRecordComment).mockResolvedValue(comment({ id: 'c-new' }));
    renderSection();
    await screen.findByText('First note');
    const draft = screen.getByPlaceholderText('Add a comment');

    fireEvent.change(draft, { target: { value: '  New note  ' } });
    fireEvent.keyDown(draft, { key: 'Enter', shiftKey: true });
    expect(vi.mocked(createTrackerRecordComment)).not.toHaveBeenCalled();

    fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() =>
      expect(vi.mocked(createTrackerRecordComment)).toHaveBeenCalledWith({
        trackerId: 't1',
        recordId: 'r-1',
        body: 'New note',
      }),
    );
    await waitFor(() => expect(draft).toHaveProperty('value', ''));
  });

  it('shows author-only edit and delete affordances', async () => {
    const foreign = comment({
      id: 'c-2',
      authorId: 'user-2',
      body: 'Second note',
      author: { id: 'user-2', displayName: 'Bea' },
    });
    vi.mocked(listTrackerRecordComments).mockReset().mockResolvedValue(page([comment(), foreign]));
    renderSection();

    await screen.findByText('Second note');
    expect(screen.getByLabelText(/Edit comment: First note/)).toBeTruthy();
    expect(screen.getByLabelText(/Delete comment: First note/)).toBeTruthy();
    expect(screen.queryByLabelText(/Edit comment: Second note/)).toBeNull();
    expect(screen.queryByLabelText(/Delete comment: Second note/)).toBeNull();
  });

  it('edits an own comment inline against its stored version', async () => {
    vi.mocked(updateTrackerRecordComment).mockResolvedValue(
      comment({ body: 'Rewritten', version: 2, editedAt: '2026-08-22T00:00:00.000Z' }),
    );
    vi.mocked(listTrackerRecordComments)
      .mockReset()
      // The settle-time refetch answers the stored, edited row.
      .mockResolvedValueOnce(page([comment()]))
      .mockResolvedValue(
        page([comment({ body: 'Rewritten', version: 2, editedAt: '2026-08-22T00:00:00.000Z' })]),
      );
    renderSection();
    await screen.findByText('First note');

    fireEvent.click(screen.getByLabelText(/Edit comment: First note/));
    const editor = await screen.findByLabelText('Edit comment');
    expect(editor).toHaveProperty('value', 'First note');
    fireEvent.change(editor, { target: { value: 'Rewritten' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(vi.mocked(updateTrackerRecordComment)).toHaveBeenCalledWith({
        trackerId: 't1',
        recordId: 'r-1',
        commentId: 'c-1',
        body: 'Rewritten',
        version: 1,
      }),
    );
    expect(await screen.findByText('(edited)')).toBeTruthy();
  });

  it('deletes an own comment behind an explicit confirmation', async () => {
    vi.mocked(deleteTrackerRecordComment).mockResolvedValue({ id: 'c-1' });
    renderSection();
    await screen.findByText('First note');

    fireEvent.click(screen.getByLabelText(/Delete comment: First note/));
    expect(await screen.findByText('Delete this comment?')).toBeTruthy();
    expect(vi.mocked(deleteTrackerRecordComment)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Delete comment'));
    await waitFor(() =>
      expect(vi.mocked(deleteTrackerRecordComment)).toHaveBeenCalledWith({
        trackerId: 't1',
        recordId: 'r-1',
        commentId: 'c-1',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Delete this comment?')).toBeNull());
  });

  it('rolls the optimistic append back and surfaces a rejected post inline', async () => {
    let rejectPost!: (reason: unknown) => void;
    vi.mocked(createTrackerRecordComment).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }),
    );
    const { container } = renderSection();
    await screen.findByText('First note');

    fireEvent.change(screen.getByPlaceholderText('Add a comment'), {
      target: { value: 'In-flight note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    // The optimistic row shows while the request is in flight…
    expect(await screen.findByText('In-flight note')).toBeTruthy();

    // …and a 403 rolls it back into an inline problem-detail message. The draft stays in the
    // composer so the note can be retried; only the list row disappears.
    rejectPost(
      new MockApiError({
        status: 403,
        title: 'Forbidden',
        detail: 'You cannot comment on this record.',
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('You cannot comment on this record.');
    await waitFor(() => {
      const rows = [...container.querySelectorAll('article')];
      expect(rows.some((node) => node.textContent?.includes('In-flight note'))).toBe(false);
    });
  });

  it('offers load-more exactly while a full page returns a cursor', async () => {
    const second = comment({ id: 'c-2', body: 'Second note' });
    vi.mocked(listTrackerRecordComments)
      .mockReset()
      .mockResolvedValueOnce(page([comment()], 'tok'))
      .mockResolvedValue(page([second]));

    renderSection();
    expect(await screen.findByText('First note')).toBeTruthy();
    expect(listCalls()).toHaveLength(1);
    const loadMore = screen.getByText('Load more comments');
    expect(loadMore.tagName).toBe('BUTTON');

    fireEvent.click(loadMore);
    await screen.findByText('Second note');
    expect(listCalls()).toHaveLength(2);
    expect(vi.mocked(listTrackerRecordComments).mock.calls[1]?.[2]).toMatchObject({
      cursor: 'tok',
      limit: 100,
    });
    // The last page carried no cursor, so the affordance retires.
    await waitFor(() => expect(screen.queryByText('Load more comments')).toBeNull());
  });
});

function listCalls() {
  return vi.mocked(listTrackerRecordComments).mock.calls;
}
