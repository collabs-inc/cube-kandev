import { useEffect, useRef, useState } from "react";

// i18n-exempt: IntersectionObserver geometry, not user-facing copy.
const CHART_PREWARM_MARGIN = "200px 0px";

function getScrollRoot(element: HTMLElement): Element | null {
  let ancestor = element.parentElement;
  while (ancestor) {
    const style = window.getComputedStyle(ancestor);
    if ([style.overflowX, style.overflowY].some((value) => /^(auto|scroll|overlay)$/.test(value))) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

export function useChartPlotVisibility() {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const canObserveIntersection = typeof IntersectionObserver !== "undefined";
  const [isNearViewport, setIsNearViewport] = useState(!canObserveIntersection);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [shouldMountPlot, setShouldMountPlot] = useState(() => !canObserveIntersection);

  useEffect(() => {
    const plot = plotRef.current;
    if (shouldMountPlot || !plot || !canObserveIntersection) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { root: getScrollRoot(plot), rootMargin: CHART_PREWARM_MARGIN },
    );
    observer.observe(plot);
    return () => observer.disconnect();
  }, [canObserveIntersection, shouldMountPlot]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isNearViewport && isDocumentVisible) setShouldMountPlot(true);
  }, [isDocumentVisible, isNearViewport]);

  return { plotRef, shouldMountPlot };
}
