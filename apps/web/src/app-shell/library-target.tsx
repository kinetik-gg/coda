import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * A single row a library surface exposes to the shell — enough to list it in the command palette
 * and to name it in a prompt. Deliberately not the domain type: the shell must not learn what a
 * screenplay is in order to open, rename, export, or trash one.
 */
export interface LibraryObject {
  id: string;
  title: string;
  /** Secondary line in the palette (a filename, a slug). */
  subtitle?: string;
}

/**
 * What the currently mounted library surface publishes to the application menu bar.
 *
 * A desktop menu bar's File menu is not owned by the window — it is owned by whichever surface has
 * focus, which is why Finder greys out `Rename` with nothing selected. The dashboard shell works
 * the same way: the shell declares the commands, the mounted surface supplies the handlers, and a
 * command with no handler renders disabled rather than lying about what it can do.
 *
 * Every handler is optional; a surface publishes only what it genuinely supports.
 */
export interface LibraryTarget {
  /** Plural noun for the surface's objects — 'screenplays'. Used in status-bar and palette copy. */
  noun: string;
  /** Singular noun — 'screenplay'. Used in palette prompts ('Rename a screenplay'). */
  singular: string;
  objects: readonly LibraryObject[];
  /** Suppresses the status-bar count while the first page is still loading. */
  loading?: boolean;
  createItem?: () => void;
  importItem?: () => void;
  focusSearch?: () => void;
  refresh?: () => void;
  openObject?: (id: string) => void;
  renameObject?: (id: string) => void;
  exportObject?: (id: string) => void;
  trashObject?: (id: string) => void;
}

/** Capabilities that act on the surface as a whole and take no argument. */
export type LibrarySurfaceCapability = 'createItem' | 'importItem' | 'focusSearch' | 'refresh';

/** Capabilities that act on one published object, addressed by id. */
export type LibraryObjectCapability =
  'openObject' | 'renameObject' | 'exportObject' | 'trashObject';

/** The handler-bearing keys, so a command can ask whether the focused surface supports it. */
export type LibraryCapability = LibrarySurfaceCapability | LibraryObjectCapability;

export type PublishLibraryTarget = (target: LibraryTarget | undefined) => void;

const LibraryTargetContext = createContext<PublishLibraryTarget>(() => undefined);

/**
 * Bridges the mounted surface to the shell that owns the menu bar. `publish` must be referentially
 * stable — a `useState` setter satisfies that without further memoization.
 */
export function LibraryTargetProvider({
  publish,
  children,
}: {
  publish: PublishLibraryTarget;
  children: ReactNode;
}) {
  return <LibraryTargetContext.Provider value={publish}>{children}</LibraryTargetContext.Provider>;
}

/**
 * Publishes the calling surface as the shell's library target for as long as it is mounted.
 *
 * `target` must be memoized by the caller — it is the effect's dependency, so an unmemoized object
 * would republish on every render.
 */
export function usePublishLibraryTarget(target: LibraryTarget): void {
  const publish = useContext(LibraryTargetContext);
  useEffect(() => {
    publish(target);
    return () => publish(undefined);
  }, [publish, target]);
}
