/**
 * LaserHouse Studio — Generador de Patrón de Calibración de Kerf (Corte Láser)
 * Permite medir el corte físico (kerf) del haz láser en la Vank 9060 CO₂ mediante un calibre digital,
 * independientemente del software de corte utilizado.
 *
 * Método de medición:
 * - Se corta un marco exterior de 100 x 20 mm y 10 tablillas interiores de 10 x 20 mm.
 * - Tras el corte (11 trayectorias verticales), se empujan las 10 tablillas hacia un extremo.
 * - El hueco libre resultante se mide con un calibre digital.
 * - Kerf real (mm) = Espacio libre medido / 10 (o 11 cortes).
 */

import { LIGHTBURN_LAYERS } from '../types';

export interface KerfCalibrationArtifact {
  svgContent: string;
  widthMm: number;
  heightMm: number;
  filenameSuggested: string;
  instructions: string;
}

export function generateKerfCalibrationPatternSvg(materialName = 'Material'): KerfCalibrationArtifact {
  const frameWidth = 100;
  const frameHeight = 20;
  const slatWidth = 10;
  const slatCount = 10;
  const marginMm = 8;

  const totalWidthMm = frameWidth + marginMm * 2;
  const totalHeightMm = frameHeight + marginMm * 2 + 10;

  const cutColor = LIGHTBURN_LAYERS.CUT.hexColor;
  const engraveColor = LIGHTBURN_LAYERS.ENGRAVE.hexColor;

  const slatsLines: string[] = [];
  const numbersSvg: string[] = [];

  for (let i = 1; i < slatCount; i++) {
    const x = marginMm + i * slatWidth;
    const y1 = marginMm;
    const y2 = marginMm + frameHeight;
    slatsLines.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${cutColor}" stroke-width="0.15" />`);
  }

  for (let i = 0; i < slatCount; i++) {
    const cx = marginMm + i * slatWidth + slatWidth / 2;
    const cy = marginMm + frameHeight / 2 + 1.2;
    numbersSvg.push(
      `<text x="${cx}" y="${cy}" text-anchor="middle" fill="${engraveColor}" font-size="3.2" font-family="monospace" font-weight="bold">${i + 1}</text>`
    );
  }

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${totalWidthMm}mm"
     height="${totalHeightMm}mm"
     viewBox="0 0 ${totalWidthMm} ${totalHeightMm}">
  <!-- LaserHouse Studio — Patrón de Calibración de Kerf para Vank 9060 CO2 -->
  <!-- Material de referencia: ${materialName} -->

  <!-- Capa 00: GRABADO -->
  <g id="CAPA_00_GRABADO">
    <text x="${totalWidthMm / 2}" y="5" text-anchor="middle" fill="${engraveColor}" font-size="2.6" font-family="sans-serif" font-weight="bold">
      CALIBRACION DE KERF LASERHOUSE — ${materialName.toUpperCase()}
    </text>
    ${numbersSvg.join('\n    ')}
    <text x="${totalWidthMm / 2}" y="${totalHeightMm - 3}" text-anchor="middle" fill="${engraveColor}" font-size="2.0" font-family="monospace">
      Empujar tablillas a un lado y medir espacio con calibre digital: Kerf = Espacio / 10
    </text>
  </g>

  <!-- Capa 02: CORTE -->
  <g id="CAPA_02_CORTE">
    <!-- Marco perimetral exterior (100 x 20 mm) -->
    <rect x="${marginMm}" y="${marginMm}" width="${frameWidth}" height="${frameHeight}" fill="none" stroke="${cutColor}" stroke-width="0.2" />
    <!-- 9 líneas de corte internas para separar las 10 tablillas -->
    ${slatsLines.join('\n    ')}
  </g>
</svg>`;

  const safeMaterialCode = materialName.replace(/[^a-zA-Z0-9_-]/g, '_');

  return {
    svgContent,
    widthMm: totalWidthMm,
    heightMm: totalHeightMm,
    filenameSuggested: `LaserHouse_Calibracion_Kerf_${safeMaterialCode}_100x20mm.svg`,
    instructions:
      'Cortar sobre recorte de prueba en la Vank 9060 CO₂. Empujar las 10 tablillas hacia la izquierda dentro del marco. Medir la luz restante a la derecha con un calibre digital en milímetros y dividir por 10. Ingresar el valor obtenido en el campo Kerf (mm) de LaserHouse Studio.',
  };
}
