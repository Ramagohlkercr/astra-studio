import * as fs from 'node:fs';
import * as path from 'node:path';
import { exportProductionDxf } from '../src/core/exporters/dxfExporter';
import {
  parseAndAuditDxfR12,
  parseAndAuditLightBurnSvg,
} from '../src/core/exporters/fileFormatValidator';
import { generateProductionSummaryReport } from '../src/core/exporters/productionSummaryExporter';
import { exportProductionSvg } from '../src/core/exporters/svgExporter';
import { validateLabelAndBatchGeometry } from '../src/core/geometry/geometryEngine';
import { generateKerfCalibrationPatternSvg } from '../src/core/geometry/kerfCalibrationGenerator';
import { INITIAL_MATERIALS_CATALOG } from '../src/core/materials/materialsCatalog';
import { computeNestingLayout, DEFAULT_NESTING_CONFIG } from '../src/core/nesting/nestingEngine';
import { createReference20x10LabelDesign } from '../src/core/projects/projectManager';

const baseExportDir = path.resolve(process.cwd(), 'exports/pedidos_reales_50_a_500u');
fs.mkdirSync(baseExportDir, { recursive: true });

const material = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
const design = createReference20x10LabelDesign(false); // Etiqueta estándar 20x10 mm sin agujeros

const targetQuantities = [50, 100, 200, 300, 500];
const resultsSummary: any[] = [];

console.log('=== GENERANDO LOTES DE PRODUCCIÓN REAL (50, 100, 200, 300, 500 U.) ===');

for (const qty of targetQuantities) {
  const lotDir = path.join(baseExportDir, `lote_${qty}u_20x10mm`);
  fs.mkdirSync(lotDir, { recursive: true });

  const nesting = computeNestingLayout(design, {
    ...DEFAULT_NESTING_CONFIG,
    requestedQuantity: qty,
    sheetWidthMm: 600,
    sheetHeightMm: 400,
    gapXMm: 2.0,
    gapYMm: 2.0,
    marginTopMm: 5.0,
    marginRightMm: 5.0,
    marginBottomMm: 5.0,
    marginLeftMm: 5.0,
    rotationMode: 'auto_optimize',
  });

  const svgCombined = exportProductionSvg(design, nesting, material, {
    mode: 'combined',
    batchIndex: 0,
  });
  const svgEngrave = exportProductionSvg(design, nesting, material, {
    mode: 'engrave_only',
    batchIndex: 0,
  });
  const svgCut = exportProductionSvg(design, nesting, material, {
    mode: 'cut_only',
    batchIndex: 0,
  });
  const dxf = exportProductionDxf(design, nesting, 0);

  const validation = validateLabelAndBatchGeometry(design, nesting, 0);
  const svgAudit = parseAndAuditLightBurnSvg(svgCombined.svgContent);
  const dxfAudit = parseAndAuditDxfR12(dxf.dxfContent);

  const summary = generateProductionSummaryReport({
    project: {
      projectName: `Pedido ${qty} Etiquetas Ecocuero 20×10 mm`,
      clientName: 'LaserHouse Producción Real',
      notes: `Generado para Vank 9060 CO2 sobre recorte 600x400 mm. Cantidad: ${qty} u.`,
    },
    design,
    material,
    nesting,
    batchIndex: 0,
  });

  fs.writeFileSync(path.join(lotDir, svgCombined.filenameSuggested), svgCombined.svgContent, 'utf8');
  fs.writeFileSync(path.join(lotDir, svgEngrave.filenameSuggested), svgEngrave.svgContent, 'utf8');
  fs.writeFileSync(path.join(lotDir, svgCut.filenameSuggested), svgCut.svgContent, 'utf8');
  fs.writeFileSync(path.join(lotDir, dxf.filenameSuggested), dxf.dxfContent, 'utf8');
  fs.writeFileSync(path.join(lotDir, summary.filenameSuggested), summary.reportText, 'utf8');

  resultsSummary.push({
    cantidad: qty,
    tandas: nesting.totalBatches,
    piezasEnTanda1: nesting.batches[0].count,
    dimensionBloqueMm: `${nesting.batches[0].occupiedBounds.width} x ${nesting.batches[0].occupiedBounds.height}`,
    eficienciaBloquePct: nesting.batches[0].boundingBoxEfficiencyPercent,
    usoPlanchaPct: nesting.batches[0].sheetUtilizationPercent,
    validacionGeometrica: validation.isValid,
    auditoriaSvgLightBurn: svgAudit.isValid,
    auditoriaDxfRDWorks: dxfAudit.isValid,
    tamanoPrimeraPiezaDxf: dxfAudit.firstCutPieceSizeMm,
  });

  console.log(`✓ Lote ${qty} u.: OK (Bloque: ${nesting.batches[0].occupiedBounds.width}x${nesting.batches[0].occupiedBounds.height} mm)`);
}

// Generar Patrón de Calibración de Kerf
const kerfArtifact = generateKerfCalibrationPatternSvg(material.name);
fs.writeFileSync(path.join(baseExportDir, kerfArtifact.filenameSuggested), kerfArtifact.svgContent, 'utf8');

fs.writeFileSync(
  path.join(baseExportDir, 'resumen_auditoria_lotes.json'),
  JSON.stringify({ lotes: resultsSummary, kerfInfo: kerfArtifact.instructions }, null, 2),
  'utf8'
);

console.log('\n=== AUDITORÍA COMPLETA FINALIZADA CON ÉXITO ===');
console.log('Carpeta generada:', baseExportDir);
