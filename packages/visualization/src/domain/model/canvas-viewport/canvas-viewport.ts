export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export function createCanvasViewport(
  x: number = 0,
  y: number = 0,
  zoom: number = 1,
): CanvasViewport {
  return {
    x,
    y,
    zoom,
  };
}

export function updateCanvasViewport(
  viewport: CanvasViewport,
  updates: Partial<Omit<CanvasViewport, "zoom">> & { zoom?: number },
): CanvasViewport {
  return {
    ...viewport,
    ...updates,
    zoom: Math.max(0.1, Math.min(2, updates.zoom ?? viewport.zoom)),
  };
}
