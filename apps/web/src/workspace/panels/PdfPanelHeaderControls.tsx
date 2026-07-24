import { useEffect, useState } from 'react';
import { BookmarkSimpleIcon } from '@phosphor-icons/react/dist/csr/BookmarkSimple';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CircleHalfIcon } from '@phosphor-icons/react/dist/csr/CircleHalf';
import { MagnifyingGlassMinusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassMinus';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import type { WorkspacePanel } from '@coda/contracts';
import { Tooltip } from '../../components/Tooltip';
import type { Project } from './types';
import styles from './PdfPanel.module.css';

export type Pdf = Extract<WorkspacePanel, { type: 'pdf' }>;

export const bookmarkEvent = 'coda:pdf-bookmark';
const darkSchemeQuery = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  const pdfAppearance =
    typeof document !== 'undefined' ? document.documentElement.dataset.pdfAppearance : undefined;
  if (pdfAppearance === 'dark') return true;
  if (pdfAppearance === 'light') return false;
  const selectedTheme =
    typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  if (selectedTheme) return selectedTheme !== 'light';
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(darkSchemeQuery).matches
  );
}

export function useEffectiveDarkView(explicitPreference: boolean | undefined): boolean {
  const [systemPreference, setSystemPreference] = useState(systemPrefersDark);

  useEffect(() => {
    if (explicitPreference !== undefined || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(darkSchemeQuery);
    const updatePreference = () => setSystemPreference(systemPrefersDark());
    setSystemPreference(systemPrefersDark());
    media.addEventListener('change', updatePreference);
    const observer = new MutationObserver(updatePreference);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-pdf-appearance'],
    });
    return () => {
      media.removeEventListener('change', updatePreference);
      observer.disconnect();
    };
  }, [explicitPreference]);

  return explicitPreference ?? systemPreference;
}

export function selectedDocument(project: Project, panel: Pdf) {
  const id = panel.config.sourceDocumentId ?? project.sourceDocuments[0]?.id;
  return project.sourceDocuments.find((entry) => entry.id === id);
}

export function PdfPanelHeaderControls({
  project,
  panel,
  onPanelChange,
  pageCount: suppliedPageCount,
}: {
  project: Project;
  panel: Pdf;
  onPanelChange: (panel: Pdf) => void;
  pageCount?: number | null;
}) {
  const document = selectedDocument(project, panel);
  const pageCount = Math.max(1, suppliedPageCount ?? document?.pageCount ?? 1);
  const page = Math.max(1, Math.min(panel.config.page, pageCount));
  const darkView = useEffectiveDarkView(panel.config.darkView);
  const setZoom = (zoom: number) =>
    onPanelChange({
      ...panel,
      config: { ...panel.config, zoom: Math.max(0.25, Math.min(4, Number(zoom.toFixed(2)))) },
    });
  const navigate = (nextPage: number) =>
    onPanelChange({
      ...panel,
      config: {
        ...panel.config,
        sourceDocumentId: document?.id ?? null,
        page: Math.max(1, Math.min(nextPage, pageCount)),
      },
    });
  return (
    <div className={styles.headerControls} aria-label="PDF navigation">
      <Tooltip content="Set both source range fields to this PDF page">
        <button
          type="button"
          aria-label="Use current page as source range"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(bookmarkEvent, { detail: { panelId: panel.id, page } }),
            )
          }
        >
          <BookmarkSimpleIcon size={12} />
        </button>
      </Tooltip>
      <Tooltip
        content={
          darkView
            ? 'Switch the PDF preview to light document colors'
            : 'Switch the PDF preview to dark document colors'
        }
      >
        <button
          type="button"
          aria-label={darkView ? 'Use light PDF view' : 'Use dark PDF view'}
          aria-pressed={darkView}
          className={darkView ? styles.activeHeaderButton : undefined}
          onClick={() =>
            onPanelChange({
              ...panel,
              config: { ...panel.config, darkView: !darkView },
            })
          }
        >
          <CircleHalfIcon size={12} />
        </button>
      </Tooltip>
      <Tooltip content="Decrease the PDF preview zoom level">
        <button
          type="button"
          aria-label="Zoom PDF out"
          disabled={panel.config.zoom <= 0.25}
          onClick={() => setZoom(panel.config.zoom - 0.1)}
        >
          <MagnifyingGlassMinusIcon size={12} />
        </button>
      </Tooltip>
      <Tooltip content="Reset PDF preview zoom to one hundred percent">
        <button
          type="button"
          className={styles.zoomValue}
          aria-label="Reset PDF zoom"
          onClick={() => setZoom(1)}
        >
          {Math.round(panel.config.zoom * 100)}%
        </button>
      </Tooltip>
      <Tooltip content="Increase the PDF preview zoom level">
        <button
          type="button"
          aria-label="Zoom PDF in"
          disabled={panel.config.zoom >= 4}
          onClick={() => setZoom(panel.config.zoom + 0.1)}
        >
          <MagnifyingGlassPlusIcon size={12} />
        </button>
      </Tooltip>
      <Tooltip content="Go to the previous page in this PDF">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => navigate(page - 1)}
        >
          <CaretLeftIcon size={12} />
        </button>
      </Tooltip>
      <span className={styles.pageNumber}>
        {page} / {pageCount}
      </span>
      <Tooltip content="Go to the next page in this PDF">
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => navigate(page + 1)}
        >
          <CaretRightIcon size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
