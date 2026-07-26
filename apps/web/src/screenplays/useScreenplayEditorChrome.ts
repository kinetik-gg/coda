import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { screenplayCanEdit, screenplayCanManage, type Screenplay } from './types';
import type { useScreenplayAutosave } from './useScreenplayAutosave';

/**
 * Permission-aware chrome for the editor: the caller's edit/manage capability, the rename and
 * move-to-trash dialog state, and the document actions those affordances issue (rename PATCH,
 * trash, and navigation to the management/share surface). Kept out of the editor component so the
 * view stays within the maintainability budget. The rename mutation reuses the autosave version so
 * the optimistic-concurrency check stays accurate after an out-of-band title change.
 */
export function useScreenplayEditorChrome({
  screenplayId,
  screenplay,
  autosave,
  onTrashed,
}: {
  screenplayId: string;
  screenplay: Screenplay;
  autosave: ReturnType<typeof useScreenplayAutosave>;
  onTrashed: () => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = screenplayCanEdit(screenplay);
  const canManage = screenplayCanManage(screenplay);
  const [renameOpen, setRenameOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  const rename = useMutation({
    mutationFn: async (title: string) => {
      await autosave.persist();
      return api<Screenplay>(`/api/v1/screenplays/${screenplayId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, version: autosave.getCurrentVersion() }),
      });
    },
    onSuccess: (updated) => {
      autosave.syncServerVersion(updated.version);
      queryClient.setQueryData<Screenplay>(['screenplay', screenplayId], (current) =>
        current ? { ...current, title: updated.title, version: updated.version } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      setRenameOpen(false);
    },
  });
  const trash = useMutation({
    mutationFn: () => api(`/api/v1/screenplays/${screenplayId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-screenplays'] });
      onTrashed();
    },
  });
  const goToManagement = useCallback(() => {
    void autosave.persist().finally(() => {
      window.location.assign(`/screenplays/${screenplayId}/manage`);
    });
  }, [autosave, screenplayId]);

  return {
    canEdit,
    canManage,
    renameOpen,
    trashOpen,
    openRename: () => setRenameOpen(true),
    openTrash: () => setTrashOpen(true),
    closeRename: () => setRenameOpen(false),
    closeTrash: () => setTrashOpen(false),
    rename,
    trash,
    goToManagement,
  };
}

export type ScreenplayEditorChrome = ReturnType<typeof useScreenplayEditorChrome>;
