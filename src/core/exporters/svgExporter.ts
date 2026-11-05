import {sharedCutLines} from '../geometry/sharedCuts';
import { assertProductionGeometry, compileLabelGeometry, roundMm } from '../geometry/geometryEngine';
import {
  LabelDesign,
  LIGHTBURN_LAYERS,
  MaterialProfile,
  NestingResult,
} from '../types';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/--/g, '—');
}

export type SvgExportMode = 'combined' | 'engrave_only' | 'cut_only';

export interface SvgExportOptions {
  mode: SvgExportMode;
  batchIndex?: number;
  /** Si es true, el lienzo SVG tendrá el tamaño del bloque ocupado; si es false (por defecto), tendrá el tamaño exacto de la plancha/recorte en mm */
  cropToOccupiedBounds?: boolean;
  /** Si es true, invierte horizontalmente el arte para grabado trasero (ej. Acrílico Espejo) */
  mirrorHorizontally?: boolean;
}

export interface SvgExportArtifact {
  svgContent: string;
  filenameSuggested: string;
  widthMm: number;
  heightMm: number;
  batchNumber: number;
  totalBatches: number;
  pieceCount: number;
  engravePathCount: number;
  holeContourCount: number;
  cutContourCount: number;
}

/**
 * Genera un archivo SVG de producción con dimensiones físicas exactas en milímetros (1 unidad viewBox = 1 mm real),
 * estructurado específicamente para importación limpia en LightBurn Pro (y compatible con RDWorks / Illustrator / Inkscape).
 *
 * Mapeo de colores estándar de la paleta de LightBurn:
 * - #000000 (Capa C00): GRABADO (Engrave / Fill o Line)
 * - #0000FF (Capa C01): AGUJEROS INTERNOS (Inner Cut — se ejecuta antes del corte perimetral)
 * - #FF0000 (Capa C02): CORTE EXTERIOR (Outer Cut)
 *
 * NOTA TÉCNICA: Las guías no productivas NUNCA se incluyen en el SVG de producción.
 * Todos los elementos vectoriales de grabado incluyen tanto `stroke="#000000"` como `fill` apropiado
 * para garantizar que LightBurn los asigne siempre a la capa C00 sin importar la preferencia de importación.
 */
export function exportProductionSvg(
  design: LabelDesign,
  nesting: NestingResult,
  material: MaterialProfile,
  options: SvgExportOptions = { mode: 'combined', batchIndex: 0 }
): SvgExportArtifact {
  assertProductionGeometry(design, nesting, options.batchIndex ?? 0);
  const bIdx = options.batchIndex ?? 0;
  const batch = nesting.batches[bIdx] || nesting.batches[0];

  if (!batch || batch.placedInstances.length === 0) {
    const emptyW = roundMm(nesting.config.sheetWidthMm);
    const emptyH = roundMm(nesting.config.sheetHeightMm);
    return {
      svgContent: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${emptyW}mm" height="${emptyH}mm" viewBox="0 0 ${emptyW} ${emptyH}"></svg>`,
      filenameSuggested: `${sanitizeName(design.name)}_vacio.svg`,
      widthMm: emptyW,
      heightMm: emptyH,
      batchNumber: 1,
      totalBatches: 0,
      pieceCount: 0,
      engravePathCount: 0,
      holeContourCount: 0,
      cutContourCount: 0,
    };
  }

  const canvasWidthMm = options.cropToOccupiedBounds
    ? roundMm(batch.occupiedBounds.maxX + nesting.config.marginRightMm)
    : roundMm(nesting.config.sheetWidthMm);
  const canvasHeightMm = options.cropToOccupiedBounds
    ? roundMm(batch.occupiedBounds.maxY + nesting.config.marginBottomMm)
    : roundMm(nesting.config.sheetHeightMm);

  const includeEngrave = options.mode === 'combined' || options.mode === 'engrave_only';
  const includeCut = options.mode === 'combined' || options.mode === 'cut_only';

  const engraveNodes: string[] = [];
  const holeNodes: string[] = [];
  const cutNodes: string[] = [];

  let engravePathCount = 0;
  let holeContourCount = 0;
  let cutContourCount = 0;

  for (const inst of batch.placedInstances) {
    const compiled = compileLabelGeometry(design, {
      offsetXMm: inst.xMm,
      offsetYMm: inst.yMm,
      rotated90: inst.rotated90,
      instanceIdPrefix: `pieza_${inst.instanceIndex}`,
    });

    if (includeEngrave) {
      for (const eng of compiled.engravingItems) {
        if (eng.kind === 'vector_path' && eng.svgPathD) {
          engravePathCount++;
          if (eng.filled) {
            engraveNodes.push(
              `    <path id="${xml(eng.id)}" d="${eng.svgPathD}" fill="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" fill-rule="${eng.fillRule || 'evenodd'}" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="0.05" />`
            );
          } else {
            const sw = roundMm(eng.strokeWidthMm || 0.3);
            engraveNodes.push(
              `    <path id="${xml(eng.id)}" d="${eng.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`
            );
          }
        } else if (eng.kind === 'raster_image' && eng.dataUrl) {
          engravePathCount++;
          const rotAttr = eng.rotationDeg
            ? ` transform="rotate(${eng.rotationDeg} ${roundMm((eng.xMm || 0) + (eng.widthMm || 0) / 2)} ${roundMm((eng.yMm || 0) + (eng.heightMm || 0) / 2)})"`
            : '';
          engraveNodes.push(
            `    <image id="${xml(eng.id)}" x="${eng.xMm}" y="${eng.yMm}" width="${eng.widthMm}" height="${eng.heightMm}" preserveAspectRatio="none" href="${xml(eng.dataUrl)}"${rotAttr} />`
          );
        }
      }
    }

    if (includeCut) {
      for (const hole of compiled.holeContours) {
        holeContourCount++;
        holeNodes.push(
          `    <path id="${xml(hole.id)}" d="${hole.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.HOLES.hexColor}" stroke-width="0.1" />`
        );
      }

      cutContourCount++;
      if (!nesting.config.sharedCutLines) cutNodes.push(
        `    <path id="${xml(compiled.outerCutContour.id)}" d="${compiled.outerCutContour.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.CUT.hexColor}" stroke-width="0.1" />`
      );
    }
  }

  if (includeCut && nesting.config.sharedCutLines) {
    for (const [index,[a,b]] of sharedCutLines(batch.placedInstances.map(i=>i.boundingBox)).entries()) {
      cutNodes.push(`    <path id="shared-cut-${index}" d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="#FF0000" stroke-width="0.1" />`);
    }
  }
  const mirrorOpen =
    options.mirrorHorizontally || material.mirrorArtworkForBackEngrave
      ? `  <g id="ESPEJADO_HORIZONTAL" transform="translate(${canvasWidthMm}, 0) scale(-1, 1)">\n`
      : '';
  const mirrorClose =
    options.mirrorHorizontally || material.mirrorArtworkForBackEngrave ? `  </g>\n` : '';

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!--`,
    `  =============================================================================`,
    `  ASTRA STUDIO — ARCHIVO DE PRODUCCIÓN VECTORIAL (ESCALA REAL 1:1 EN MM)`,
    `  =============================================================================`,
    `  Máquina destino : Vank 9060 CO2 (Área útil máx: 900 x 600 mm | Controladora Ruida RDC8445S)`,
    `  Software destino: LightBurn Pro / RDWorks`,
    `  Diseño etiqueta : ${xml(design.name)} (${design.widthMm} x ${design.heightMm} mm | Forma: ${design.shape})`,
    `  Compensación Kerf: ${design.kerfCompensationMm} mm`,
    `  Material        : ${xml(material.name)} (${xml(material.code)}, Espesor: ${material.thicknessMm} mm)`,
    `  Tanda           : ${batch.batchNumber} de ${batch.totalBatches}`,
    `  Cantidad en archivo: ${batch.count} unidades (Total pedido: ${nesting.totalRequestedQuantity} u.)`,
    `  Dimensiones lienzo : ${canvasWidthMm} mm x ${canvasHeightMm} mm (1 unidad SVG = 1.0000 mm)`,
    `  Mapeo de Capas LightBurn:`,
    `    - Capa 00 (#000000 Negro) : GRABADO (${engravePathCount} elementos)`,
    `    - Capa 01 (#0000FF Azul)  : AGUJEROS INTERNOS (${holeContourCount} contornos cerrados)`,
    `    - Capa 02 (#FF0000 Rojo)  : CORTE EXTERIOR (${cutContourCount} piezas; ${nesting.config.sharedCutLines ? 'líneas compartidas abiertas' : 'contornos cerrados'})`,
    `  =============================================================================`,
    `-->`,
    `<svg data-cut-mode="${nesting.config.sharedCutLines ? 'shared' : 'individual'}"`,
    `  xmlns="http://www.w3.org/2000/svg"`,
    `  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
    `  width="${canvasWidthMm}mm"`,
    `  height="${canvasHeightMm}mm"`,
    `  viewBox="0 0 ${canvasWidthMm} ${canvasHeightMm}"`,
    `  version="1.1"`,
    `  data-generator="Astra Studio v0.2.0"`,
    `  data-units="mm"`,
    `  data-label-width-mm="${design.widthMm}"`,
    `  data-label-height-mm="${design.heightMm}"`,
    `  data-batch="${batch.batchNumber}/${batch.totalBatches}"`,
    `  data-quantity="${batch.count}"`,
    `>`,
  ];

  if (mirrorOpen) lines.push(mirrorOpen.trimEnd());

  if (includeEngrave && engraveNodes.length > 0) {
    lines.push(
      `  <g id="CAPA_00_GRABADO" inkscape:groupmode="layer" inkscape:label="00_GRABADO" data-layer="ENGRAVE" data-lightburn-layer="00">`,
      ...engraveNodes,
      `  </g>`
    );
  }

  if (includeCut && holeNodes.length > 0) {
    lines.push(
      `  <g id="CAPA_01_AGUJEROS" inkscape:groupmode="layer" inkscape:label="01_AGUJEROS" data-layer="HOLES" data-lightburn-layer="01">`,
      ...holeNodes,
      `  </g>`
    );
  }

  if (includeCut && cutNodes.length > 0) {
    lines.push(
      `  <g id="CAPA_02_CORTE" inkscape:groupmode="layer" inkscape:label="02_CORTE" data-layer="CUT" data-lightburn-layer="02">`,
      ...cutNodes,
      `  </g>`
    );
  }

  if (mirrorClose) lines.push(mirrorClose.trimEnd());
  lines.push(`</svg>`);

  const modeSuffix =
    options.mode === 'combined'
      ? 'PRODUCCION_COMPLETA'
      : options.mode === 'engrave_only'
      ? 'SOLO_GRABADO'
      : 'SOLO_CORTE';

  const filenameSuggested = `${sanitizeName(design.name)}_${design.widthMm}x${design.heightMm}mm_${batch.count}u_Tanda${batch.batchNumber}de${batch.totalBatches}_${modeSuffix}.svg`;

  return {
    svgContent: lines.join('\n'),
    filenameSuggested,
    widthMm: canvasWidthMm,
    heightMm: canvasHeightMm,
    batchNumber: batch.batchNumber,
    totalBatches: batch.totalBatches,
    pieceCount: batch.count,
    engravePathCount,
    holeContourCount,
    cutContourCount,
  };
}

function sanitizeName(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Etiqueta_Astra'
  );
}
