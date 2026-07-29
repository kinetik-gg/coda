import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateScreenplayCommentThread,
  ScreenplayCommentThreadView,
  ScreenplayCommentView,
} from '@coda/contracts';
import { api } from '../api';

export type ScreenplayCommentThreadFilter = 'open' | 'resolved' | 'all';

export function useScreenplayComments(screenplayId: string, status: ScreenplayCommentThreadFilter) {
  const queryClient = useQueryClient();
  const queryKey = ['screenplay-comment-threads', screenplayId] as const;
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const threads = useQuery({
    queryKey: [...queryKey, status],
    queryFn: () =>
      api<ScreenplayCommentThreadView[]>(
        `/api/v1/screenplays/${screenplayId}/comment-threads?status=${status}`,
      ),
  });
  const createThread = useMutation({
    mutationFn: (input: CreateScreenplayCommentThread) =>
      api<ScreenplayCommentThreadView>(`/api/v1/screenplays/${screenplayId}/comment-threads`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
  const reply = useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      api<ScreenplayCommentView>(
        `/api/v1/screenplays/${screenplayId}/comment-threads/${threadId}/comments`,
        { method: 'POST', body: JSON.stringify({ body }) },
      ),
    onSuccess: invalidate,
  });
  const updateComment = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api<ScreenplayCommentView>(`/api/v1/screenplays/${screenplayId}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onSuccess: invalidate,
  });
  const deleteComment = useMutation({
    mutationFn: (commentId: string) =>
      api<ScreenplayCommentView>(`/api/v1/screenplays/${screenplayId}/comments/${commentId}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
  const setResolved = useMutation({
    mutationFn: ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
      api<ScreenplayCommentThreadView>(
        `/api/v1/screenplays/${screenplayId}/comment-threads/${threadId}/resolution`,
        { method: 'PATCH', body: JSON.stringify({ resolved }) },
      ),
    onSuccess: invalidate,
  });

  return {
    threads,
    createThread,
    reply,
    updateComment,
    deleteComment,
    setResolved,
  };
}
