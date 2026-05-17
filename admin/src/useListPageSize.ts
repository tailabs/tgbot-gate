import { RefObject, useEffect, useState } from "react";

const DEFAULT_ROW_HEIGHT = 72;
const DEFAULT_MIN = 3;
const DEFAULT_MAX = 40;

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
  const rowSelector = options.rowSelector ?? ".grouped-row";
  const fallbackRowHeight = options.fallbackRowHeight ?? DEFAULT_ROW_HEIGHT;
  const [pageSize, setPageSize] = useState(6);
  const [ready, setReady] = useState(false);

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
      const rowHeight = sample?.getBoundingClientRect().height ?? fallbackRowHeight;
      const next = Math.min(max, Math.max(min, Math.floor(available / rowHeight)));
      setPageSize((current) => (current === next ? current : next));
      setReady(true);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const parent = viewport.parentElement;
    if (parent) {
      observer.observe(parent);
    }
    measure();

    return () => observer.disconnect();
  }, [viewportRef, min, max, rowSelector, fallbackRowHeight]);

  return { pageSize, ready };
}
