import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import {
  buildScreenplayPreview,
  type ScreenplayLayoutLine,
  type ScreenplayPreviewInlineStyle,
  type ScreenplayPreviewModel,
  type ScreenplayPreviewPage,
  type ScreenplaySceneOutlineItem,
  type ScreenplaySourceSelection,
} from './screenplay-preview-model';
import {
  screenplayPaper,
  type ScreenplayPaperSize,
  type ScreenplayPaperSpecification,
} from './screenplay-paper';
import styles from './ScreenplayPreview.module.css';

export interface ScreenplayPreviewProps {
  source: string;
  paperSize?: ScreenplayPaperSize;
  model?: ScreenplayPreviewModel;
  activeSourceOffset?: number;
  activeSourceSelection?: ScreenplaySourceSelection;
  onSourceOffsetChange?: (sourceOffset: number) => void;
  onSourceSelectionChange?: (selection: ScreenplaySourceSelection) => void;
  onOutlineChange?: (scenes: readonly ScreenplaySceneOutlineItem[]) => void;
  zoom?: ScreenplayPreviewZoom;
  pageView?: ScreenplayPreviewPageView;
  className?: string;
}

export const SCREENPLAY_PREVIEW_ZOOM_LEVELS = [100, 125, 150, 200] as const;

export type ScreenplayPreviewZoomLevel = (typeof SCREENPLAY_PREVIEW_ZOOM_LEVELS)[number];
export type ScreenplayPreviewZoom = 'fit-width' | 'fit-page' | ScreenplayPreviewZoomLevel;
export type ScreenplayPreviewPageView = 'single-page' | 'two-page';

export function ScreenplayPreview({
  source,
  paperSize = 'letter',
  model: providedModel,
  activeSourceOffset,
  activeSourceSelection,
  onSourceOffsetChange,
  onSourceSelectionChange,
  onOutlineChange,
  zoom = 'fit-width',
  pageView = 'single-page',
  className,
}: ScreenplayPreviewProps) {
  const model = useMemo(
    () => providedModel ?? buildScreenplayPreview(source, { paperSize }),
    [paperSize, providedModel, source],
  );
  const paper = screenplayPaper(model.paperSize);
  const previewRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReportedOffset = useRef<number | undefined>(undefined);
  const editorSyncInProgress = useRef(false);
  const pointerSelectionReported = useRef(false);
  const lines = useMemo(() => model.pages.flatMap((page) => page.lines), [model.pages]);
  const linesById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const activeCaretLineId = useMemo(() => {
    if (!activeSourceSelection || activeSourceSelection.from !== activeSourceSelection.to) {
      return undefined;
    }
    return findLayoutLineAtOffset(lines, activeSourceSelection.head)?.id;
  }, [activeSourceSelection, lines]);
  const measuredPageWidth = usePreviewPageWidth(previewRef, paper, zoom, pageView);
  const previewStyle = useMemo(
    () =>
      ({
        ...(measuredPageWidth === undefined
          ? undefined
          : { '--screenplay-preview-page-width': `${String(measuredPageWidth)}px` }),
        '--screenplay-preview-preset-width': `${String(
          paper.widthPoints * (typeof zoom === 'number' ? zoom / 100 : 1),
        )}px`,
      }) as CSSProperties,
    [measuredPageWidth, paper.widthPoints, zoom],
  );

  useEffect(() => onOutlineChange?.(model.scenes), [model.scenes, onOutlineChange]);

  useEffect(() => {
    const sourceOffset = activeSourceSelection?.head ?? activeSourceOffset;
    const scroller = scrollRef.current;
    if (sourceOffset === undefined || !scroller) return;
    const line = findLayoutLineAtOffset(lines, sourceOffset);
    const target = line ? findLineElement(scroller, line.id) : undefined;
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    editorSyncInProgress.current = true;
    lastReportedOffset.current = sourceOffset;
    scroller.scrollTop = Math.max(
      0,
      scroller.scrollTop +
        targetRect.top -
        scrollerRect.top -
        (scroller.clientHeight - targetRect.height) / 2,
    );
  }, [activeSourceOffset, activeSourceSelection?.head, lines]);

  const reportSelection = (selection: ScreenplaySourceSelection) => {
    onSourceSelectionChange?.(selection);
    onSourceOffsetChange?.(selection.head);
  };

  const reportVisibleLine = (event: UIEvent<HTMLDivElement>) => {
    if (!onSourceOffsetChange || editorSyncInProgress.current) return;
    const viewportTop = event.currentTarget.getBoundingClientRect().top + 48;
    const renderedLines = Array.from(
      event.currentTarget.querySelectorAll<SVGTextElement>('[data-layout-line]'),
    );
    const visible =
      [...renderedLines]
        .reverse()
        .find((line) => line.getBoundingClientRect().top <= viewportTop) ?? renderedLines[0];
    const offset = visible ? Number(visible.dataset.sourceStart) : undefined;
    if (offset === undefined || offset === lastReportedOffset.current) return;
    lastReportedOffset.current = offset;
    onSourceOffsetChange(offset);
  };

  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    const selection = sourceSelectionFromPreview(event.currentTarget, linesById);
    if (!selection) return;
    pointerSelectionReported.current = true;
    reportSelection(selection);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (pointerSelectionReported.current) {
      pointerSelectionReported.current = false;
      return;
    }
    const lineElement = elementForNode(event.target as Node)?.closest<SVGTextElement>(
      '[data-layout-line]',
    );
    const line = lineElement?.dataset.layoutLine
      ? linesById.get(lineElement.dataset.layoutLine)
      : undefined;
    if (line) reportSelection(directionalSelection(line.sourceStart, line.sourceStart));
  };

  return (
    <section
      ref={previewRef}
      className={[styles.preview, className].filter(Boolean).join(' ')}
      aria-label="Screenplay preview"
      data-paper-size={model.paperSize}
      data-preview-zoom={String(zoom)}
      data-page-view={pageView}
      style={previewStyle}
    >
      <div
        ref={scrollRef}
        className={styles.pages}
        tabIndex={0}
        onKeyDown={() => {
          editorSyncInProgress.current = false;
        }}
        onPointerDown={() => {
          editorSyncInProgress.current = false;
          pointerSelectionReported.current = false;
        }}
        onTouchStart={() => {
          editorSyncInProgress.current = false;
        }}
        onWheel={() => {
          editorSyncInProgress.current = false;
        }}
        onScroll={reportVisibleLine}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      >
        {model.pages.map((page) => {
          const pageSelection = page.lines.some((line) =>
            selectionTouchesLine(line, activeSourceSelection, activeCaretLineId),
          )
            ? activeSourceSelection
            : undefined;
          return (
            <PreviewPage
              key={page.id}
              page={page}
              paper={paper}
              activeSelection={pageSelection}
              activeCaretLineId={pageSelection ? activeCaretLineId : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

function usePreviewPageWidth(
  previewRef: React.RefObject<HTMLElement | null>,
  paper: ScreenplayPaperSpecification,
  zoom: ScreenplayPreviewZoom,
  pageView: ScreenplayPreviewPageView,
) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      setViewport((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(preview);
    return () => observer.disconnect();
  }, [previewRef]);

  if (typeof zoom === 'number') return paper.widthPoints * (zoom / 100);
  if (viewport.width <= 0 || viewport.height <= 0) return undefined;
  return calculateScreenplayPreviewPageWidth(viewport, paper, zoom, pageView);
}

export function calculateScreenplayPreviewPageWidth(
  viewport: Readonly<{ width: number; height: number }>,
  paper: Pick<ScreenplayPaperSpecification, 'widthPoints' | 'heightPoints'>,
  zoom: Exclude<ScreenplayPreviewZoom, ScreenplayPreviewZoomLevel>,
  pageView: ScreenplayPreviewPageView,
) {
  const inlinePadding = Math.min(28, Math.max(10, viewport.width * 0.03));
  const columns = pageView === 'two-page' ? 2 : 1;
  const gaps = columns - 1;
  const availableWidth = Math.max(1, (viewport.width - inlinePadding * 2 - gaps * 18) / columns);
  if (zoom === 'fit-width') return availableWidth;
  const fitHeightWidth = Math.max(1, viewport.height - 68) * (paper.widthPoints / paper.heightPoints);
  return Math.min(availableWidth, fitHeightWidth);
}

const PreviewPage = memo(function PreviewPage({
  page,
  paper,
  activeSelection,
  activeCaretLineId,
}: {
  page: ScreenplayPreviewPage;
  paper: ScreenplayPaperSpecification;
  activeSelection?: ScreenplaySourceSelection;
  activeCaretLineId?: string;
}) {
  const pageStyle = {
    '--screenplay-page-aspect': `${String(paper.widthPoints)} / ${String(paper.heightPoints)}`,
  } as CSSProperties;
  return (
    <article
      className={`${styles.page} ${page.pageNumber === null ? styles.titlePage : ''}`}
      style={pageStyle}
      aria-label={page.pageNumber === null ? 'Title page' : `Page ${String(page.pageNumber)}`}
    >
      <svg
        className={styles.pageCanvas}
        viewBox={`0 0 ${String(paper.widthPoints)} ${String(paper.heightPoints)}`}
        role="document"
        aria-label={
          page.pageNumber === null
            ? 'Title page content'
            : `Page ${String(page.pageNumber)} content`
        }
      >
        {page.lines.length === 0 ? (
          <text
            className={styles.empty}
            x={paper.widthPoints / 2}
            y={paper.heightPoints / 2}
            textAnchor="middle"
          >
            Start writing to preview your screenplay.
          </text>
        ) : (
          page.lines.map((line) => {
            const lineSelection = selectionTouchesLine(
              line,
              activeSelection,
              activeCaretLineId,
            )
              ? activeSelection
              : undefined;
            return (
              <LayoutLine
                key={line.id}
                line={line}
                paper={paper}
                activeSelection={lineSelection}
                activeCaretLineId={lineSelection ? activeCaretLineId : undefined}
              />
            );
          })
        )}
        {page.pageNumber !== null && (page.pageNumber > 1 || page.printedPageNumber) && (
          <text
            className={styles.pageNumber}
            x={paper.pageNumberRight}
            y={paper.heightPoints - paper.pageNumberBaseline}
            textAnchor="end"
          >
            {`${page.printedPageNumber ?? String(page.pageNumber)}.`}
          </text>
        )}
      </svg>
    </article>
  );
});

const LayoutLine = memo(function LayoutLine({
  line,
  paper,
  activeSelection,
  activeCaretLineId,
}: {
  line: ScreenplayLayoutLine;
  paper: ScreenplayPaperSpecification;
  activeSelection?: ScreenplaySourceSelection;
  activeCaretLineId?: string;
}) {
  const selection = previewSelection(line.text, line.textSourceOffsets, activeSelection);
  const visibleSelection =
    selection?.from === selection?.to && activeCaretLineId !== line.id ? undefined : selection;
  const originX = alignedTextOrigin(line, paper.fontAdvance);
  const baseline = paper.heightPoints - line.baselineY;
  const sceneNumber = line.kind === 'scene-heading' ? line.sceneNumber : undefined;
  return (
    <g className={styles.layoutGroup} data-preview-block={line.blockId}>
      {visibleSelection && visibleSelection.from !== visibleSelection.to && (
        <rect
          className={styles.sourceHighlight}
          x={originX + visibleSelection.from * paper.fontAdvance}
          y={baseline - paper.fontSize * 0.78125}
          width={(visibleSelection.to - visibleSelection.from) * paper.fontAdvance}
          height={paper.lineHeight}
        />
      )}
      {visibleSelection && visibleSelection.from === visibleSelection.to && (
        <line
          className={styles.previewCaret}
          x1={originX + visibleSelection.from * paper.fontAdvance}
          x2={originX + visibleSelection.from * paper.fontAdvance}
          y1={baseline - paper.fontSize * 0.78125}
          y2={baseline + paper.fontSize * 0.21875}
        />
      )}
      {sceneNumber && (
        <>
          <text
            className={styles.sceneNumber}
            x={paper.sceneNumberLeft}
            y={baseline}
            textAnchor="start"
          >
            {sceneNumber}
          </text>
          <text
            className={styles.sceneNumber}
            x={paper.sceneNumberRight}
            y={baseline}
            textAnchor="end"
          >
            {sceneNumber}
          </text>
        </>
      )}
      <text
        className={styles.layoutLine}
        data-layout-line={line.id}
        data-preview-block={line.blockId}
        data-source-start={line.sourceStart}
        data-source-end={line.sourceEnd}
        data-line-kind={line.kind}
        data-dual-column={line.dualColumn}
        x={textAnchorX(line)}
        y={baseline}
        textAnchor={svgTextAnchor(line.align)}
        fontWeight={line.font === 'bold' || line.font === 'bold-italic' ? 700 : 400}
        fontStyle={line.font === 'italic' || line.font === 'bold-italic' ? 'italic' : 'normal'}
        xmlSpace="preserve"
      >
        {renderStyledText(line.text, line.inlineStyles)}
      </text>
      {line.revisionMarker && (
        <text
          className={styles.revisionMark}
          x={paper.revisionMarkLeft}
          y={baseline}
          textAnchor="start"
        >
          {line.revisionMarker}
        </text>
      )}
    </g>
  );
});

function selectionTouchesLine(
  line: ScreenplayLayoutLine,
  selection: ScreenplaySourceSelection | undefined,
  caretLineId: string | undefined,
): boolean {
  if (!selection) return false;
  if (selection.from === selection.to) return line.id === caretLineId;
  return selection.from <= line.sourceEnd && selection.to >= line.sourceStart;
}

function renderStyledText(
  text: string,
  inlineStyles: readonly ScreenplayPreviewInlineStyle[] = [],
) {
  const boundaries = new Set([0, text.length]);
  for (const style of inlineStyles) {
    boundaries.add(Math.max(0, Math.min(style.from, text.length)));
    boundaries.add(Math.max(0, Math.min(style.to, text.length)));
  }
  const points = [...boundaries].sort((left, right) => left - right);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] ?? 0;
    const to = points[index + 1] ?? from;
    if (to <= from) continue;
    const kinds = inlineStyles
      .filter((style) => style.from <= from && style.to >= to)
      .map((style) => style.kind);
    nodes.push(
      <tspan
        key={`${String(from)}-${String(to)}`}
        fontWeight={kinds.includes('bold') || kinds.includes('bold_italic') ? 700 : undefined}
        fontStyle={kinds.includes('italic') || kinds.includes('bold_italic') ? 'italic' : undefined}
        textDecoration={kinds.includes('underline') ? 'underline' : undefined}
      >
        {text.slice(from, to)}
      </tspan>,
    );
  }
  return nodes;
}

function previewSelection(
  text: string,
  sourceOffsets: readonly number[] | undefined,
  selection: ScreenplaySourceSelection | undefined,
): { from: number; to: number } | undefined {
  if (!selection || !sourceOffsets || sourceOffsets.length !== text.length + 1) return undefined;
  if (selection.from === selection.to) {
    const index = sourceOffsets.indexOf(selection.head);
    return index < 0 ? undefined : { from: index, to: index };
  }
  let first = -1;
  let last = -1;
  for (let index = 0; index < text.length; index += 1) {
    const start = sourceOffsets[index];
    const end = sourceOffsets[index + 1];
    if (start !== undefined && end !== undefined && start < selection.to && end > selection.from) {
      if (first < 0) first = index;
      last = index + 1;
    }
  }
  return first < 0 ? undefined : { from: first, to: last };
}

function sourceSelectionFromPreview(
  root: HTMLElement,
  linesById: ReadonlyMap<string, ScreenplayLayoutLine>,
): ScreenplaySourceSelection | undefined {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return undefined;
  const anchor = sourceOffsetAtDomPoint(
    root,
    linesById,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const head = sourceOffsetAtDomPoint(root, linesById, selection.focusNode, selection.focusOffset);
  return anchor === undefined || head === undefined
    ? undefined
    : directionalSelection(anchor, head);
}

function sourceOffsetAtDomPoint(
  root: HTMLElement,
  linesById: ReadonlyMap<string, ScreenplayLayoutLine>,
  node: Node,
  offset: number,
) {
  if (!root.contains(node)) return undefined;
  const lineElement = elementForNode(node)?.closest<SVGTextElement>('[data-layout-line]');
  const line = lineElement?.dataset.layoutLine
    ? linesById.get(lineElement.dataset.layoutLine)
    : undefined;
  if (!lineElement || !line) return undefined;
  const characterIndex = Math.min(
    textOffsetAtDomPoint(lineElement, node, offset),
    line.text.length,
  );
  return line.textSourceOffsets?.[characterIndex] ?? line.sourceStart;
}

function textOffsetAtDomPoint(root: Element, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function elementForNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function alignedTextOrigin(line: ScreenplayLayoutLine, glyphWidth: number) {
  const textWidth = line.text.length * glyphWidth;
  if (line.align === 'right') return line.x + line.width - textWidth;
  if (line.align === 'center') return line.x + (line.width - textWidth) / 2;
  return line.x;
}

function textAnchorX(line: ScreenplayLayoutLine) {
  if (line.align === 'right') return line.x + line.width;
  if (line.align === 'center') return line.x + line.width / 2;
  return line.x;
}

function svgTextAnchor(align: ScreenplayLayoutLine['align']): 'start' | 'middle' | 'end' {
  if (align === 'right') return 'end';
  if (align === 'center') return 'middle';
  return 'start';
}

function findLayoutLineAtOffset(
  lines: readonly ScreenplayLayoutLine[],
  sourceOffset: number,
): ScreenplayLayoutLine | undefined {
  if (!lines.length) return undefined;
  return (
    lines.find((line) => sourceOffset >= line.sourceStart && sourceOffset < line.sourceEnd) ??
    [...lines].reverse().find((line) => line.sourceStart <= sourceOffset) ??
    lines[0]
  );
}

function findLineElement(root: ParentNode, lineId: string) {
  return Array.from(root.querySelectorAll<SVGTextElement>('[data-layout-line]')).find(
    (element) => element.dataset.layoutLine === lineId,
  );
}

function directionalSelection(anchor: number, head: number): ScreenplaySourceSelection {
  return { anchor, head, from: Math.min(anchor, head), to: Math.max(anchor, head) };
}
