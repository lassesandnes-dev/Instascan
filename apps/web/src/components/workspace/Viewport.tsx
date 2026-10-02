"use client";

import { useEffect, useRef } from "react";
import { PointCloudViewer, type PickResult } from "@/viewer/PointCloudViewer";

interface Props {
  onReady: (viewer: PointCloudViewer | null) => void;
  onHover: (pick: PickResult | null) => void;
  onPick: (pick: PickResult) => void;
  children?: React.ReactNode;
}

/** Hosts the imperative Three.js viewer; callbacks are read through refs so the viewer is created once. */
export function Viewport({ onReady, onHover, onPick, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onHover, onPick, onReady });
  useEffect(() => {
    callbacks.current = { onHover, onPick, onReady };
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const viewer = new PointCloudViewer(el, {
      onHover: (p) => callbacks.current.onHover(p),
      onPick: (p) => callbacks.current.onPick(p),
    });
    callbacks.current.onReady(viewer);
    return () => {
      callbacks.current.onReady(null);
      viewer.dispose();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" data-testid="viewer-canvas" />
      {children}
    </div>
  );
}
