import { LabelDesign, LabelElement, RasterLogoElement } from '../types';
import { computeSafeEngravingZone, getElementVisibleBoundingBoxMm, roundMm } from './geometryEngine';

export type EdgeAlignment = 'safe_left' | 'safe_right' | 'safe_top' | 'safe_bottom' | 'center_x' | 'center_y';

export function alignArtwork(element: LabelElement, design: LabelDesign, alignment: EdgeAlignment): LabelElement {
  const box = getElementVisibleBoundingBoxMm(element);
  const safe = computeSafeEngravingZone(design);
  const dx = alignment === 'safe_left' ? safe.minX - box.minX
    : alignment === 'safe_right' ? safe.maxX - box.maxX
    : alignment === 'center_x' ? design.widthMm / 2 - (box.minX + box.maxX) / 2 : 0;
  const dy = alignment === 'safe_top' ? safe.minY - box.minY
    : alignment === 'safe_bottom' ? safe.maxY - box.maxY
    : alignment === 'center_y' ? design.heightMm / 2 - (box.minY + box.maxY) / 2 : 0;
  return { ...element, xMm: roundMm(element.xMm + dx, 3), yMm: roundMm(element.yMm + dy, 3) };
}

/** Processing changes pixels, not the user's placement or transform. */
export function mergeProcessedArtwork(previous: RasterLogoElement, processed: RasterLogoElement): RasterLogoElement {
  return { ...previous, processedDataUrl: processed.processedDataUrl,
    processing: processed.processing, vectorizedPathsNormalized: processed.vectorizedPathsNormalized,
    contentBoundsNormalized: processed.contentBoundsNormalized,
    pixelWidth: processed.pixelWidth, pixelHeight: processed.pixelHeight,
    processedPixelWidth: processed.processedPixelWidth, processedPixelHeight: processed.processedPixelHeight,
    effectiveDpi: processed.effectiveDpi };
}

export function artworkDpi(element: RasterLogoElement): number {
  const limit = element.processing.mode === 'raster' ? 640 : 280;
  const scale = Math.min(1, limit / Math.max(element.pixelWidth, element.pixelHeight));
  const w = element.processedPixelWidth ?? Math.max(8, Math.round(element.pixelWidth * scale));
  const h = element.processedPixelHeight ?? Math.max(8, Math.round(element.pixelHeight * scale));
  return Math.min(w / element.widthMm, h / element.heightMm) * 25.4;
}
