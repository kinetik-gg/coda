import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface HostWindowCapabilities {
  applicationMenu: 'in-app' | 'native';
  windowControls: 'host' | 'reserved-inset';
  titleBarDrag: 'enabled' | 'disabled';
}

export const browserHostWindowCapabilities: HostWindowCapabilities = {
  applicationMenu: 'in-app',
  windowControls: 'host',
  titleBarDrag: 'disabled',
};

interface HostWindowBridge {
  hostWindowCapabilities?: Partial<HostWindowCapabilities>;
}

export interface HostWindowSource {
  codaHost?: HostWindowBridge;
}

function allowed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

/**
 * The sole renderer-side boundary for host chrome. An Electron preload exposes
 * capability values; browser builds expose no bridge and receive browser
 * defaults. Components never inspect a platform or runtime-profile name.
 */
export function resolveHostWindowCapabilities(source: HostWindowSource): HostWindowCapabilities {
  const raw = source.codaHost?.hostWindowCapabilities;
  if (!raw) return browserHostWindowCapabilities;
  return {
    applicationMenu: allowed(raw.applicationMenu, ['in-app', 'native'])
      ? raw.applicationMenu
      : browserHostWindowCapabilities.applicationMenu,
    windowControls: allowed(raw.windowControls, ['host', 'reserved-inset'])
      ? raw.windowControls
      : browserHostWindowCapabilities.windowControls,
    titleBarDrag: allowed(raw.titleBarDrag, ['enabled', 'disabled'])
      ? raw.titleBarDrag
      : browserHostWindowCapabilities.titleBarDrag,
  };
}

const HostWindowCapabilitiesContext = createContext(browserHostWindowCapabilities);

export function HostWindowCapabilitiesProvider({
  capabilities,
  source = window as unknown as HostWindowSource,
  children,
}: {
  capabilities?: HostWindowCapabilities;
  source?: HostWindowSource;
  children: ReactNode;
}) {
  const resolved = useMemo(
    () => capabilities ?? resolveHostWindowCapabilities(source),
    [capabilities, source],
  );
  return (
    <HostWindowCapabilitiesContext.Provider value={resolved}>
      {children}
    </HostWindowCapabilitiesContext.Provider>
  );
}

export function useHostWindowCapabilities(): HostWindowCapabilities {
  return useContext(HostWindowCapabilitiesContext);
}
