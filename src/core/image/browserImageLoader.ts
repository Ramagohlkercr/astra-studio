import { roundMm } from '../geometry/geometryEngine';
import {
  ImageProcessingOptions,
  Millimeters,
  RasterLogoElement,
} from '../types';
import {
  computeEffectiveDpi,
  processRgbaBufferToBinaryMask,
  traceBinaryMaskToNormalizedPaths,
} from './imageProcessor';

/**
 * Carga un archivo PNG/JPG o un dataURL en un canvas offscreen del navegador,
 * ejecuta el procesamiento monocromático real (eliminación de fondo, brillo, contraste, umbral, inversión)
 * y el motor de vectorización Marching Squares + RDP para generar trazados vectoriales reales.
 */
export async function processImageDataUrlInBrowser(params: {
  dataUrl: string;
  name: string;
  targetWidthMm: Millimeters;
  centerXMm: Millimeters;
  centerYMm: Millimeters;
  options: ImageProcessingOptions;
  existingId?: string;
}): Promise<RasterLogoElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Limitar resolución de trabajo a máx 360 px de lado mayor para que Marching Squares sea instantáneo y preciso
        const origW = Math.max(1, img.naturalWidth || img.width || 100);
        const origH = Math.max(1, img.naturalHeight || img.height || 100);
        const aspect = origW / origH;

        const maxWorkDim = 240;
        const scale = Math.min(1, maxWorkDim / Math.max(origW, origH));
        const workW = Math.max(8, Math.round(origW * scale));
        const workH = Math.max(8, Math.round(origH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = workW;
        canvas.height = workH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('No se pudo inicializar el contexto 2D de procesamiento de imagen.');
        }

        ctx.drawImage(img, 0, 0, workW, workH);
        const imgData = ctx.getImageData(0, 0, workW, workH);

        const { processedRgba, binaryMask } = processRgbaBufferToBinaryMask(
          imgData.data,
          workW,
          workH,
          params.options
        );

        const outImgData = new ImageData(
          new Uint8ClampedArray(processedRgba),
          workW,
          workH
        );
        ctx.putImageData(outImgData, 0, 0);
        const processedDataUrl = canvas.toDataURL('image/png');

        const vectorizedPathsNormalized = traceBinaryMaskToNormalizedPaths(
          binaryMask,
          workW,
          workH,
          params.options.turdSize
        );

        const widthMm = roundMm(params.targetWidthMm);
        const heightMm = roundMm(widthMm / aspect);
        const effectiveDpi = computeEffectiveDpi(origW, widthMm);

        resolve({
          id: params.existingId || `logo-raster-${Date.now()}`,
          name: params.name,
          type: 'logo_raster',
          xMm: roundMm(params.centerXMm),
          yMm: roundMm(params.centerYMm),
          widthMm,
          heightMm,
          aspectRatio: roundMm(aspect, 4),
          lockAspectRatio: true,
          rotationDeg: 0,
          locked: false,
          visible: true,
          originalDataUrl: params.dataUrl,
          processedDataUrl,
          pixelWidth: origW,
          pixelHeight: origH,
          processing: { ...params.options },
          vectorizedPathsNormalized,
          effectiveDpi,
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('No se pudo decodificar el archivo de imagen.'));
    img.src = params.dataUrl;
  });
}
