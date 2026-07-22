import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Skeleton, SkeletonGroup } from './components/Skeleton';
import { mapPdfPixelsToTheme, parseHexColor, type Rgb } from './pdf-theme';
import styles from './PdfViewer.module.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PageSize {
  width: number;
  height: number;
}

interface DarkPdfPalette {
  pageCss: string;
  inkCss: string;
  page: Rgb;
  ink: Rgb;
}

function useDarkPdfPalette(enabled: boolean): DarkPdfPalette | undefined {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'coda-dark');

  useEffect(() => {
    if (!enabled) return;
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme ?? 'coda-dark'),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) return undefined;
    const tokens = getComputedStyle(document.documentElement);
    const lightTheme = theme === 'light';
    const pageCss = tokens.getPropertyValue(lightTheme ? '--coda-text' : '--coda-body').trim();
    const inkCss = tokens.getPropertyValue(lightTheme ? '--coda-panel' : '--coda-text').trim();
    const page = parseHexColor(pageCss);
    const ink = parseHexColor(inkCss);
    if (!page || !ink) return undefined;
    return { pageCss, inkCss, page, ink };
  }, [enabled, theme]);
}

interface PdfViewerProps {
  url: string;
  page: number;
  darkView?: boolean;
  zoom?: number;
  onPageCount: (count: number) => void;
  onPageChange?: (page: number) => void;
}

function LazyPdfPage({
  document,
  pageNumber,
  width,
  fallbackRatio,
  scrollRoot,
  darkPalette,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  fallbackRatio: number;
  scrollRoot: HTMLDivElement | null;
  darkPalette?: DarkPdfPalette;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>();
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const ratio = pageSize ? pageSize.height / pageSize.width : fallbackRatio;
  const height = Math.max(1, Math.round(width * ratio));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !scrollRoot) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { root: scrollRoot, rootMargin: '100% 0px', threshold: 0 },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!nearViewport || width <= 0) return;
    let disposed = false;
    let pdfPage: PDFPageProxy | undefined;
    let renderTask: RenderTask | undefined;
    setRendered(false);

    void document
      .getPage(pageNumber)
      .then(async (nextPage) => {
        pdfPage = nextPage;
        if (disposed) {
          nextPage.cleanup();
          return;
        }
        const baseViewport = nextPage.getViewport({ scale: 1 });
        setPageSize({ width: baseViewport.width, height: baseViewport.height });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderScale = (width / baseViewport.width) * pixelRatio;
        const viewport = nextPage.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { alpha: false });
        if (!canvas || !context || disposed) return;
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.round(width * (baseViewport.height / baseViewport.width))}px`;
        renderTask = nextPage.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!disposed && darkPalette) {
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          mapPdfPixelsToTheme(image.data, darkPalette.page, darkPalette.ink);
          context.putImageData(image, 0, 0);
        }
        if (!disposed) {
          setFailed(false);
          setRendered(true);
        }
      })
      .catch((reason: unknown) => {
        const name = reason instanceof Error ? reason.name : '';
        if (!disposed && name !== 'RenderingCancelledException') setFailed(true);
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
      pdfPage?.cleanup();
    };
  }, [darkPalette, document, nearViewport, pageNumber, width]);

  return (
    <div
      ref={hostRef}
      className={styles.page}
      data-pdf-page={pageNumber}
      style={{ width, height }}
      aria-label={`PDF page ${pageNumber}`}
    >
      {nearViewport && !failed && <canvas ref={canvasRef} aria-hidden={!rendered} />}
      {nearViewport && !failed && !rendered && (
        <Skeleton width="100%" height="100%" radius={0} className={styles.pageSkeleton} />
      )}
      {!nearViewport && <span className={styles.pagePlaceholder} aria-hidden="true" />}
      {failed && <span className={styles.pageError}>PAGE {pageNumber} COULD NOT BE RENDERED</span>}
    </div>
  );
}

export const PdfViewer = memo(function PdfViewer({
  url,
  page,
  darkView = false,
  zoom = 1,
  onPageCount,
  onPageChange,
}: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Array<HTMLDivElement | null>>([]);
  const observedPageRef = useRef(1);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [fallbackRatio, setFallbackRatio] = useState(11 / 8.5);
  const [error, setError] = useState<string>();
  const darkPalette = useDarkPdfPalette(darkView);

  const setScrollElement = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollRoot(node);
  }, []);

  useLayoutEffect(() => {
    if (!scrollRoot) return;
    const measure = () => setPageWidth(Math.max(1, Math.floor(scrollRoot.clientWidth - 20)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    let disposed = false;
    let loadedDocument: PDFDocumentProxy | undefined;
    let measuredPage: PDFPageProxy | undefined;
    const loadingTask = pdfjs.getDocument(url);
    setError(undefined);
    setDocument(undefined);
    setPageCount(0);

    void loadingTask.promise
      .then(async (nextDocument) => {
        loadedDocument = nextDocument;
        if (disposed) {
          await nextDocument.destroy();
          return;
        }
        const firstPage = await nextDocument.getPage(1);
        measuredPage = firstPage;
        const viewport = firstPage.getViewport({ scale: 1 });
        if (!disposed) {
          setFallbackRatio(viewport.height / viewport.width);
          setPageCount(nextDocument.numPages);
          onPageCount(nextDocument.numPages);
          setDocument(nextDocument);
        }
        firstPage.cleanup();
        measuredPage = undefined;
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Unable to open PDF');
      });

    return () => {
      disposed = true;
      measuredPage?.cleanup();
      setDocument(undefined);
      if (loadedDocument) void loadedDocument.destroy();
      else void loadingTask.destroy();
    };
  }, [url, onPageCount]);

  useEffect(() => {
    if (!document || pageCount === 0) return;
    const target = Math.max(1, Math.min(page, pageCount));
    if (target === observedPageRef.current && pageElementsRef.current[target - 1]) return;
    observedPageRef.current = target;
    const element = pageElementsRef.current[target - 1];
    const root = scrollRef.current;
    if (element && root) root.scrollTo({ top: element.offsetTop - 10, behavior: 'auto' });
  }, [document, page, pageCount]);

  const updateVisiblePage = () => {
    if (scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      const root = scrollRef.current;
      if (!root) return;
      const probe = root.scrollTop + root.clientHeight * 0.32;
      let nextPage = 1;
      for (let index = 0; index < pageElementsRef.current.length; index += 1) {
        const element = pageElementsRef.current[index];
        if (!element) continue;
        if (element.offsetTop <= probe) nextPage = index + 1;
        else break;
      }
      if (nextPage !== observedPageRef.current) {
        observedPageRef.current = nextPage;
        onPageChange?.(nextPage);
      }
    });
  };

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  return (
    <div
      ref={setScrollElement}
      className={`${styles.viewer} ${darkView ? styles.darkView : ''}`}
      style={
        darkPalette
          ? ({
              '--pdf-dark-page': darkPalette.pageCss,
              '--pdf-dark-ink': darkPalette.inkCss,
            } as CSSProperties)
          : undefined
      }
      onScroll={updateVisiblePage}
      aria-busy={!error && !document}
    >
      {error && (
        <div className={styles.message} role="alert">
          {error}
        </div>
      )}
      {!error && !document && (
        <SkeletonGroup label="Opening PDF" className={styles.openingDocument}>
          <Skeleton width="min(76%, 680px)" height="calc(100% - 40px)" radius={1} />
        </SkeletonGroup>
      )}
      {document &&
        pageWidth > 0 &&
        Array.from({ length: pageCount }, (_, index) => (
          <div
            key={index + 1}
            ref={(node) => {
              pageElementsRef.current[index] = node;
            }}
            className={styles.pagePosition}
          >
            <LazyPdfPage
              document={document}
              pageNumber={index + 1}
              width={Math.max(1, Math.round(pageWidth * zoom))}
              fallbackRatio={fallbackRatio}
              scrollRoot={scrollRoot}
              darkPalette={darkPalette}
            />
          </div>
        ))}
    </div>
  );
});
