/**
 * Astra Studio — Motor de Calibración de Potencia/Velocidad (Material Test Generator)
 * y Biblioteca de Materiales Estilo LightBurn Pro 2.2 para Vank 9060 (Ruida RDC8445S).
 */

import { roundMm } from '../geometry/geometryEngine';
import {
  CompiledRuidaRdArtifact,
  encodeRuidaAbsCoordMm,
  encodeRuidaPowerPercent,
  encodeRuidaSpeedMmPerSec,
  scrambleRuidaByte,
} from './ruidaCompiler';
import {
  LIGHTBURN_PALETTE_COLORS,
  MaterialTestCell,
  MaterialTestGridConfig,
  SavedMaterialLibraryEntry,
  WorkbenchLayerConfig,
} from './workbenchTypes';

const MATERIAL_LIBRARY_STORAGE_KEY = 'astra_studio_lightburn_material_library_v1';

export const DEFAULT_ENGRAVE_TEST_CONFIG: MaterialTestGridConfig = {
  testType: 'engrave_grid',
  targetRole: 'ENGRAVE',
  minSpeedMmS: 200,
  maxSpeedMmS: 600,
  speedSteps: 5,
  minPowerPercent: 15,
  maxPowerPercent: 35,
  powerSteps: 5,
  lineIntervalMm: 0.073,
  cellSizeMm: 10,
  cellGapMm: 3,
  airAssist: false,
  passes: 1,
};

export const DEFAULT_CUT_TEST_CONFIG: MaterialTestGridConfig = {
  testType: 'cut_grid',
  targetRole: 'CUT',
  minSpeedMmS: 10,
  maxSpeedMmS: 30,
  speedSteps: 5,
  minPowerPercent: 40,
  maxPowerPercent: 80,
  powerSteps: 5,
  lineIntervalMm: 0.1,
  cellSizeMm: 10,
  cellGapMm: 3,
  airAssist: true,
  passes: 1,
};

/**
 * Calcula los valores interpolados de un eje (Velocidad o Potencia).
 */
function interpolateSteps(minVal: number, maxVal: number, count: number): number[] {
  const safeCount = Math.max(2, Math.min(5, Math.round(count)));
  const lo = Math.min(minVal, maxVal);
  const hi = Math.max(minVal, maxVal);
  const values: number[] = [];
  for (let i = 0; i < safeCount; i++) {
    const ratio = i / Math.max(1, safeCount - 1);
    values.push(roundMm(lo + (hi - lo) * ratio, 1));
  }
  return values;
}

/**
 * Genera la grilla de celdas (Filas = Velocidad mm/s, Columnas = Potencia %)
 * asignando a cada celda un índice de capa único de la paleta de LightBurn (C00..C28).
 */
export function generateMaterialTestCells(config: MaterialTestGridConfig): {
  cells: MaterialTestCell[];
  speedValues: number[];
  powerValues: number[];
  totalWidthMm: number;
  totalHeightMm: number;
  gridOriginXMm: number;
  gridOriginYMm: number;
} {
  const rows = Math.max(2, Math.min(5, Math.round(config.speedSteps)));
  const cols = Math.max(2, Math.min(5, Math.round(config.powerSteps)));

  const speedValues = interpolateSteps(config.minSpeedMmS, config.maxSpeedMmS, rows);
  const powerValues = interpolateSteps(
    config.minPowerPercent,
    config.maxPowerPercent,
    cols
  );

  const cellSize = Math.max(5, Math.min(30, roundMm(config.cellSizeMm)));
  const gap = Math.max(1.5, Math.min(15, roundMm(config.cellGapMm)));

  // Margen izquierdo y superior para etiquetas de ejes
  const gridOriginXMm = 18;
  const gridOriginYMm = 14;

  const cells: MaterialTestCell[] = [];
  let layerIdx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const palette =
        LIGHTBURN_PALETTE_COLORS[layerIdx % LIGHTBURN_PALETTE_COLORS.length];
      const speed = speedValues[r];
      const power = powerValues[c];
      const xMm = roundMm(gridOriginXMm + c * (cellSize + gap));
      const yMm = roundMm(gridOriginYMm + r * (cellSize + gap));

      cells.push({
        row: r,
        col: c,
        cutIndex: palette.index,
        layerCode: `C${palette.code}`,
        hexColor: palette.hex,
        speedMmPerSec: speed,
        maxPowerPercent: power,
        minPowerPercent: power,
        lineIntervalMm: Math.max(0.03, roundMm(config.lineIntervalMm, 3)),
        xMm,
        yMm,
        sizeMm: cellSize,
      });

      layerIdx++;
    }
  }

  const totalWidthMm = roundMm(
    gridOriginXMm + cols * cellSize + Math.max(0, cols - 1) * gap + 6
  );
  const totalHeightMm = roundMm(
    gridOriginYMm + rows * cellSize + Math.max(0, rows - 1) * gap + 6
  );

  return {
    cells,
    speedValues,
    powerValues,
    totalWidthMm,
    totalHeightMm,
    gridOriginXMm,
    gridOriginYMm,
  };
}

function xmlEscape(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Exporta la Matriz de Prueba de Material como proyecto nativo LightBurn (.lbrn2),
 * donde cada celda tiene su propio <CutSetting> con su velocidad y potencia exactas.
 */
export function exportMaterialTestToLbrn2(
  config: MaterialTestGridConfig,
  materialName = 'Ecocuero'
): {
  lbrn2Content: string;
  filenameSuggested: string;
  cellCount: number;
  widthMm: number;
  heightMm: number;
} {
  const { cells, totalWidthMm, totalHeightMm } = generateMaterialTestCells(config);
  const isEngrave = config.testType === 'engrave_grid';
  const cutType = isEngrave ? 'Scan' : 'Cut';

  const cutSettingsXml: string[] = [];
  const shapesXml: string[] = [];

  for (const cell of cells) {
    cutSettingsXml.push(
      [
        `  <CutSetting type="${cutType}">`,
        `    <index Value="${cell.cutIndex}"/>`,
        `    <name Value="${xmlEscape(
          `${cell.layerCode} ${cell.speedMmPerSec}mm/s ${cell.maxPowerPercent}%`
        )}"/>`,
        `    <priority Value="${cell.cutIndex}"/>`,
        `    <doOutput Value="1"/>`,
        `    <hide Value="0"/>`,
        `    <runBlower Value="${config.airAssist ? 1 : 0}"/>`,
        `    <numPasses Value="${Math.max(1, config.passes)}"/>`,
        `    <speed Value="${cell.speedMmPerSec}"/>`,
        `    <maxPower Value="${cell.maxPowerPercent}"/>`,
        `    <minPower Value="${cell.minPowerPercent}"/>`,
        ...(isEngrave
          ? [
              `    <interval Value="${cell.lineIntervalMm}"/>`,
              `    <bidir Value="1"/>`,
            ]
          : []),
        `  </CutSetting>`,
      ].join('\n')
    );

    const x1 = cell.xMm;
    const y1 = cell.yMm;
    const x2 = roundMm(cell.xMm + cell.sizeMm);
    const y2 = roundMm(cell.yMm + cell.sizeMm);

    shapesXml.push(
      [
        `  <Shape Type="Path" CutIndex="${cell.cutIndex}">`,
        `    <XForm>1 0 0 1 0 0</XForm>`,
        `    <V vx="${x1}" vy="${y1}"/>`,
        `    <V vx="${x2}" vy="${y1}"/>`,
        `    <V vx="${x2}" vy="${y2}"/>`,
        `    <V vx="${x1}" vy="${y2}"/>`,
        `    <P T="L" p0="0" p1="1"/>`,
        `    <P T="L" p0="1" p1="2"/>`,
        `    <P T="L" p0="2" p1="3"/>`,
        `    <P T="L" p0="3" p1="0"/>`,
        `  </Shape>`,
      ].join('\n')
    );
  }

  const safeMat =
    materialName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Material';

  const modeLabel = isEngrave ? 'Grabado' : 'Corte';

  const lbrn2Content = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="2.2.01" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    `  <UIPrefs>`,
    `    <Optimize_ByLayer Value="1"/>`,
    `    <Optimize_ByPriority Value="1"/>`,
    `  </UIPrefs>`,
    ...cutSettingsXml,
    ...shapesXml,
    `  <Notes ShowOnLoad="1" Notes="${xmlEscape(
      `Matriz de Calibración de ${modeLabel} (${materialName}) — Filas: Velocidad (${config.minSpeedMmS} a ${config.maxSpeedMmS} mm/s) × Columnas: Potencia (${config.minPowerPercent}% a ${config.maxPowerPercent}%). Intervalo: ${config.lineIntervalMm} mm (${Math.round(25.4 / config.lineIntervalMm)} DPI).`
    )}"/>`,
    `</LightBurnProject>`,
  ].join('\n');

  return {
    lbrn2Content,
    filenameSuggested: `Calibracion_${modeLabel}_${safeMat}.lbrn2`,
    cellCount: cells.length,
    widthMm: totalWidthMm,
    heightMm: totalHeightMm,
  };
}

/**
 * Compila la Matriz de Calibración de Potencia x Velocidad directamente a un archivo binario Ruida (.RD)
 * donde cada celda se ejecuta físicamente a su velocidad (mm/s) y potencia (%) correspondiente.
 */
export function compileMaterialTestToRuidaRd(
  config: MaterialTestGridConfig,
  jobName = 'CALTEST'
): CompiledRuidaRdArtifact {
  const { cells, totalWidthMm, totalHeightMm } = generateMaterialTestCells(config);
  const isEngrave = config.testType === 'engrave_grid';

  const raw: number[] = [];
  let commandCount = 0;

  const emit = (bytes: number[]) => {
    for (const b of bytes) raw.push(b & 0xff);
    commandCount++;
  };

  const cleanJobName =
    jobName
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 8) || 'CALTEST';

  emit([0xd8, 0x00]);
  const nameBytes = Array.from(cleanJobName).map((ch) => ch.charCodeAt(0) & 0x7f);
  emit([0xe7, 0x01, ...nameBytes, 0x00]);
  emit([0xe7, 0x03, ...encodeRuidaAbsCoordMm(0), ...encodeRuidaAbsCoordMm(0)]);
  emit([
    0xe7,
    0x07,
    ...encodeRuidaAbsCoordMm(totalWidthMm),
    ...encodeRuidaAbsCoordMm(totalHeightMm),
  ]);
  emit([0xca, 0x01, config.airAssist ? 0x13 : 0x12]);

  const emitMoveAbs = (xMm: number, yMm: number) => {
    emit([0x88, ...encodeRuidaAbsCoordMm(xMm), ...encodeRuidaAbsCoordMm(yMm)]);
  };
  const emitCutAbs = (xMm: number, yMm: number) => {
    emit([0xa8, ...encodeRuidaAbsCoordMm(xMm), ...encodeRuidaAbsCoordMm(yMm)]);
  };

  const passes = Math.max(1, config.passes);

  for (const cell of cells) {
    const lIdx = cell.cutIndex & 0x7f;
    emit([0xca, 0x02, lIdx]);
    emit([0xc9, 0x02, ...encodeRuidaSpeedMmPerSec(cell.speedMmPerSec)]);
    emit([0xc6, 0x01, ...encodeRuidaPowerPercent(cell.minPowerPercent)]);
    emit([0xc6, 0x02, ...encodeRuidaPowerPercent(cell.maxPowerPercent)]);

    const x1 = cell.xMm;
    const y1 = cell.yMm;
    const x2 = roundMm(cell.xMm + cell.sizeMm);
    const y2 = roundMm(cell.yMm + cell.sizeMm);

    for (let p = 0; p < passes; p++) {
      if (isEngrave) {
        const interval = Math.max(0.05, cell.lineIntervalMm);
        const linesCount = Math.max(2, Math.min(250, Math.ceil(cell.sizeMm / interval)));
        for (let row = 0; row <= linesCount; row++) {
          const y = roundMm(y1 + (cell.sizeMm * row) / linesCount);
          if (row % 2 === 0) {
            emitMoveAbs(x1, y);
            emitCutAbs(x2, y);
          } else {
            emitMoveAbs(x2, y);
            emitCutAbs(x1, y);
          }
        }
      } else {
        emitMoveAbs(x1, y1);
        emitCutAbs(x2, y1);
        emitCutAbs(x2, y2);
        emitCutAbs(x1, y2);
        emitCutAbs(x1, y1);
      }
    }
  }

  emitMoveAbs(0, 0);
  emit([0xd7]);

  const rawUnscrambledBytes = new Uint8Array(raw);
  const rdBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    rdBytes[i] = scrambleRuidaByte(raw[i]);
  }

  return {
    rdBytes,
    rawUnscrambledBytes,
    filenameSuggested: `${cleanJobName}_Vank9060.rd`,
    ruidaJobName: cleanJobName,
    totalPieces: cells.length,
    activeLayersCount: cells.length,
    boundingBoxMm: {
      minX: 0,
      minY: 0,
      maxX: totalWidthMm,
      maxY: totalHeightMm,
      width: totalWidthMm,
      height: totalHeightMm,
    },
    commandCount,
  };
}

/**
 * Exporta la Matriz de Prueba de Material como SVG 1:1 en milímetros con etiquetas legibles de velocidad y potencia.
 */
export function exportMaterialTestToSvg(
  config: MaterialTestGridConfig,
  materialName = 'Ecocuero'
): { svgContent: string; filenameSuggested: string } {
  const {
    cells,
    speedValues,
    powerValues,
    totalWidthMm,
    totalHeightMm,
    gridOriginXMm,
    gridOriginYMm,
  } = generateMaterialTestCells(config);
  const isEngrave = config.testType === 'engrave_grid';
  const cellSize = Math.max(5, roundMm(config.cellSizeMm));
  const gap = Math.max(1.5, roundMm(config.cellGapMm));

  const nodes: string[] = [];

  // Etiquetas superiores de columnas (Potencia %)
  powerValues.forEach((p, c) => {
    const cx = roundMm(gridOriginXMm + c * (cellSize + gap) + cellSize / 2);
    nodes.push(
      `  <text x="${cx}" y="${gridOriginYMm - 3}" text-anchor="middle" font-family="monospace" font-size="2.8" fill="#000000">${p}%</text>`
    );
  });

  // Etiquetas izquierdas de filas (Velocidad mm/s)
  speedValues.forEach((s, r) => {
    const cy = roundMm(gridOriginYMm + r * (cellSize + gap) + cellSize / 2 + 1);
    nodes.push(
      `  <text x="${gridOriginXMm - 2.5}" y="${cy}" text-anchor="end" font-family="monospace" font-size="2.6" fill="#000000">${s}mm/s</text>`
    );
  });

  // Celdas de la matriz con el color de su capa LightBurn
  for (const cell of cells) {
    if (isEngrave) {
      nodes.push(
        `  <rect x="${cell.xMm}" y="${cell.yMm}" width="${cell.sizeMm}" height="${cell.sizeMm}" fill="${cell.hexColor}" stroke="${cell.hexColor}" stroke-width="0.1" data-layer="${cell.layerCode}" data-speed="${cell.speedMmPerSec}" data-power="${cell.maxPowerPercent}" />`
      );
    } else {
      nodes.push(
        `  <rect x="${cell.xMm}" y="${cell.yMm}" width="${cell.sizeMm}" height="${cell.sizeMm}" fill="none" stroke="${cell.hexColor}" stroke-width="0.15" data-layer="${cell.layerCode}" data-speed="${cell.speedMmPerSec}" data-power="${cell.maxPowerPercent}" />`
      );
    }
  }

  const safeMat =
    materialName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Material';

  const svgContent = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidthMm}mm" height="${totalHeightMm}mm" viewBox="0 0 ${totalWidthMm} ${totalHeightMm}">`,
    `  <title>Matriz Calibración ${isEngrave ? 'Grabado' : 'Corte'} — ${xmlEscape(materialName)}</title>`,
    ...nodes,
    `</svg>`,
  ].join('\n');

  return {
    svgContent,
    filenameSuggested: `Matriz_Calibracion_${isEngrave ? 'Grabado' : 'Corte'}_${safeMat}.svg`,
  };
}

// ============================================================================
// BIBLIOTECA DE MATERIALES (LIGHTBURN MATERIAL LIBRARY)
// ============================================================================

export function loadMaterialLibrary(): SavedMaterialLibraryEntry[] {
  try {
    const raw = localStorage.getItem(MATERIAL_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMaterialLibraryEntry(
  entry: SavedMaterialLibraryEntry
): SavedMaterialLibraryEntry[] {
  const existing = loadMaterialLibrary().filter((e) => e.id !== entry.id);
  const next = [entry, ...existing];
  try {
    localStorage.setItem(MATERIAL_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Fallback silencioso si localStorage está restringido
  }
  return next;
}

export function deleteMaterialLibraryEntry(id: string): SavedMaterialLibraryEntry[] {
  const next = loadMaterialLibrary().filter((e) => e.id !== id);
  try {
    localStorage.setItem(MATERIAL_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Fallback silencioso
  }
  return next;
}

/**
 * Aplica una entrada guardada de la Biblioteca de Materiales a las capas C00, C01 y C02.
 */
export function applyLibraryEntryToWorkbenchLayers(
  entry: SavedMaterialLibraryEntry,
  layers: WorkbenchLayerConfig[]
): WorkbenchLayerConfig[] {
  return layers.map((l) => {
    if (l.role === 'ENGRAVE') {
      return {
        ...l,
        mode: entry.engrave.mode,
        speedMmPerSec: entry.engrave.speedMmPerSec,
        maxPowerPercent: entry.engrave.maxPowerPercent,
        minPowerPercent: entry.engrave.minPowerPercent,
        lineIntervalMm: entry.engrave.lineIntervalMm,
        passes: entry.engrave.passes,
        airAssist: entry.engrave.airAssist,
        imageDitherMode: entry.engrave.imageDitherMode,
        operatorValidated: true,
      };
    }
    if (l.role === 'HOLES') {
      return {
        ...l,
        mode: 'line',
        speedMmPerSec: entry.holes.speedMmPerSec,
        maxPowerPercent: entry.holes.maxPowerPercent,
        minPowerPercent: entry.holes.minPowerPercent,
        passes: entry.holes.passes,
        airAssist: entry.holes.airAssist,
        operatorValidated: true,
      };
    }
    if (l.role === 'CUT') {
      return {
        ...l,
        mode: 'line',
        speedMmPerSec: entry.cut.speedMmPerSec,
        maxPowerPercent: entry.cut.maxPowerPercent,
        minPowerPercent: entry.cut.minPowerPercent,
        passes: entry.cut.passes,
        airAssist: entry.cut.airAssist,
        kerfOffsetMm: entry.cut.kerfOffsetMm,
        operatorValidated: true,
      };
    }
    return l;
  });
}
