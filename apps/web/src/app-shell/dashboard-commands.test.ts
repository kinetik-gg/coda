import { describe, expect, it, vi } from 'vitest';
import { themes } from '../themes';
import {
  buildPaletteRows,
  filterPaletteRows,
  firstEnabledIndex,
  groupPaletteRows,
  nextEnabledIndex,
  palettePrompt,
  type PaletteRow,
} from './command-palette-model';
import {
  dashboardCommand,
  dashboardCommands,
  isCommandEnabled,
  isCommandVisible,
  type DashboardCommandContext,
} from './dashboard-commands';
import { dashboardMenuBarModel } from './dashboard-menu';
import type { LibraryTarget } from './library-target';
import type { MenuNode } from './menu-bar';

function libraryTarget(overrides: Partial<LibraryTarget> = {}): LibraryTarget {
  return {
    noun: 'screenplays',
    singular: 'screenplay',
    objects: [
      { id: 'a', title: 'Nightfall', subtitle: 'nightfall.fountain' },
      { id: 'b', title: 'Salt Flats', subtitle: 'salt-flats.fountain' },
    ],
    createItem: vi.fn(),
    importItem: vi.fn(),
    focusSearch: vi.fn(),
    refresh: vi.fn(),
    openObject: vi.fn(),
    renameObject: vi.fn(),
    exportObject: vi.fn(),
    trashObject: vi.fn(),
    ...overrides,
  };
}

function context(overrides: Partial<DashboardCommandContext> = {}): DashboardCommandContext {
  return {
    route: '/',
    theme: 'coda-dark',
    isFullscreen: false,
    railCollapsed: false,
    isAdministrator: true,
    library: libraryTarget(),
    navigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleRail: vi.fn(),
    logout: vi.fn(),
    openExternal: vi.fn(),
    openPalette: vi.fn(),
    runLibrary: vi.fn(),
    ...overrides,
  };
}

/** Every action id the menu bar renders, including the ones nested in submenus. */
function menuCommandIds(ctx: DashboardCommandContext): string[] {
  const ids: string[] = [];
  const walk = (nodes: readonly MenuNode<DashboardCommandContext>[]) => {
    for (const node of nodes) {
      if (node.kind === 'action') ids.push(node.id);
      if (node.kind === 'submenu') walk(node.items(ctx));
    }
  };
  for (const menu of dashboardMenuBarModel.menus) walk(menu.items(ctx));
  return ids;
}

describe('dashboard command registry', () => {
  it('renders every registered command in the menu bar, and nothing else', () => {
    const ctx = context();
    const registered = dashboardCommands
      .filter((command) => isCommandVisible(command, ctx))
      .map((command) => command.id);
    expect([...menuCommandIds(ctx)].sort()).toEqual([...registered].sort());
  });

  it('offers every menu command in the palette, so the two surfaces cannot drift', () => {
    const ctx = context();
    const paletteIds = buildPaletteRows('all', ctx).map((row) => row.id);
    for (const id of menuCommandIds(ctx)) expect(paletteIds).toContain(`command-${id}`);
  });

  it('carries the library commands a browse surface owns', () => {
    const ctx = context();
    expect(menuCommandIds(ctx)).toEqual(
      expect.arrayContaining([
        'new-screenplay',
        'import-screenplay',
        'export-screenplay',
        'rename-item',
        'move-to-trash',
        'find-in-library',
        'refresh-library',
        'preferences',
        'command-palette',
        'toggle-rail',
        'docs',
      ]),
    );
    expect(menuCommandIds(ctx).filter((id) => id.startsWith('theme-'))).toHaveLength(themes.length);
  });

  it('hides administration navigation from non-administrators on both surfaces', () => {
    const ctx = context({ isAdministrator: false });
    expect(menuCommandIds(ctx).some((id) => id.startsWith('go-administration-'))).toBe(false);
    expect(
      buildPaletteRows('all', ctx).some((row) => row.id.startsWith('command-go-administration-')),
    ).toBe(false);
    expect(menuCommandIds(context()).some((id) => id.startsWith('go-administration-'))).toBe(true);
  });

  it('disables object commands when the mounted surface cannot service them', () => {
    const empty = context({ library: libraryTarget({ objects: [] }) });
    const none = context({ library: undefined });
    for (const id of ['export-screenplay', 'rename-item', 'move-to-trash']) {
      expect(isCommandEnabled(dashboardCommand(id), context())).toBe(true);
      expect(isCommandEnabled(dashboardCommand(id), empty)).toBe(false);
      expect(isCommandEnabled(dashboardCommand(id), none)).toBe(false);
    }
    expect(isCommandEnabled(dashboardCommand('find-in-library'), none)).toBe(false);
    expect(isCommandEnabled(dashboardCommand('refresh-library'), none)).toBe(false);
    // Creating and importing route to the library first, so they never go dead.
    expect(isCommandEnabled(dashboardCommand('new-screenplay'), none)).toBe(true);
    expect(isCommandEnabled(dashboardCommand('import-screenplay'), none)).toBe(true);
  });

  it('labels commands from the mounted surface and the current shell state', () => {
    expect(dashboardCommand('rename-item').label(context())).toBe('Rename screenplay…');
    expect(dashboardCommand('find-in-library').label(context())).toBe('Find in Screenplays');
    expect(dashboardCommand('refresh-library').label(context({ library: undefined }))).toBe(
      'Refresh Library',
    );
    expect(dashboardCommand('toggle-rail').label(context({ railCollapsed: true }))).toBe(
      'Show Sidebar',
    );
    expect(dashboardCommand('fullscreen').label(context({ isFullscreen: true }))).toBe(
      'Exit Full Screen',
    );
  });

  it('runs commands through the context rather than reaching for globals', () => {
    const ctx = context();
    dashboardCommand('new-screenplay').run(ctx);
    expect(ctx.runLibrary).toHaveBeenCalledWith('createItem');
    dashboardCommand('move-to-trash').run(ctx);
    expect(ctx.openPalette).toHaveBeenCalledWith('trash');
    dashboardCommand('theme-nord').run(ctx);
    expect(ctx.chooseTheme).toHaveBeenCalledWith('nord');
    dashboardCommand('go-library-trash').run(ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/trash');
    dashboardCommand('report-issue').run(ctx);
    expect(ctx.openExternal).toHaveBeenCalledWith('https://github.com/kinetik-gg/coda/issues');
    dashboardCommand('sign-out').run(ctx);
    expect(ctx.logout).toHaveBeenCalledOnce();
  });

  it('rejects an unknown command id rather than rendering an empty menu row', () => {
    expect(() => dashboardCommand('not-a-command')).toThrow(/Unknown dashboard command/u);
  });
});

describe('command palette model', () => {
  it('lists the mounted surface objects alongside the commands', () => {
    const rows = buildPaletteRows('all', context());
    expect(rows.filter((row) => row.section === 'Screenplays').map((row) => row.label)).toEqual([
      'Nightfall',
      'Salt Flats',
    ]);
  });

  it('narrows to a chooser in object modes and addresses the chosen object', () => {
    const ctx = context();
    const rows = buildPaletteRows('rename', ctx);
    expect(rows.every((row) => row.section === 'Rename')).toBe(true);
    expect(rows.map((row) => row.label)).toEqual(['Rename “Nightfall”', 'Rename “Salt Flats”']);
    rows[1]?.run();
    expect(ctx.library?.renameObject).toHaveBeenCalledWith('b');
    buildPaletteRows('trash', ctx)[0]?.run();
    expect(ctx.library?.trashObject).toHaveBeenCalledWith('a');
  });

  it('offers nothing in an object mode the surface does not support', () => {
    const ctx = context({ library: libraryTarget({ exportObject: undefined }) });
    expect(buildPaletteRows('export', ctx)).toEqual([]);
    expect(buildPaletteRows('open', context({ library: undefined }))).toEqual([]);
  });

  it('names the prompt after the mode and the mounted surface', () => {
    expect(palettePrompt('all', libraryTarget())).toEqual({
      title: 'Command palette',
      placeholder: 'Search commands and screenplays…',
    });
    expect(palettePrompt('all', undefined).placeholder).toBe('Search commands…');
    expect(palettePrompt('trash', libraryTarget()).title).toBe('Move a screenplay to trash');
    expect(palettePrompt('rename', libraryTarget()).placeholder).toBe('Search screenplays…');
    expect(palettePrompt('open', undefined)).toEqual({
      title: 'Open a document',
      placeholder: 'Search documents…',
    });
  });

  it('matches every whitespace-separated term against label, section and detail', () => {
    const rows = buildPaletteRows('all', context());
    expect(filterPaletteRows(rows, 'full screen').map((row) => row.id)).toEqual([
      'command-fullscreen',
    ]);
    expect(filterPaletteRows(rows, 'FLATS').map((row) => row.id)).toEqual(['object-openObject-b']);
    expect(filterPaletteRows(rows, 'zzz')).toEqual([]);
    expect(filterPaletteRows(rows, '   ')).toHaveLength(rows.length);
  });

  it('groups rows in first-seen section order', () => {
    const groups = groupPaletteRows(buildPaletteRows('all', context()));
    expect(groups[0]?.section).toBe('File');
    expect(groups.at(-1)?.section).toBe('Screenplays');
    expect(groups.map((group) => group.section)).toContain('Go to Administration');
  });

  it('skips disabled rows when moving the highlight', () => {
    const rows: PaletteRow[] = [
      { id: 'a', section: 'S', label: 'A', run: vi.fn() },
      { id: 'b', section: 'S', label: 'B', disabled: true, run: vi.fn() },
      { id: 'c', section: 'S', label: 'C', run: vi.fn() },
    ];
    expect(nextEnabledIndex(rows, 0, 1)).toBe(2);
    expect(nextEnabledIndex(rows, 2, 1)).toBe(2);
    expect(nextEnabledIndex(rows, 2, -1)).toBe(0);
    expect(nextEnabledIndex(rows, 0, -1)).toBe(0);
    expect(firstEnabledIndex(rows)).toBe(0);
    expect(firstEnabledIndex([rows[1]!])).toBe(-1);
    expect(firstEnabledIndex([])).toBe(-1);
    expect(nextEnabledIndex([rows[1]!], -1, 1)).toBe(-1);
  });
});
