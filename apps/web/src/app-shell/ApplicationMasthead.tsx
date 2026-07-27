import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { ShareButton } from '../components/ShareButton';
import { isEditableKeyboardTarget, keybindingMatches } from '../keybindings';
import appStyles from '../App.styles';
import { isCommandEnabled, isCommandVisible, type ApplicationCommand } from './application-command';
import {
  breakdownCommands,
  breakdownMenuBarModel,
  type BreakdownMenuContext,
} from './breakdown-menu';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import type { CommonApplicationCommandContext, PaletteMode } from './common-commands';
import { dashboardCommands, type DashboardCommandContext } from './dashboard-commands';
import { dashboardMenuBarModel } from './dashboard-menu';
import { useHostWindowCapabilities } from './host-window-capabilities';
import { InlineDocumentTitle } from './InlineDocumentTitle';
import type { LibraryTarget } from './library-target';
import { MenuBar, type MenuBarModel } from './menu-bar';
import { setupCommands, setupMenuBarModel, type SetupMenuContext } from './setup-menu';
import {
  screenplayApplicationCommands,
  screenplayMenuBarModel,
  type ScreenplayMenuContext,
} from '../screenplays/screenplay-menu';
import styles from './ApplicationMasthead.module.css';

const OpenSourceCreditsModal = lazy(() =>
  import('./OpenSourceCreditsModal').then((module) => ({
    default: module.OpenSourceCreditsModal,
  })),
);

type WithoutCommonActions<Ctx extends CommonApplicationCommandContext> = Omit<
  Ctx,
  keyof CommonApplicationCommandContext
>;

export type ApplicationMastheadContext =
  | WithoutCommonActions<DashboardCommandContext>
  | WithoutCommonActions<BreakdownMenuContext>
  | WithoutCommonActions<ScreenplayMenuContext>
  | WithoutCommonActions<SetupMenuContext>;

function Breadcrumb({
  root,
  current,
  onBack,
}: {
  root: string;
  current: string;
  onBack: () => void;
}) {
  return (
    <nav className={styles.breadcrumb} aria-label="Application location">
      <button type="button" onClick={onBack}>
        {root}
      </button>
      <CaretRightIcon size={11} aria-hidden="true" />
      <span title={current}>{current}</span>
    </nav>
  );
}

function LeadingIdentity({ context }: { context: ApplicationMastheadContext }) {
  switch (context.surface) {
    case 'dashboard':
    case 'breakdown':
    case 'screenplay':
      return null;
    case 'setup':
      return (
        <Breadcrumb root="Library" current="New breakdown" onBack={() => context.navigate('/')} />
      );
  }
}

function MastheadTitle({ context }: { context: ApplicationMastheadContext }) {
  switch (context.surface) {
    case 'breakdown':
      return (
        <InlineDocumentTitle
          value={context.currentProject?.name ?? 'Breakdown'}
          noun="breakdown"
          canEdit={context.canEditTitle}
          onCommit={context.onRenameTitle}
        />
      );
    case 'screenplay':
      return (
        <InlineDocumentTitle
          value={context.title}
          noun="screenplay"
          canEdit={context.canEdit}
          onCommit={context.onRenameTitle}
        />
      );
    case 'dashboard':
    case 'setup':
      return null;
  }
}

function MastheadTrailing({
  context,
  onOpenPalette,
}: {
  context: ApplicationMastheadContext;
  onOpenPalette: () => void;
}) {
  switch (context.surface) {
    case 'dashboard':
      return <CommandPaletteTrigger onOpen={onOpenPalette} />;
    case 'breakdown':
      return (
        <>
          {context.canManage && <ShareButton onClick={context.openShare} />}
          <CommandPaletteTrigger onOpen={onOpenPalette} />
        </>
      );
    case 'screenplay':
      return (
        <>
          {context.canManage && <ShareButton onClick={context.openShare} />}
          <CommandPaletteTrigger onOpen={onOpenPalette} />
        </>
      );
    case 'setup':
      return <CommandPaletteTrigger onOpen={onOpenPalette} />;
  }
}

function useApplicationShortcuts<Ctx>(
  commands: readonly ApplicationCommand<Ctx>[],
  context: Ctx,
  paletteOpen: boolean,
  allShortcuts: boolean,
) {
  useEffect(() => {
    if (paletteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editable = isEditableKeyboardTarget(event.target);
      for (const command of commands) {
        if (!command.keybinding || !keybindingMatches(command.keybinding, event)) continue;
        if (!allShortcuts && command.id !== 'command-palette') continue;
        if (editable && command.id !== 'command-palette') return;
        if (!isCommandVisible(command, context) || !isCommandEnabled(command, context)) return;
        event.preventDefault();
        command.run(context);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allShortcuts, commands, context, paletteOpen]);
}

function ResolvedMasthead<Ctx extends CommonApplicationCommandContext>({
  rawContext,
  context,
  model,
  commands,
  paletteMode,
  library,
  allShortcuts,
  globalActions,
  onOpenPalette,
  onClosePalette,
}: {
  rawContext: ApplicationMastheadContext;
  context: Ctx;
  model: MenuBarModel<Ctx>;
  commands: readonly ApplicationCommand<Ctx>[];
  paletteMode?: PaletteMode;
  library?: LibraryTarget;
  allShortcuts: boolean;
  globalActions?: boolean;
  onOpenPalette: () => void;
  onClosePalette: () => void;
}) {
  const host = useHostWindowCapabilities();
  useApplicationShortcuts(commands, context, paletteMode !== undefined, allShortcuts);
  return (
    <div
      className={styles.host}
      data-application-menu={host.applicationMenu}
      data-window-controls={host.windowControls}
      data-title-bar-drag={host.titleBarDrag}
    >
      <MenuBar
        model={model}
        context={context}
        globalActions={globalActions}
        renderMenus={host.applicationMenu === 'in-app'}
        className={`${appStyles.masthead} ${styles.masthead}`}
        popupClassName={styles.menuPopup}
        leading={
          <>
            <span className={styles.windowControlsInset} aria-hidden="true" />
            <LeadingIdentity context={rawContext} />
          </>
        }
        center={
          rawContext.surface === 'breakdown' || rawContext.surface === 'screenplay' ? (
            <MastheadTitle context={rawContext} />
          ) : undefined
        }
        centerClassName={styles.titleRegion}
        trailing={<MastheadTrailing context={rawContext} onOpenPalette={onOpenPalette} />}
      />
      {paletteMode && (
        <CommandPalette
          mode={paletteMode}
          commands={commands}
          context={context}
          library={library}
          onClose={onClosePalette}
        />
      )}
    </div>
  );
}

/**
 * The sole application masthead. Its discriminated surface context resolves
 * the menu model, command registry, palette rows, identity, and affordances;
 * callers no longer compose a bespoke wrapper around `MenuBar`.
 */
export function ApplicationMasthead({ context }: { context: ApplicationMastheadContext }) {
  const [paletteMode, setPaletteMode] = useState<PaletteMode>();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const creditsTrigger = useRef<HTMLElement>(null);
  const closePalette = useCallback(() => setPaletteMode(undefined), []);
  const common: CommonApplicationCommandContext = {
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    openCredits: () => {
      const menu = document.activeElement?.closest<HTMLElement>('[role="menu"]');
      creditsTrigger.current =
        Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]')).find(
          (candidate) => candidate.getAttribute('aria-controls') === menu?.id,
        ) ?? null;
      setCreditsOpen(true);
    },
    openPalette: setPaletteMode,
  };
  const commonProps = {
    rawContext: context,
    paletteMode,
    onOpenPalette: () => setPaletteMode('all'),
    onClosePalette: closePalette,
  };

  let masthead;
  switch (context.surface) {
    case 'dashboard': {
      const resolved: DashboardCommandContext = { ...context, ...common };
      masthead = (
        <ResolvedMasthead
          {...commonProps}
          context={resolved}
          model={dashboardMenuBarModel}
          commands={dashboardCommands}
          library={resolved.library}
          allShortcuts
        />
      );
      break;
    }
    case 'breakdown': {
      const resolved: BreakdownMenuContext = { ...context, ...common };
      const library: LibraryTarget = {
        noun: 'breakdowns',
        singular: 'breakdown',
        objects: (context.projects ?? []).map((project) => ({
          id: project.id,
          title: project.name,
        })),
        openObject: (id) => context.navigate(`/breakdowns/${id}`),
      };
      masthead = (
        <ResolvedMasthead
          {...commonProps}
          context={resolved}
          model={breakdownMenuBarModel}
          commands={breakdownCommands}
          library={library}
          allShortcuts={false}
          globalActions
        />
      );
      break;
    }
    case 'screenplay': {
      const resolved: ScreenplayMenuContext = { ...context, ...common };
      masthead = (
        <ResolvedMasthead
          {...commonProps}
          context={resolved}
          model={screenplayMenuBarModel}
          commands={screenplayApplicationCommands}
          allShortcuts={false}
        />
      );
      break;
    }
    case 'setup': {
      const resolved: SetupMenuContext = { ...context, ...common };
      masthead = (
        <ResolvedMasthead
          {...commonProps}
          context={resolved}
          model={setupMenuBarModel}
          commands={setupCommands}
          allShortcuts
        />
      );
      break;
    }
  }

  return (
    <>
      {masthead}
      {creditsOpen && (
        <Suspense fallback={null}>
          <OpenSourceCreditsModal
            restoreFocus={creditsTrigger}
            onClose={() => setCreditsOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
