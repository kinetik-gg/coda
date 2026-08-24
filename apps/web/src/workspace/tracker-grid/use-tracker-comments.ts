import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import {
  ApiError,
  createTrackerRecordComment,
  deleteTrackerRecordComment,
  listTrackerRecordComments,
  updateTrackerRecordComment,
} from '../../api';
import type { TrackerComment, TrackerCurrentUser } from '../../trackers/types';
import type { CursorPage } from '../../api';

/** One inspector page of record comments; a full page is what makes "Load more" appear. */
export const COMMENT_PAGE_SIZE = 100;

/** The invalidation vocabulary shared with the workspace screen's realtime `comments` events. */
export function trackerCommentsQueryKey(trackerId: string): Array<string> {
  return ['tracker-comments', trackerId];
}

/** The inline text for a failed comment action: the API's problem detail when it has one. */
export function commentActionMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return error instanceof Error ? error.message : 'The comment could not be saved.';
}

function appendComment(
  pages: InfiniteData<CursorPage<TrackerComment>> | undefined,
  comment: TrackerComment,
): InfiniteData<CursorPage<TrackerComment>> | undefined {
  if (!pages) return pages;
  const last = pages.pages.at(-1);
  if (!last) return pages;
  const nextPages = [
    ...pages.pages.slice(0, -1),
    { ...last, items: [...last.items, comment] },
  ];
  return { ...pages, pages: nextPages };
}

/**
 * The tracker inspector's comment vocabulary (#383): one cursor-paged oldest-first query per
 * selected record, an optimistic append on own posts that every settle reconciles by refetch,
 * and author-guarded edit/delete against the record-comment routes. Permission gaps are not
 * guessed client-side — a rejected write surfaces its API problem detail as an inline error.
 */
export function useTrackerComments({
  trackerId,
  recordId,
  currentUser,
}: {
  trackerId: string;
  recordId: string;
  currentUser: TrackerCurrentUser;
}) {
  const queryClient = useQueryClient();
  const queryKey = [...trackerCommentsQueryKey(trackerId), recordId];
  const comments = useInfiniteQuery({
    queryKey,
    queryFn: ({ signal, pageParam }) =>
      listTrackerRecordComments(
        trackerId,
        recordId,
        { cursor: pageParam || undefined, limit: COMMENT_PAGE_SIZE },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: trackerCommentsQueryKey(trackerId) });
  };

  const post = useMutation({
    mutationFn: (body: string) => createTrackerRecordComment({ trackerId, recordId, body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InfiniteData<CursorPage<TrackerComment>>>(queryKey);
      const optimistic: TrackerComment = {
        id: `optimistic-${Date.now()}`,
        recordId,
        authorId: currentUser.id,
        body,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editedAt: null,
        author: { id: currentUser.id, displayName: currentUser.displayName },
      };
      queryClient.setQueryData<InfiniteData<CursorPage<TrackerComment>>>(
        queryKey,
        (pages) => appendComment(pages, optimistic),
      );
      return { previous };
    },
    onError: (_error, _body, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSettled: () => {
      void invalidate();
    },
  });

  const edit = useMutation({
    mutationFn: ({ comment, body }: { comment: TrackerComment; body: string }) =>
      updateTrackerRecordComment({
        trackerId,
        recordId,
        commentId: comment.id,
        body,
        version: comment.version,
      }),
    onSettled: () => {
      void invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (comment: TrackerComment) =>
      deleteTrackerRecordComment({ trackerId, recordId, commentId: comment.id }),
    onSettled: () => {
      void invalidate();
    },
  });

  return {
    items: comments.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: comments.isLoading,
    error: comments.error,
    hasNextPage: comments.hasNextPage,
    isFetchingNextPage: comments.isFetchingNextPage,
    fetchNextPage: () => void comments.fetchNextPage(),
    refetch: () => void comments.refetch(),
    post,
    edit,
    remove,
  };
}
