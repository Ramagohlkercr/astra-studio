/**
 * Astra Studio — Exportador Nativo de Proyecto LightBurn (.lbrn2), SVG y DXF de Mesa Completa
 * Convierte todos los trabajos posicionados en la plancha/mesa Vank 9060 y sus capas C00..C29
 * en archivos de producción listos para LightBurn Pro o RDWorks.
 */

import { rasterImageTransform, roundMm } from '../geometry/geometryEngine';
import { LIGHTBURN_LAYERS, Point2D } from '../types';
import { validateWorkbenchState } from './workbenchEngine';
import {
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
} from './workbenchTypes';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface Lbrn2ExportArtifact {
  lbrn2Content: string;
  filenameSuggested: string;
  jobCount: number;
  pieceCount: number;
  shapeCount: number;
  configuredLayersCount: number;
}

/**
 * Construye un nodo <Shape Type="Path"> compatible con LightBurn (.lbrn / .lbrn2)
 * a partir de una polilínea cerrada o abierta en coordenadas absolutas de mesa (mm).
 */
function buildLightBurnPathShapeXml(
  points: Point2D[],
  closed: boolean,
  cutIndex: number,
  offsetX: number,
  offsetY: number
): string {
  if (points.length < 2) return '';

  const verticesXml: string[] = [];
  const primsXml: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const vx = roundMm(offsetX + points[i].x, 3);
    const vy = roundMm(offsetY + points[i].y, 3);
    verticesXml.push(`      <V vx="${vx}" vy="${vy}"/>`);
    if (i > 0) {
      primsXml.push(`      <P T="L" p0="${i - 1}" p1="${i}"/>`);
    }
  }

  if (closed && points.length > 2) {
    primsXml.push(`      <P T="L" p0="${points.length - 1}" p1="0"/>`);
  }

  return [
    `  <Shape Type="Path" CutIndex="${cutIndex}">`,
    `    <XForm>1 0 0 1 0 0</XForm>`,
    ...verticesXml,
    ...primsXml,
    `  </Shape>`,
  ].join('\n');
}

/**
 * Construye un nodo <CutSetting> para LightBurn reflejando los parámetros de la capa.
 * REGLA DE SEGURIDAD: Si el operador no ingresó velocidad o potencia (null), NO se inventan
 * valores numéricos arbitrarios; sólo se serializan los parámetros explícitamente configurados.
 */
function buildCutSettingXml(layer: WorkbenchLayerConfig): string {
  const cutType =
    layer.mode === 'image'
      ? 'Image'
      : layer.mode === 'fill'
        ? 'Scan'
        : layer.mode === 'offset_fill'
          ? 'Offset'
          : 'Cut';

  const lines: string[] = [
    `  <CutSetting type="${cutType}">`,
    `    <index Value="${layer.cutIndex}"/>`,
    `    <name Value="${xmlEscape(`${layer.code} ${layer.name}`)}"/>`,
    `    <priority Value="${layer.priority}"/>`,
    `    <doOutput Value="${layer.outputEnabled ? 1 : 0}"/>`,
    `    <hide Value="${layer.visible ? 0 : 1}"/>`,
    `    <runBlower Value="${layer.airAssist ? 1 : 0}"/>`,
    `    <numPasses Value="${Math.max(1, layer.passes)}"/>`,
  ];

  if (layer.speedMmPerSec !== null && layer.speedMmPerSec > 0) {
    lines.push(`    <speed Value="${roundMm(layer.speedMmPerSec, 2)}"/>`);
  }
  if (layer.maxPowerPercent !== null && layer.maxPowerPercent > 0) {
    lines.push(`    <maxPower Value="${roundMm(layer.maxPowerPercent, 2)}"/>`);
  }
  if (layer.minPowerPercent !== null && layer.minPowerPercent >= 0) {
    lines.push(`    <minPower Value="${roundMm(layer.minPowerPercent, 2)}"/>`);
  } else if (layer.maxPowerPercent !== null && layer.maxPowerPercent > 0) {
    lines.push(`    <minPower Value="${roundMm(layer.maxPowerPercent, 2)}"/>`);
  }

  if (layer.mode === 'fill' || layer.mode === 'image' || layer.mode === 'offset_fill') {
    lines.push(`    <interval Value="${roundMm(layer.lineIntervalMm || 0.073, 4)}"/>`);
    lines.push(`    <angle Value="${roundMm(layer.scanAngleDeg || 0, 1)}"/>`);
    lines.push(`    <bidir Value="${layer.bidirectional === false ? 0 : 1}"/>`);
    if (layer.crossHatch) {
      lines.push(`    <crossHatch Value="1"/>`);
    }
    if (layer.overscanPercent !== undefined && layer.overscanPercent > 0) {
      lines.push(`    <overscan Value="1"/>`);
      lines.push(`    <overscanPercent Value="${roundMm(layer.overscanPercent, 2)}"/>`);
    }
    if (layer.imageDitherMode) {
      lines.push(`    <ditherMode Value="${layer.imageDitherMode}"/>`);
    }
  } else if (layer.mode === 'line') {
    if (layer.kerfOffsetMm && Math.abs(layer.kerfOffsetMm) > 0.001) {
      lines.push(`    <kerf Value="${roundMm(layer.kerfOffsetMm, 3)}"/>`);
    }
    if (layer.overcutMm && layer.overcutMm > 0.001) {
      lines.push(`    <overcut Value="${roundMm(layer.overcutMm, 3)}"/>`);
    }
  }

  lines.push(`  </CutSetting>`);
  return lines.join('\n');
}

/**
 * Exporta toda la Mesa de Trabajo / Plancha a un archivo de proyecto LightBurn (.lbrn2).
 */
export function exportWorkbenchToLbrn2(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  projectName = 'Mesa_Vank_9060'
): Lbrn2ExportArtifact {
  const report = validateWorkbenchState(jobs, config);
  if (!report.isValidForExport) {
    const firstErr =
      report.issues.find((i) => i.severity === 'error')?.message ||
      'La mesa de trabajo contiene errores geométricos.';
    throw new Error(`Exportación .lbrn2 bloqueada: ${firstErr}`);
  }

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const cutSettingsXml = config.layers.map((layer) => buildCutSettingXml(layer));

  const engraveLayer = config.layers.find((l) => l.role === 'ENGRAVE') ?? config.layers[0];
  const holesLayer = config.layers.find((l) => l.role === 'HOLES') ?? config.layers[1];
  const cutLayer = config.layers.find((l) => l.role === 'CUT') ?? config.layers[2];

  const shapesXml: string[] = [];
  let shapeCount = 0;

  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      // 1. Elementos de Grabado (Capa C00)
      for (const eng of inst.engraveItems) {
        if (eng.kind === 'vector_path' && eng.polylines && eng.polylines.length > 0) {
          for (const poly of eng.polylines) {
            const xmlShape = buildLightBurnPathShapeXml(
              poly.points,
              poly.closed,
              engraveLayer.cutIndex,
              job.xMm,
              job.yMm
            );
            if (xmlShape) {
              shapesXml.push(xmlShape);
              shapeCount++;
            }
          }
        } else if (eng.kind === 'raster_image' && eng.dataUrl) {
          const base64Match = eng.dataUrl.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
          const base64Data = base64Match ? base64Match[1] : '';
          const w = roundMm(eng.widthMm ?? 10, 3);
          const h = roundMm(eng.heightMm ?? 10, 3);
          const cx = roundMm(job.xMm + (eng.xMm ?? 0) + w / 2, 3);
          const cy = roundMm(job.yMm + (eng.yMm ?? 0) + h / 2, 3);

          shapesXml.push(
            [
              `  <Shape Type="Bitmap" CutIndex="${engraveLayer.cutIndex}" W="${w}" H="${h}" Data="${base64Data}">`,
              `    <XForm>1 0 0 1 ${cx} ${cy}</XForm>`,
              `  </Shape>`,
            ].join('\n')
          );
          shapeCount++;
        }
      }

      // 2. Agujeros Internos (Capa C01)
      for (const hole of inst.holeContours) {
        const xmlShape = buildLightBurnPathShapeXml(
          hole.points,
          true,
          holesLayer.cutIndex,
          job.xMm,
          job.yMm
        );
        if (xmlShape) {
          shapesXml.push(xmlShape);
          shapeCount++;
        }
      }

      // 3. Contorno de Corte Exterior (Capa C02)
      if (inst.cutContour && inst.cutContour.points.length > 0) {
        const xmlShape = buildLightBurnPathShapeXml(
          inst.cutContour.points,
          true,
          cutLayer.cutIndex,
          job.xMm,
          job.yMm
        );
        if (xmlShape) {
          shapesXml.push(xmlShape);
          shapeCount++;
        }
      }
    }
  }

  const configuredLayersCount = config.layers.filter(
    (l) => l.outputEnabled && l.speedMmPerSec !== null && l.maxPowerPercent !== null
  ).length;

  const safeName =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Mesa_Vank_9060';

  const lbrn2Content = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="1.4.00" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    `  <VariableText>`,
    `    <Start Value="0"/>`,
    `    <End Value="999"/>`,
    `    <Current Value="0"/>`,
    `    <Increment Value="1"/>`,
    `  </VariableText>`,
    `  <UIPrefs>`,
    `    <Optimize_ByLayer Value="0"/>`,
    `    <Optimize_ByGroup Value="-1"/>`,
    `    <Optimize_ByPriority Value="1"/>`,
    `    <Optimize_InnerToOuter Value="${config.optimizeInsideOut ? 1 : 0}"/>`,
    `  </UIPrefs>`,
    ...cutSettingsXml,
    ...shapesXml,
    `  <Notes ShowOnLoad="0" Notes="${xmlEscape(
      `Generado por Astra Studio — Mesa Vank 9060 (${config.sheetWidthMm}x${config.sheetHeightMm} mm) — ${report.totalPieces} piezas en ${report.totalJobs} trabajo(s).`
    )}"/>`,
    `</LightBurnProject>`,
  ].join('\n');

  return {
    lbrn2Content,
    filenameSuggested: `${safeName}_LightBurn.lbrn2`,
    jobCount: report.totalJobs,
    pieceCount: report.totalPieces,
    shapeCount,
    configuredLayersCount,
  };
}

/**
 * Exporta toda la plancha/mesa con múltiples trabajos a un único SVG 1:1 en milímetros
 * con las capas estándar LightBurn (#000000 C00, #0000FF C01, #FF0000 C02).
 */
export function exportWorkbenchToSvg(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  projectName = 'Plancha_Vank_9060'
): { svgContent: string; filenameSuggested: string; pieceCount: number } {
  const report = validateWorkbenchState(jobs, config);
  if (!report.isValidForExport) {
    const firstErr =
      report.issues.find((i) => i.severity === 'error')?.message ||
      'La mesa de trabajo contiene errores geométricos.';
    throw new Error(`Exportación SVG de plancha bloqueada: ${firstErr}`);
  }

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const engraveLayer = config.layers.find((l) => l.role === 'ENGRAVE');
  const holesLayer = config.layers.find((l) => l.role === 'HOLES');
  const cutLayer = config.layers.find((l) => l.role === 'CUT');

  const includeEngrave = engraveLayer ? engraveLayer.outputEnabled : true;
  const includeHoles = holesLayer ? holesLayer.outputEnabled : true;
  const includeCut = cutLayer ? cutLayer.outputEnabled : true;

  const engraveNodes: string[] = [];
  const holeNodes: string[] = [];
  const cutNodes: string[] = [];

  for (const job of visibleJobs) {
    engraveNodes.push(`    <g id="${xmlEscape(job.id)}_engrave" transform="translate(${job.xMm}, ${job.yMm})">`);
    holeNodes.push(`    <g id="${xmlEscape(job.id)}_holes" transform="translate(${job.xMm}, ${job.yMm})">`);
    cutNodes.push(`    <g id="${xmlEscape(job.id)}_cut" transform="translate(${job.xMm}, ${job.yMm})">`);

    for (const inst of job.instances) {
      if (includeEngrave) {
        for (const eng of inst.engraveItems) {
          if (eng.kind === 'vector_path' && eng.svgPathD) {
            if (eng.filled) {
              engraveNodes.push(
                `      <path d="${eng.svgPathD}" fill="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" fill-rule="${eng.fillRule || 'evenodd'}" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="0.05" />`
              );
            } else {
              const sw = roundMm(eng.strokeWidthMm || 0.3);
              engraveNodes.push(
                `      <path d="${eng.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`
              );
            }
          } else if (eng.kind === 'raster_image' && eng.dataUrl) {
            const rotTransform = rasterImageTransform(eng);
            const rotAttr = rotTransform ? ` transform="${rotTransform}"` : '';
            engraveNodes.push(
              `      <image x="${eng.xMm}" y="${eng.yMm}" width="${eng.widthMm}" height="${eng.heightMm}" preserveAspectRatio="none" href="${xmlEscape(eng.dataUrl)}"${rotAttr} />`
            );
          }
        }
      }

      if (includeHoles) {
        for (const hole of inst.holeContours) {
          holeNodes.push(
            `      <path d="${hole.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.HOLES.hexColor}" stroke-width="0.1" />`
          );
        }
      }

      if (includeCut && inst.cutContour) {
        cutNodes.push(
          `      <path d="${inst.cutContour.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.CUT.hexColor}" stroke-width="0.1" />`
        );
      }
    }

    engraveNodes.push(`    </g>`);
    holeNodes.push(`    </g>`);
    cutNodes.push(`    </g>`);
  }

  const canvasW = roundMm(config.sheetOffsetXMm + config.sheetWidthMm);
  const canvasH = roundMm(config.sheetOffsetYMm + config.sheetHeightMm);

  const safeName =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Plancha_Vank_9060';

  const svgContent = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}mm" height="${canvasH}mm" viewBox="0 0 ${canvasW} ${canvasH}">`,
    `  <title>${xmlEscape(projectName)} — Plancha Vank 9060 (${report.totalPieces} u.)</title>`,
    `  <g id="CAPA_00_GRABADO" data-layer="C00">`,
    ...engraveNodes,
    `  </g>`,
    `  <g id="CAPA_01_AGUJEROS" data-layer="C01">`,
    ...holeNodes,
    `  </g>`,
    `  <g id="CAPA_02_CORTE" data-layer="C02">`,
    ...cutNodes,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return {
    svgContent,
    filenameSuggested: `${safeName}_Plancha_Completa.svg`,
    pieceCount: report.totalPieces,
  };
}
