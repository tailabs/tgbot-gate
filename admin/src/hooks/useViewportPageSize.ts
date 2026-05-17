import { type RefObject, useEffect, useRef, useState } from "react";

const DEFAULT_ROW_PX = 68;
const DEFAULT_MIN = 5;
const DEFAULT_MAX = 50;

type Options = {
  max?: number;
  min?: number;
  rowPx?: number;
};

/** Page size from viewport height / fixed row height. Updates on window resize only. */
export function useViewportPageSize(
  viewportRef: RefObject<HTMLElement | null>,
  options: Options = {},
): number {
  const min = options.min ?? DEFAULT_MIN;
  const max = options.max ?? DEFAULT_MAX;
  const rowPx = options.rowPx ?? DEFAULT_ROW_PX;
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const measure = () => {
      const height = viewport.clientHeight;
      if (height < rowPx) {
        return;
      }
      const next = Math.min(max, Math.max(min, Math.floor(height / rowPx)));
      setPageSize((current) => (current === next ? current : next));
    };

    measure();
    const frame = requestAnimationFrame(measure);

    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [viewportRef, min, max, rowPx]);

  return pageSize;
}
