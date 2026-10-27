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
import { INITIAL_MATERIALS_CATALOG } from '../src/core/materials/materialsCatalog';
import { computeNestingLayout, DEFAULT_NESTING_CONFIG } from '../src/core/nesting/nestingEngine';
import {
  createBlankLabelDesign,
  createReference20x10LabelDesign,
} from '../src/core/projects/projectManager';

const outDir200 = path.resolve(process.cwd(), 'exports/muestra_200_etiquetas_20x10mm');
const outDirKit = path.resolve(process.cwd(), 'exports/kit_validacion_lightburn_rdworks');
fs.mkdirSync(outDir200, { recursive: true });
fs.mkdirSync(outDirKit, { recursive: true });

const material = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;

// 1. Lote de 200 etiquetas de 20x10 mm (con 2 agujeros laterales para validar las 3 capas 00, 01 y 02)
const design200 = createReference20x10LabelDesign(true);
const nesting200 = computeNestingLayout(design200, {
  ...DEFAULT_NESTING_CONFIG,
  requestedQuantity: 200,
  sheetWidthMm: 900,
  sheetHeightMm: 600,
  gapXMm: 2.0,
  gapYMm: 2.0,
  marginTopMm: 5.0,
  marginRightMm: 5.0,
  marginBottomMm: 5.0,
  marginLeftMm: 5.0,
  rotationMode: 'auto_optimize',
});

const svgCombined = exportProductionSvg(design200, nesting200, material, {
  mode: 'combined',
  batchIndex: 0,
});
const svgEngraveOnly = exportProductionSvg(design200, nesting200, material, {
  mode: 'engrave_only',
  batchIndex: 0,
});
const svgCutOnly = exportProductionSvg(design200, nesting200, material, {
  mode: 'cut_only',
  batchIndex: 0,
});
const dxfArtifact = exportProductionDxf(design200, nesting200, 0);
const summary = generateProductionSummaryReport({
  project: {
    projectName: 'Muestra Reproducible 200 Etiquetas Ecocuero 20×10 mm',
    clientName: 'LaserHouse Producción',
    notes: 'Generado y auditado automáticamente por LaserHouse Studio.',
  },
  design: design200,
  material,
  nesting: nesting200,
  batchIndex: 0,
});

const validation200 = validateLabelAndBatchGeometry(design200, nesting200, 0);
const svgAudit200 = parseAndAuditLightBurnSvg(svgCombined.svgContent);
const dxfAudit200 = parseAndAuditDxfR12(dxfArtifact.dxfContent);

fs.writeFileSync(path.join(outDir200, svgCombined.filenameSuggested), svgCombined.svgContent, 'utf8');
fs.writeFileSync(path.join(outDir200, svgEngraveOnly.filenameSuggested), svgEngraveOnly.svgContent, 'utf8');
fs.writeFileSync(path.join(outDir200, svgCutOnly.filenameSuggested), svgCutOnly.svgContent, 'utf8');
fs.writeFileSync(path.join(outDir200, dxfArtifact.filenameSuggested), dxfArtifact.dxfContent, 'utf8');
fs.writeFileSync(path.join(outDir200, summary.filenameSuggested), summary.reportText, 'utf8');
fs.writeFileSync(
  path.join(outDir200, 'auditoria_geometrica_200u.json'),
  JSON.stringify({ validation200, svgAudit200, dxfAudit200 }, null, 2),
  'utf8'
);

// 2. Kit de Calibración Física para Importación Manual en LightBurn y RDWorks
// Caso A: 1 etiqueta de 20x10 mm SIN agujeros en recorte de 50x30 mm (fácil de medir al instante en la barra superior de LightBurn)
const designSingleNoHoles = createBlankLabelDesign(20, 10, 'rounded_rect');
const nestingSingle = computeNestingLayout(designSingleNoHoles, {
  ...DEFAULT_NESTING_CONFIG,
  requestedQuantity: 1,
  sheetWidthMm: 50,
  sheetHeightMm: 30,
  marginLeftMm: 5,
  marginTopMm: 5,
  marginRightMm: 5,
  marginBottomMm: 5,
});
const svgSingle = exportProductionSvg(designSingleNoHoles, nestingSingle, material, {
  mode: 'combined',
  batchIndex: 0,
});
const dxfSingle = exportProductionDxf(designSingleNoHoles, nestingSingle, 0);
fs.writeFileSync(
  path.join(outDirKit, '01_Calibracion_1u_20x10mm_SinAgujeros.svg'),
  svgSingle.svgContent,
  'utf8'
);
fs.writeFileSync(
  path.join(outDirKit, '01_Calibracion_1u_20x10mm_SinAgujeros.dxf'),
  dxfSingle.dxfContent,
  'utf8'
);

// Caso B: Recorte de 400x300 mm con 100 etiquetas de 20x10 mm y 2 agujeros
const nesting400x300 = computeNestingLayout(design200, {
  ...DEFAULT_NESTING_CONFIG,
  requestedQuantity: 100,
  sheetWidthMm: 400,
  sheetHeightMm: 300,
  gapXMm: 2.0,
  gapYMm: 2.0,
  marginTopMm: 5.0,
  marginRightMm: 5.0,
  marginBottomMm: 5.0,
  marginLeftMm: 5.0,
});
const svg400x300 = exportProductionSvg(design200, nesting400x300, material, {
  mode: 'combined',
  batchIndex: 0,
});
const dxf400x300 = exportProductionDxf(design200, nesting400x300, 0);
fs.writeFileSync(
  path.join(outDirKit, '02_Recorte_400x300mm_100u_20x10mm_ConAgujeros.svg'),
  svg400x300.svgContent,
  'utf8'
);
fs.writeFileSync(
  path.join(outDirKit, '02_Recorte_400x300mm_100u_20x10mm_ConAgujeros.dxf'),
  dxf400x300.dxfContent,
  'utf8'
);

console.log('=== GENERACIÓN Y AUDITORÍA INDEPENDIENTE SVG/DXF COMPLETADA ===');
console.log('1. Directorio 200u:', outDir200);
console.log('2. Directorio Kit Calibración LightBurn/RDWorks:', outDirKit);
console.log('Validación Geométrica:', validation200.isValid ? 'APROBADA' : 'FALLÓ');
console.log('Lector Independiente SVG (LightBurn):', svgAudit200.isValid ? 'APROBADO (1:1 mm)' : 'FALLÓ');
console.log('Lector Independiente DXF R12 (RDWorks):', dxfAudit200.isValid ? 'APROBADO (AC1009, 0.000mm gap)' : 'FALLÓ');
console.log('Medida 1ª pieza leída directamente de los vértices DXF:', dxfAudit200.firstCutPieceSizeMm);

if (!validation200.isValid || !svgAudit200.isValid || !dxfAudit200.isValid) {
  process.exit(1);
}
