import { RefObject, useEffect, useRef, useState } from "react";

const DEFAULT_ROW_HEIGHT = 72;
const DEFAULT_MIN = 3;
const DEFAULT_MAX = 40;
/** Ignore sub-pixel / scrollbar jitter when comparing viewport height. */
const VIEWPORT_HEIGHT_EPSILON = 4;

type Options = {
  min?: number;
  max?: number;
  rowSelector?: string;
  fallbackRowHeight?: number;
};

type ListPageSize = {
  pageSize: number;
  ready: boolean;
};

/** Page size = how many `.grouped-row` items fit in the viewport (ResizeObserver). */
export function useListPageSize(
  viewportRef: RefObject<HTMLElement | null>,
  options: Options = {},
): ListPageSize {
  const min = options.min ?? DEFAULT_MIN;
  const max = options.max ?? DEFAULT_MAX;
  const rowSelector = options.rowSelector ?? "[data-list-row]";
  const fallbackRowHeight = options.fallbackRowHeight ?? DEFAULT_ROW_HEIGHT;
  const [pageSize, setPageSize] = useState(6);
  const [ready, setReady] = useState(false);
  const lastViewportHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const measure = () => {
      const available = viewport.clientHeight;
      if (available < fallbackRowHeight) {
        setReady(false);
        return;
      }

      const sample = viewport.querySelector(rowSelector) as HTMLElement | null;
      const measuredHeight = sample?.getBoundingClientRect().height ?? 0;
      // `0 ?? fallback` stays 0 in JS; a zero-height probe would inflate page size to max.
      const rowHeight =
        Number.isFinite(measuredHeight) && measuredHeight > 1 ? measuredHeight : fallbackRowHeight;
      const next = Math.min(max, Math.max(min, Math.floor(available / rowHeight)));

      // Ignore content-only resizes (e.g. expanding a row); only reflow on real viewport height changes.
      const prevHeight = lastViewportHeightRef.current;
      const viewportHeightChanged =
        prevHeight === null || Math.abs(prevHeight - available) >= VIEWPORT_HEIGHT_EPSILON;
      if (viewportHeightChanged) {
        lastViewportHeightRef.current = available;
        setPageSize((current) => (current === next ? current : next));
      }

      setReady(true);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();

    return () => observer.disconnect();
  }, [viewportRef, min, max, rowSelector, fallbackRowHeight]);

  return { pageSize, ready };
}
