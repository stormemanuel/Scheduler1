"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep the control being used in place when another expanded panel collapses. */
export function useScrollAnchor() {
  const pending = useRef<{ element: HTMLElement; top: number; overflowAnchor: string; frame: number } | null>(null);
  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    pending.current = null;
    window.cancelAnimationFrame(anchor.frame);
    if (anchor.element.isConnected) {
      const delta = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
    }
    document.documentElement.style.overflowAnchor = anchor.overflowAnchor;
  });
  useLayoutEffect(() => () => {
    if (pending.current) {
      window.cancelAnimationFrame(pending.current.frame);
      document.documentElement.style.overflowAnchor = pending.current.overflowAnchor;
    }
  }, []);
  return (element: HTMLElement) => {
    if (pending.current) window.cancelAnimationFrame(pending.current.frame);
    const anchor = { element, top: element.getBoundingClientRect().top, overflowAnchor: pending.current?.overflowAnchor ?? document.documentElement.style.overflowAnchor, frame: 0 };
    pending.current = anchor;
    document.documentElement.style.overflowAnchor = "none";
    // Clicking an already-selected area may not cause a React render.
    anchor.frame = window.requestAnimationFrame(() => {
      if (pending.current !== anchor) return;
      pending.current = null;
      document.documentElement.style.overflowAnchor = anchor.overflowAnchor;
    });
  };
}
