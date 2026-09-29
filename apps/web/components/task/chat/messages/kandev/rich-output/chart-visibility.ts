import { useEffect, useRef, useState } from "react";

const CHART_PREWARM_MARGIN_PX = 200;
// i18n-exempt: IntersectionObserver geometry, not user-facing copy.
const CHART_PREWARM_MARGIN = `${CHART_PREWARM_MARGIN_PX}px 0px`;

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
      { rootMargin: CHART_PREWARM_MARGIN },
    );
    const checkViewport = () => {
      const bounds = plot.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const isNearViewport =
        bounds.bottom >= -CHART_PREWARM_MARGIN_PX &&
        bounds.top <= window.innerHeight + CHART_PREWARM_MARGIN_PX &&
        bounds.right >= 0 &&
        bounds.left <= window.innerWidth;
      if (!isNearViewport) return;
      setIsNearViewport(true);
      observer.disconnect();
    };

    observer.observe(plot);
    document.addEventListener("scroll", checkViewport, true);
    window.addEventListener("resize", checkViewport);
    checkViewport();
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", checkViewport, true);
      window.removeEventListener("resize", checkViewport);
    };
  }, [canObserveIntersection, shouldMountPlot]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isNearViewport && isDocumentVisible) setShouldMountPlot(true);
  }, [isDocumentVisible, isNearViewport]);

  return { plotRef, shouldMountPlot };
}
