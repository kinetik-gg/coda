import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { SaveStatus, Screenplay } from './types';

export function useScreenplayAutosave(screenplayId: string, screenplay?: Screenplay) {
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const initializedId = useRef<string | undefined>(undefined);
  const draftRef = useRef('');
  const savedRef = useRef('');
  const versionRef = useRef(1);
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const installScreenplay = useCallback((next: Screenplay) => {
    initializedId.current = next.id;
    draftRef.current = next.sourceText;
    savedRef.current = next.sourceText;
    versionRef.current = next.version;
    setDraftState(next.sourceText);
    setStatus('saved');
  }, []);

  useEffect(() => {
    if (screenplay && initializedId.current !== screenplay.id) installScreenplay(screenplay);
  }, [installScreenplay, screenplay]);

  const persist = useCallback(
    function persistDraft(): Promise<boolean> {
      if (draftRef.current === savedRef.current) {
        setStatus('saved');
        return Promise.resolve(true);
      }
      if (!navigator.onLine) {
        setStatus('offline');
        return Promise.resolve(false);
      }
      if (inFlightRef.current) {
        return inFlightRef.current.then((saved) => {
          if (!saved || draftRef.current === savedRef.current) return saved;
          return persistDraft();
        });
      }
      const sentSource = draftRef.current;
      setStatus('saving');
      const request = (async () => {
        try {
          const updated = await api<Screenplay>(`/api/v1/screenplays/${screenplayId}`, {
            method: 'PATCH',
            body: JSON.stringify({ sourceText: sentSource, version: versionRef.current }),
          });
          savedRef.current = sentSource;
          versionRef.current = updated.version;
          queryClient.setQueryData<Screenplay>(['screenplay', screenplayId], updated);
          setStatus(draftRef.current === sentSource ? 'saved' : 'unsaved');
          return true;
        } catch (error) {
          setStatus(
            error instanceof ApiError && error.problem.status === 409 ? 'conflict' : 'failed',
          );
          return false;
        } finally {
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = request;
      return request.then((saved) => {
        if (!saved || draftRef.current === savedRef.current) return saved;
        return persistDraft();
      });
    },
    [queryClient, screenplayId],
  );

  useEffect(() => {
    if (status !== 'unsaved') return;
    const timer = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, persist, status]);

  useEffect(() => {
    const retry = () => {
      if (draftRef.current !== savedRef.current) void persist();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [persist]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (draftRef.current === savedRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
    setStatus(value === savedRef.current ? 'saved' : navigator.onLine ? 'unsaved' : 'offline');
  }, []);

  const reloadLatest = useCallback(async () => {
    const latest = await api<Screenplay>(`/api/v1/screenplays/${screenplayId}`);
    queryClient.setQueryData(['screenplay', screenplayId], latest);
    installScreenplay(latest);
  }, [installScreenplay, queryClient, screenplayId]);

  return { draft, status, setDraft, persist, reloadLatest };
}
