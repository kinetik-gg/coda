import { getKeybindingLabel } from '../keybindings';
import { isCommandEnabled, isCommandVisible, type ApplicationCommand } from './application-command';
import type { PaletteMode } from './common-commands';
import type { LibraryObjectCapability, LibraryTarget } from './library-target';

/** One selectable palette row. Commands and library objects flatten to the same shape. */
export interface PaletteRow {
  id: string;
  /** Group heading the row renders under. */
  section: string;
  label: string;
  /** Muted secondary text — a filename, or the command's keyword trail. */
  detail?: string;
  /** Rendered shortcut chord, resolved through the keybindings layer. */
  shortcut?: string;
  /** The row is the current choice within its set (active theme, current route). */
  current?: boolean;
  disabled?: boolean;
  run: () => void;
}

const OBJECT_MODE_CAPABILITY: Record<Exclude<PaletteMode, 'all'>, LibraryObjectCapability> = {
  open: 'openObject',
  rename: 'renameObject',
  export: 'exportObject',
  trash: 'trashObject',
};

/** Short heading for the chooser's single group. */
const OBJECT_MODE_VERB: Record<Exclude<PaletteMode, 'all'>, string> = {
  open: 'Open',
  rename: 'Rename',
  export: 'Export',
  trash: 'Move to trash',
};

const OBJECT_MODE_TITLE: Record<Exclude<PaletteMode, 'all'>, (singular: string) => string> = {
  open: (singular) => `Open a ${singular}`,
  rename: (singular) => `Rename a ${singular}`,
  export: (singular) => `Export a ${singular}`,
  trash: (singular) => `Move a ${singular} to trash`,
};

const OBJECT_MODE_ROW: Record<Exclude<PaletteMode, 'all'>, (title: string) => string> = {
  open: (title) => `Open “${title}”`,
  rename: (title) => `Rename “${title}”`,
  export: (title) => `Export “${title}”`,
  trash: (title) => `Move “${title}” to trash`,
};

/** The palette's accessible name and input placeholder for the mode it was opened in. */
export function palettePrompt(
  mode: PaletteMode,
  library: LibraryTarget | undefined,
): { title: string; placeholder: string } {
  if (mode === 'all') {
    return {
      title: 'Command palette',
      placeholder: library ? `Search commands and ${library.noun}…` : 'Search commands…',
    };
  }
  return {
    title: OBJECT_MODE_TITLE[mode](library?.singular ?? 'document'),
    placeholder: `Search ${library?.noun ?? 'documents'}…`,
  };
}

function objectRows(mode: PaletteMode, library: LibraryTarget | undefined): PaletteRow[] {
  if (!library) return [];
  const capability = mode === 'all' ? 'openObject' : OBJECT_MODE_CAPABILITY[mode];
  const handler = library[capability];
  if (!handler) return [];
  const section = mode === 'all' ? titleCase(library.noun) : OBJECT_MODE_VERB[mode];
  return library.objects.map((object) => ({
    id: `object-${capability}-${object.id}`,
    section,
    label: mode === 'all' ? object.title : OBJECT_MODE_ROW[mode](object.title),
    ...(object.subtitle ? { detail: object.subtitle } : {}),
    run: () => handler(object.id),
  }));
}

function commandRows<Ctx>(commands: readonly ApplicationCommand<Ctx>[], ctx: Ctx): PaletteRow[] {
  return commands
    .filter((command) => isCommandVisible(command, ctx))
    .map((command) => {
      const shortcut = command.keybinding ? getKeybindingLabel(command.keybinding) : undefined;
      const enabled = isCommandEnabled(command, ctx);
      const detail =
        (!enabled ? command.disabledReason?.(ctx) : undefined) ?? command.keywords?.join(' · ');
      return {
        id: `command-${command.id}`,
        section: command.section,
        label: command.label(ctx),
        ...(detail ? { detail } : {}),
        ...(shortcut ? { shortcut } : {}),
        ...(command.current?.(ctx) ? { current: true } : {}),
        disabled: !enabled,
        run: () => command.run(ctx),
      };
    });
}

/**
 * The palette's rows for a mode. In `all` mode every visible command is offered alongside the
 * mounted surface's objects, so the palette is a superset of the menu bar rather than a second,
 * smaller command surface.
 */
export function buildPaletteRows<Ctx>(
  mode: PaletteMode,
  commands: readonly ApplicationCommand<Ctx>[],
  ctx: Ctx,
  library?: LibraryTarget,
): PaletteRow[] {
  if (mode !== 'all') return objectRows(mode, library);
  return [...commandRows(commands, ctx), ...objectRows('all', library)];
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Every whitespace-separated term must appear somewhere in the row — forgiving, and predictable. */
export function filterPaletteRows(rows: readonly PaletteRow[], query: string): PaletteRow[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = `${row.section} ${row.label} ${row.detail ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Rows grouped by section, preserving first-seen section order. */
export function groupPaletteRows(
  rows: readonly PaletteRow[],
): { section: string; rows: PaletteRow[] }[] {
  const groups: { section: string; rows: PaletteRow[] }[] = [];
  for (const row of rows) {
    const group = groups.find((candidate) => candidate.section === row.section);
    if (group) group.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  return groups;
}

/** Moves the active index over enabled rows only, clamping at both ends. */
export function nextEnabledIndex(rows: readonly PaletteRow[], from: number, step: 1 | -1): number {
  for (let index = from + step; index >= 0 && index < rows.length; index += step) {
    if (!rows[index]?.disabled) return index;
  }
  return from;
}

/** The first row a freshly filtered list should highlight, or -1 when none can be run. */
export function firstEnabledIndex(rows: readonly PaletteRow[]): number {
  return rows.findIndex((row) => !row.disabled);
}
