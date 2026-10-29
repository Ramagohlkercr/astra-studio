import { describe, expect, it } from 'vitest';
import {
  compileLabelGeometry,
  computeSafeEngravingZone,
  detectDuplicateCutSegments,
  fitElementIntoSafeZone,
  roundMm,
  validateLabelAndBatchGeometry,
} from '../geometry/geometryEngine';
import { generateKerfCalibrationPatternSvg } from '../geometry/kerfCalibrationGenerator';
import {
  computeNestingLayout,
  DEFAULT_NESTING_CONFIG,
} from '../nesting/nestingEngine';
import { exportProductionSvg } from '../exporters/svgExporter';
import { exportProductionDxf } from '../exporters/dxfExporter';
import {
  parseAndAuditDxfR12,
  parseAndAuditLightBurnSvg,
} from '../exporters/fileFormatValidator';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import {
  computeEffectiveDpi,
  DEFAULT_IMAGE_PROCESSING,
  parseSvgLogoString,
  processRgbaBufferToBinaryMask,
  traceBinaryMaskToNormalizedPaths,
} from '../image/imageProcessor';
import {
  createBlankLabelDesign,
  createInitialOrdersCatalog,
  createReference20x10LabelDesign,
  deserializeOrderProjectFromJson,
  duplicateOrderWithQuantity,
  MATERIAL_SHEET_PRESETS,
  serializeOrderProjectToJson,
} from '../projects/projectManager';
import { LabelDesign } from '../types';

describe('Astra Studio — Motor Geométrico en Milímetros (Precisión Crítica)', () => {
  const testSizes: Array<{ w: number; h: number; shape: LabelDesign['shape'] }> = [
    { w: 10, h: 10, shape: 'square' },
    { w: 15, h: 15, shape: 'rounded_rect' },
    { w: 10, h: 20, shape: 'rectangle' },
    { w: 20, h: 20, shape: 'circle' },
    { w: 30, h: 15, shape: 'oval' },
    { w: 22.75, h: 11.35, shape: 'rounded_rect' }, // Medidas decimales
  ];

  it.each(testSizes)(
    'compila etiqueta de $w x $h mm ($shape) con dimensiones físicas exactas y contornos cerrados',
    ({ w, h, shape }) => {
      const base = createReference20x10LabelDesign(false);
      const design: LabelDesign = {
        ...base,
        shape,
        widthMm: w,
        heightMm: h,
        cornerRadiusMm: shape === 'rounded_rect' ? 1.5 : 0,
        kerfCompensationMm: 0,
      };

      const compiled = compileLabelGeometry(design);

      expect(compiled.nominalWidthMm).toBe(w);
      expect(compiled.nominalHeightMm).toBe(h);
      expect(compiled.outerCutContour.closed).toBe(true);
      expect(compiled.outerCutContour.svgPathD.trim().endsWith('Z')).toBe(true);
      expect(compiled.outerCutContour.boundingBox.width).toBeCloseTo(w, 3);
      expect(compiled.outerCutContour.boundingBox.height).toBeCloseTo(h, 3);
    }
  );

  it('aplica compensación de Kerf correctamente (expande corte exterior y contrae agujeros internos)', () => {
    const design = createReference20x10LabelDesign(false);
    design.widthMm = 20.5;
    design.heightMm = 10.25;
    design.kerfCompensationMm = 0.16; // 0.08 mm por lado
    design.holes = {
      preset: 'single_left',
      diameterMm: 2.0,
      edgeDistanceMm: 3.0,
      customHoles: [],
    };

    const compiled = compileLabelGeometry(design);
    expect(compiled.effectiveCutWidthMm).toBeCloseTo(20.66, 4);
    expect(compiled.effectiveCutHeightMm).toBeCloseTo(10.41, 4);
    expect(compiled.holeContours).toHaveLength(1);
    expect(compiled.holeContours[0].boundingBox.width).toBeCloseTo(1.84, 3);
  });

  it('conserva las dimensiones de bordes decorativos y logos raster cuando la etiqueta rota 90° en el anidado', () => {
    const catalog = createInitialOrdersCatalog();
    const acrilicoOrder = catalog[1]; // 30 x 15 mm con decorative_border
    const compiledRot90 = compileLabelGeometry(acrilicoOrder.labelDesign, {
      rotated90: true,
    });
    expect(compiledRot90.nominalWidthMm).toBe(15);
    expect(compiledRot90.nominalHeightMm).toBe(30);
    // El marco interior rotado 90° debe quedar dentro de 15 x 30 mm (ancho 10.5 mm, alto 20 mm)
    const borderItem = compiledRot90.engravingItems[0];
    expect(borderItem.boundingBox.width).toBeCloseTo(10.5, 2);
    expect(borderItem.boundingBox.height).toBeCloseTo(20, 2);
  });
});

describe('Astra Studio — Agujeros Opcionales (0, 1, 2, 4 y Personalizados)', () => {
  it('NO agrega agujeros automáticamente al crear una etiqueta nueva', () => {
    const blank = createBlankLabelDesign(25, 12, 'rounded_rect');
    expect(blank.holes.preset).toBe('none');
    const compiled = compileLabelGeometry(blank);
    expect(compiled.holeContours).toHaveLength(0);
  });

  it('soporta 0, 1, 2, 4 y agujeros personalizados con diámetro y distancia al borde editables', () => {
    const design = createBlankLabelDesign(30, 15, 'rounded_rect');

    // 1 agujero izquierdo
    design.holes = { preset: 'single_left', diameterMm: 2.2, edgeDistanceMm: 3.5, customHoles: [] };
    let compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(1);
    expect(compiled.holeContours[0].primitive).toEqual({
      kind: 'circle',
      cx: 3.5,
      cy: 7.5,
      r: 1.1,
    });

    // 2 agujeros horizontales
    design.holes = { preset: 'two_horizontal', diameterMm: 1.8, edgeDistanceMm: 2.5, customHoles: [] };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(2);
    expect(compiled.holeContours[0].boundingBox.minX).toBeCloseTo(2.5 - 0.9, 3);
    expect(compiled.holeContours[1].boundingBox.maxX).toBeCloseTo(30 - 2.5 + 0.9, 3);

    // 4 agujeros en esquinas
    design.holes = { preset: 'four_corners', diameterMm: 1.6, edgeDistanceMm: 2.4, customHoles: [] };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(4);

    // Agujeros personalizados (3 agujeros libres)
    design.holes = {
      preset: 'custom',
      diameterMm: 1.5,
      edgeDistanceMm: 2.0,
      customHoles: [
        { id: 'c1', x: 3.0, y: 4.0, diameterMm: 1.4 },
        { id: 'c2', x: 3.0, y: 11.0, diameterMm: 1.4 },
        { id: 'c3', x: 27.0, y: 7.5, diameterMm: 2.0 },
      ],
    };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(3);
    expect(compiled.holeContours[2].boundingBox.width).toBeCloseTo(2.0, 3);
  });
});

describe('Astra Studio — Distribución Automática y Dimensiones de Material Reales', () => {
  const quantities = [1, 25, 100, 200, 500, 1000];

  it.each(quantities)(
    'distribuye exactamente %i unidades sin superposición ni piezas fuera de la mesa Vank 9060 (900x600 mm)',
    (qty) => {
      const design = createReference20x10LabelDesign(true);
      const config = {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: qty,
        sheetWidthMm: 900,
        sheetHeightMm: 600,
        gapXMm: 2.0,
        gapYMm: 2.0,
        marginTopMm: 5.0,
        marginRightMm: 5.0,
        marginBottomMm: 5.0,
        marginLeftMm: 5.0,
      };

      const nesting = computeNestingLayout(design, config);
      expect(nesting.errors).toHaveLength(0);
      expect(nesting.totalRequestedQuantity).toBe(qty);
      expect(nesting.totalExportedQuantity).toBe(qty);

      const sumAcrossBatches = nesting.batches.reduce((acc, b) => acc + b.count, 0);
      expect(sumAcrossBatches).toBe(qty);

      const validation = validateLabelAndBatchGeometry(design, nesting, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.overlappingPiecesCount).toBe(0);
      expect(validation.outOfBoundsPiecesCount).toBe(0);
      expect(validation.duplicateCutSegmentsCount).toBe(0);
      expect(validation.allContoursClosed).toBe(true);
    }
  );

  it.each(MATERIAL_SHEET_PRESETS)(
    'calcula capacidad exacta y sin colisiones para recorte de material $label ($widthMm x $heightMm mm)',
    ({ widthMm, heightMm }) => {
      const design = createReference20x10LabelDesign(false);
      const nesting = computeNestingLayout(design, {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 150,
        sheetWidthMm: widthMm,
        sheetHeightMm: heightMm,
        gapXMm: 2.0,
        gapYMm: 2.0,
        marginTopMm: 5.0,
        marginRightMm: 5.0,
        marginBottomMm: 5.0,
        marginLeftMm: 5.0,
      });

      expect(nesting.maxCapacityPerSheet).toBeGreaterThan(0);
      expect(nesting.totalExportedQuantity).toBe(150);
      const validation = validateLabelAndBatchGeometry(design, nesting, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.outOfBoundsPiecesCount).toBe(0);
      expect(validation.overlappingPiecesCount).toBe(0);
    }
  );

  it('optimiza rotación 0° vs 90° automáticamente para maximizar piezas en recortes asimétricos', () => {
    const design = createReference20x10LabelDesign(false);
    design.widthMm = 30;
    design.heightMm = 12;

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 3,
      sheetWidthMm: 28,
      sheetHeightMm: 120,
      marginLeftMm: 2,
      marginRightMm: 2,
      marginTopMm: 2,
      marginBottomMm: 2,
      gapXMm: 2,
      gapYMm: 2,
      rotationMode: 'auto_optimize',
    });

    expect(nesting.orientationComparison.deg0Capacity).toBe(0);
    expect(nesting.orientationComparison.deg90Capacity).toBeGreaterThanOrEqual(3);
    expect(nesting.appliedRotationDeg).toBe(90);
    expect(nesting.totalExportedQuantity).toBe(3);
  });
});

describe('Astra Studio — Validación Independiente LightBurn SVG y RDWorks DXF R12', () => {
  it('audita con lector independiente los archivos SVG y DXF de 200 etiquetas de 20x10 mm verificando escala 1:1, capas y cierre de vértices', () => {
    const design = createReference20x10LabelDesign(true);
    const material = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 200,
    });

    const svgCombined = exportProductionSvg(design, nesting, material, {
      mode: 'combined',
      batchIndex: 0,
    });
    const dxfArtifact = exportProductionDxf(design, nesting, 0);

    // Auditoría independiente SVG (LightBurn)
    const svgAudit = parseAndAuditLightBurnSvg(svgCombined.svgContent);
    expect(svgAudit.isValid).toBe(true);
    expect(svgAudit.errors).toHaveLength(0);
    expect(svgAudit.viewBoxMatchesMm1To1).toBe(true);
    expect(svgAudit.widthMm).toBe(900);
    expect(svgAudit.heightMm).toBe(600);
    expect(svgAudit.cutLayerCount).toBe(200);
    expect(svgAudit.holesLayerCount).toBe(400);
    expect(svgAudit.engraveLayerCount).toBe(400);
    expect(svgAudit.allCutAndHolePathsClosed).toBe(true);
    expect(svgAudit.hasNonProductiveGuides).toBe(false);

    // Auditoría independiente DXF R12 (RDWorks)
    const dxfAudit = parseAndAuditDxfR12(dxfArtifact.dxfContent);
    expect(dxfAudit.isValid).toBe(true);
    expect(dxfAudit.errors).toHaveLength(0);
    expect(dxfAudit.acadVer).toBe('AC1009');
    expect(dxfAudit.insUnits).toBe(4);
    expect(dxfAudit.cutPolylinesCount).toBe(200);
    expect(dxfAudit.holePolylinesCount).toBe(400);
    expect(dxfAudit.allCutAndHolesClosedFlag).toBe(true);
    expect(dxfAudit.allCutAndHolesZeroGapLoop).toBe(true);
    // Verificar que las coordenadas crudas de la primera etiqueta en DXF miden exactamente 20 x 10 mm
    expect(dxfAudit.firstCutPieceSizeMm).toEqual({ width: 20, height: 10 });
  });

  it('detecta líneas de corte duplicadas si dos piezas se colocan con separación 0 mm', () => {
    const design = createReference20x10LabelDesign(false);
    design.shape = 'rectangle';
    design.cornerRadiusMm = 0;

    const c1 = compileLabelGeometry(design, { offsetXMm: 10, offsetYMm: 10 }).outerCutContour;
    const c2 = compileLabelGeometry(design, { offsetXMm: 30, offsetYMm: 10 }).outerCutContour;

    const dupCount = detectDuplicateCutSegments([c1, c2]);
    expect(dupCount).toBe(1);
  });
});

describe('Astra Studio — Pruebas con Logos Reales, Huecos Internos y Protección de Corte/Agujeros', () => {
  it('vectoriza PNG con transparencia y PNG con fondo blanco conservando agujeros/huecos internos (ej. letra O / anillo)', () => {
    const w = 24;
    const h = 24;
    const rgbaWhiteBg = new Uint8ClampedArray(w * h * 4);
    const rgbaTranspBg = new Uint8ClampedArray(w * h * 4);

    // Dibujar un anillo negro (radio exterior 9, hueco interior blanco/transparente radio 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dist = Math.hypot(x - 12, y - 12);
        const isRing = dist <= 9 && dist >= 4;

        // En PNG con fondo blanco
        const valW = isRing ? 15 : 255;
        rgbaWhiteBg[idx] = valW;
        rgbaWhiteBg[idx + 1] = valW;
        rgbaWhiteBg[idx + 2] = valW;
        rgbaWhiteBg[idx + 3] = 255;

        // En PNG con fondo transparente
        rgbaTranspBg[idx] = 15;
        rgbaTranspBg[idx + 1] = 15;
        rgbaTranspBg[idx + 2] = 15;
        rgbaTranspBg[idx + 3] = isRing ? 255 : 0;
      }
    }

    const maskWhite = processRgbaBufferToBinaryMask(rgbaWhiteBg, w, h, DEFAULT_IMAGE_PROCESSING);
    const maskTransp = processRgbaBufferToBinaryMask(rgbaTranspBg, w, h, DEFAULT_IMAGE_PROCESSING);

    expect(maskTransp.hasTransparency).toBe(true);
    expect(maskWhite.darkPixelCount).toBe(maskTransp.darkPixelCount);

    // Al vectorizar un anillo deben obtenerse exactamente 2 contornos cerrados: el exterior y el hueco interno
    const pathsWhite = traceBinaryMaskToNormalizedPaths(maskWhite.binaryMask, w, h, 0.5);
    const pathsTransp = traceBinaryMaskToNormalizedPaths(maskTransp.binaryMask, w, h, 0.5);

    expect(pathsWhite.length).toBe(2);
    expect(pathsTransp.length).toBe(2);
    expect(pathsWhite.every((p) => p.endsWith('Z'))).toBe(true);
    expect(computeEffectiveDpi(300, 25.4)).toBeCloseTo(300, 1);
  });

  it('detecta cuando un logo invade un agujero o la línea de corte y lo corrige con fitElementIntoSafeZone', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.holes = {
      preset: 'two_horizontal',
      diameterMm: 2.0,
      edgeDistanceMm: 2.5,
      customHoles: [],
    };
    // Hacer que el elemento de grabado sea demasiado ancho (19 mm en etiqueta de 20 mm), pisando ambos agujeros laterales
    design.elements[0].widthMm = 19;
    design.elements[0].heightMm = 8;
    if (design.elements[0].type === 'vector_text') {
      design.elements[0].fontSizeMm = 5;
    }

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 10,
    });

    const badValidation = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(badValidation.engraveInvasionCount).toBeGreaterThan(0);
    expect(badValidation.isValid).toBe(false);

    // Aplicar ajuste automático a zona segura
    const safeZone = computeSafeEngravingZone(design);
    expect(safeZone.minX).toBeGreaterThan(2.5);
    expect(safeZone.maxX).toBeLessThan(17.5);

    design.elements[0] = fitElementIntoSafeZone(design.elements[0], design, 0.8);
    const fixedValidation = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(fixedValidation.engraveInvasionCount).toBe(0);
    expect(fixedValidation.isValid).toBe(true);
  });

  it('parsea SVG con elipses, líneas abiertas y arcos elípticos A/a sin generar NaN', () => {
    const complexSvg = `<svg viewBox="0 0 100 50">
      <path d="M 10 25 A 15 15 0 1 0 40 25 A 15 15 0 1 0 10 25 Z" />
      <ellipse cx="70" cy="25" rx="12" ry="8" />
      <line x1="5" y1="45" x2="95" y2="45" />
    </svg>`;
    const parsed = parseSvgLogoString(complexSvg);
    expect(parsed.normalizedPaths).toHaveLength(3);

    const design = createBlankLabelDesign(30, 15, 'rounded_rect');
    design.elements = [
      {
        id: 'el-complex-svg',
        name: 'SVG Complejo',
        type: 'logo_svg',
        xMm: 15,
        yMm: 7.5,
        widthMm: 20,
        heightMm: 10,
        aspectRatio: 2,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: complexSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
      },
    ];

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 5,
    });
    const mat = INITIAL_MATERIALS_CATALOG[0];
    const svgOut = exportProductionSvg(design, nesting, mat);
    const audit = parseAndAuditLightBurnSvg(svgOut.svgContent);
    expect(audit.isValid).toBe(true);
    expect(audit.hasInvalidNumbersOrNaN).toBe(false);
  });

  it('conserva exactamente todas las dimensiones, agujeros y cantidades al guardar y abrir un proyecto (.lhstudio.json)', () => {
    const catalog = createInitialOrdersCatalog();
    const original = structuredClone(catalog[0]);
    original.labelDesign.widthMm = 24.65;
    original.labelDesign.heightMm = 13.4;
    original.labelDesign.kerfCompensationMm = 0.14;
    original.labelDesign.holes = {
      preset: 'custom',
      diameterMm: 1.8,
      edgeDistanceMm: 2.5,
      customHoles: [{ id: 'h1', x: 3.25, y: 6.7, diameterMm: 1.75 }],
    };
    original.nestingConfig.sheetWidthMm = 600;
    original.nestingConfig.sheetHeightMm = 400;
    original.nestingConfig.requestedQuantity = 350;

    const jsonStr = serializeOrderProjectToJson(original);
    const restored = deserializeOrderProjectFromJson(jsonStr);

    expect(restored.labelDesign.widthMm).toBe(24.65);
    expect(restored.labelDesign.heightMm).toBe(13.4);
    expect(restored.labelDesign.kerfCompensationMm).toBe(0.14);
    expect(restored.labelDesign.holes.preset).toBe('custom');
    expect(restored.labelDesign.holes.customHoles[0]).toEqual({
      id: 'h1',
      x: 3.25,
      y: 6.7,
      diameterMm: 1.75,
    });
    expect(restored.nestingConfig.sheetWidthMm).toBe(600);
    expect(restored.nestingConfig.sheetHeightMm).toBe(400);
    expect(restored.nestingConfig.requestedQuantity).toBe(350);

    const duplicated = duplicateOrderWithQuantity(restored, 500);
    expect(duplicated.nestingConfig.requestedQuantity).toBe(500);
    expect(duplicated.labelDesign.widthMm).toBe(roundMm(24.65));
  });
});

describe('Sprint 3 — Pruebas con Diseños Difíciles y Suite de Regresión', () => {
  const suelaMat = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
  const acrilicoMat = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ACRILICO_TRANSPARENTE')!;

  // 1. Logo con letras pequeñas
  it('1. Caso Difícil: Logo con letras pequeñas calcula DPI efectivo alto y conserva fidelidad', () => {
    // Imagen de 1200 px de ancho colocada en 15 mm de ancho
    const dpi = computeEffectiveDpi(1200, 15);
    expect(dpi).toBeGreaterThan(1500); // Supera holgadamente los 300 DPI recomendados
    const design = createBlankLabelDesign(25, 12, 'rounded_rect');
    design.elements = [
      {
        id: 'el-fine-letters',
        name: 'Logo Letras Finas',
        type: 'logo_raster',
        xMm: 12.5,
        yMm: 6,
        widthMm: 14,
        heightMm: 7,
        aspectRatio: 2,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        originalDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        processedDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        pixelWidth: 1200,
        pixelHeight: 600,
        processing: { ...DEFAULT_IMAGE_PROCESSING, mode: 'raster', turdSize: 0.35 },
        vectorizedPathsNormalized: ['M 0.1 0.1 L 0.9 0.1 L 0.9 0.9 L 0.1 0.9 Z'],
        effectiveDpi: dpi,
      },
    ];
    const compiled = compileLabelGeometry(design);
    expect(compiled.engravingItems).toHaveLength(1);
    expect(compiled.engravingItems[0].kind).toBe('raster_image');
  });

  // 2. Logo con fondo blanco
  it('2. Caso Difícil: Logo con fondo blanco elimina fondo claro en esquinas sin alterar centro oscuro', () => {
    const width = 10;
    const height = 10;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Llenar todo con fondo blanco (255, 255, 255, 255)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
    // Dibujar un cuadrado negro de 4x4 en el centro (x:3..6, y:3..6)
    for (let y = 3; y <= 6; y++) {
      for (let x = 3; x <= 6; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 10;
        rgba[idx + 1] = 10;
        rgba[idx + 2] = 10;
        rgba[idx + 3] = 255;
      }
    }
    const result = processRgbaBufferToBinaryMask(rgba, width, height, {
      ...DEFAULT_IMAGE_PROCESSING,
      removeBackground: true,
      backgroundTolerance: 20,
    });
    // Debe haber exactamente 16 píxeles oscuros grabables
    expect(result.darkPixelCount).toBe(16);
    // La esquina (0,0) debe haber quedado con alfa 0 (fondo eliminado)
    expect(result.processedRgba[3]).toBe(0);
    // El centro (4,4) debe ser negro visible
    const centerIdx = (4 * width + 4) * 4;
    expect(result.processedRgba[centerIdx + 3]).toBe(255);
  });

  // 3. Logo transparente
  it('3. Caso Difícil: Logo PNG con canal alfa transparente detecta transparencia y genera máscara exacta', () => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Fondo transparente (alfa = 0)
    rgba.fill(0);
    // Un punto negro en (2,2)
    const idx = (2 * width + 2) * 4;
    rgba[idx] = 0;
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 255;

    const res = processRgbaBufferToBinaryMask(rgba, width, height, DEFAULT_IMAGE_PROCESSING);
    expect(res.hasTransparency).toBe(true);
    expect(res.darkPixelCount).toBe(1);
  });

  // 4. Logo circular
  it('4. Caso Difícil: Etiqueta circular de 25 mm con logo centrado respeta simetría radial', () => {
    const circleLabel = createBlankLabelDesign(25, 25, 'circle');
    const compiled = compileLabelGeometry(circleLabel);
    expect(compiled.outerCutContour.primitive?.kind).toBe('circle');
    expect(compiled.outerCutContour.boundingBox.width).toBeCloseTo(25, 2);
    expect(compiled.outerCutContour.boundingBox.height).toBeCloseTo(25, 2);
  });

  // 5. Logo con huecos interiores
  it('5. Caso Difícil: Logo con huecos interiores (anillo donut calado) conserva subcaminos cerrados con fill-rule evenodd', () => {
    const hollowSvg = `<svg viewBox="0 0 100 100">
      <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 30 70 L 70 70 L 70 30 Z" />
    </svg>`;
    const parsed = parseSvgLogoString(hollowSvg);
    expect(parsed.normalizedPaths).toHaveLength(1);
    expect(parsed.normalizedPaths[0]).toContain('Z M');

    const design = createBlankLabelDesign(30, 20, 'rectangle');
    design.elements = [
      {
        id: 'el-hollow',
        name: 'Donut Calado',
        type: 'logo_svg',
        xMm: 15,
        yMm: 10,
        widthMm: 12,
        heightMm: 12,
        aspectRatio: 1,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: hollowSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
      },
    ];
    const nesting = computeNestingLayout(design, { ...DEFAULT_NESTING_CONFIG, requestedQuantity: 2 });
    const exportedSvg = exportProductionSvg(design, nesting, suelaMat);
    expect(exportedSvg.svgContent).toContain('fill-rule="evenodd"');
  });

  // 6. Diseño con múltiples elementos
  it('6. Caso Difícil: Diseño con múltiples elementos (Logo SVG + Marco interior + Texto CNC) compila sin colisiones', () => {
    const design = createBlankLabelDesign(40, 20, 'rounded_rect');
    design.elements = [
      {
        id: 'border-1',
        name: 'Marco',
        type: 'decorative_border',
        xMm: 20,
        yMm: 10,
        widthMm: 36,
        heightMm: 16,
        aspectRatio: 36 / 16,
        lockAspectRatio: false,
        rotationDeg: 0,
        locked: false,
        visible: true,
        insetMm: 1.5,
        strokeWidthMm: 0.25,
        dashed: false,
      },
      {
        id: 'text-1',
        name: 'Texto CNC',
        type: 'vector_text',
        xMm: 20,
        yMm: 10,
        widthMm: 25,
        heightMm: 3,
        aspectRatio: 25 / 3,
        lockAspectRatio: false,
        rotationDeg: 0,
        locked: false,
        visible: true,
        text: 'LASERHOUSE',
        fontSizeMm: 2.5,
        letterSpacingMm: 0.3,
        fontStyle: 'sans_industrial',
        strokeWidthMm: 0.3,
      },
    ];
    const compiled = compileLabelGeometry(design);
    expect(compiled.engravingItems).toHaveLength(2);
    const nesting = computeNestingLayout(design, { ...DEFAULT_NESTING_CONFIG, requestedQuantity: 10 });
    const validation = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(validation.isValid).toBe(true);
    expect(validation.engraveInvasionCount).toBe(0);
  });

  // 7. Texto pequeño
  it('7. Caso Difícil: Texto vectorial diminuto (1.2 mm) genera trazos válidos cerrados sin coordenadas nulas', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.elements = [
      {
        id: 'text-micro',
        name: 'Micro Texto',
        type: 'vector_text',
        xMm: 10,
        yMm: 5,
        widthMm: 12,
        heightMm: 1.2,
        aspectRatio: 10,
        lockAspectRatio: false,
        rotationDeg: 0,
        locked: false,
        visible: true,
        text: 'HECHO EN ARGENTINA',
        fontSizeMm: 1.2,
        letterSpacingMm: 0.2,
        fontStyle: 'sans_industrial',
        strokeWidthMm: 0.15,
      },
    ];
    const compiled = compileLabelGeometry(design);
    expect(compiled.engravingItems[0].svgPathD).toBeDefined();
    expect(compiled.engravingItems[0].svgPathD).not.toContain('NaN');
  });

  // 8. Etiqueta sin agujeros
  it('8. Caso Difícil: Etiqueta sin agujeros genera exactamente 0 contornos en Capa 01 Agujeros', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.holes = { preset: 'none', diameterMm: 1.6, edgeDistanceMm: 2.2, customHoles: [] };
    const compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(0);

    const nesting = computeNestingLayout(design, { ...DEFAULT_NESTING_CONFIG, requestedQuantity: 20 });
    const svgArt = exportProductionSvg(design, nesting, suelaMat);
    const audit = parseAndAuditLightBurnSvg(svgArt.svgContent);
    expect(audit.holesLayerCount).toBe(0);
  });

  // 9. Etiqueta con agujeros
  it('9. Caso Difícil: Etiqueta con 4 esquinas + 1 agujero personalizado valida distancia y radio exactos', () => {
    const design = createBlankLabelDesign(30, 20, 'rounded_rect');
    design.holes = {
      preset: 'custom',
      diameterMm: 2.0,
      edgeDistanceMm: 3.0,
      customHoles: [
        { id: 'h1', x: 3, y: 3, diameterMm: 2.0 },
        { id: 'h2', x: 27, y: 3, diameterMm: 2.0 },
        { id: 'h3', x: 27, y: 17, diameterMm: 2.0 },
        { id: 'h4', x: 3, y: 17, diameterMm: 2.0 },
        { id: 'center-hole', x: 15, y: 10, diameterMm: 3.5 },
      ],
    };
    const compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(5); // 4 esquinas + 1 central
    expect(compiled.holeContours[4].boundingBox.width).toBeCloseTo(3.5, 2);
  });

  // 10. Lotes de 500 y 1.000 unidades
  it('10. Caso Difícil: Organización de lotes industriales de 500 y 1.000 unidades en plancha de 600×400 mm', () => {
    const design = createReference20x10LabelDesign(false);
    const config500 = {
      ...DEFAULT_NESTING_CONFIG,
      sheetWidthMm: 600,
      sheetHeightMm: 400,
      requestedQuantity: 500,
      gapXMm: 2.0,
      gapYMm: 2.0,
      marginLeftMm: 5,
      marginTopMm: 5,
      marginRightMm: 5,
      marginBottomMm: 5,
    };
    const res500 = computeNestingLayout(design, config500);
    expect(res500.totalExportedQuantity).toBe(500);
    // Cada plancha 600x400 alberga aproximadamente 26 x 32 = 832 etiquetas de 20x10 mm
    expect(res500.totalBatches).toBe(1);

    const config1000 = {
      ...config500,
      sheetWidthMm: 400,
      sheetHeightMm: 300,
      requestedQuantity: 1000,
    };
    const res1000 = computeNestingLayout(design, config1000);
    expect(res1000.totalExportedQuantity).toBe(1000);
    // Plancha más pequeña genera múltiples tandas exactas
    expect(res1000.totalBatches).toBeGreaterThanOrEqual(2);
    const sumInstances = res1000.batches.reduce((acc, b) => acc + b.count, 0);
    expect(sumInstances).toBe(1000);
  });
});

describe('Sprint 4 — Validación de Pedidos Reales (50, 100, 200, 300, 500 u.) y Calibración de Kerf', () => {
  const suelaMat = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
  const standardDesign = createReference20x10LabelDesign(false);

  it.each([50, 100, 200, 300, 500])(
    'organiza pedido real de %i unidades en plancha de 600x400 mm sin superposiciones y con conteo exacto',
    (quantity) => {
      const nesting = computeNestingLayout(standardDesign, {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: quantity,
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

      expect(nesting.totalExportedQuantity).toBe(quantity);
      expect(nesting.batches.length).toBeGreaterThanOrEqual(1);

      // Verificar que cada instancia tiene coordenadas válidas dentro del recorte
      for (const batch of nesting.batches) {
        expect(batch.count).toBeGreaterThan(0);
        expect(batch.occupiedBounds.maxX).toBeLessThanOrEqual(600);
        expect(batch.occupiedBounds.maxY).toBeLessThanOrEqual(400);

        // Comprobar que no hay colisiones o superposiciones entre piezas consecutivas
        for (let i = 0; i < batch.placedInstances.length; i++) {
          const instA = batch.placedInstances[i];
          expect(instA.widthMm).toBeGreaterThan(0);
          expect(instA.heightMm).toBeGreaterThan(0);

          for (let j = i + 1; j < batch.placedInstances.length; j++) {
            const instB = batch.placedInstances[j];
            const overlapX =
              instA.xMm < instB.xMm + instB.widthMm && instA.xMm + instA.widthMm > instB.xMm;
            const overlapY =
              instA.yMm < instB.yMm + instB.heightMm && instA.yMm + instA.heightMm > instB.yMm;
            expect(overlapX && overlapY).toBe(false);
          }
        }
      }

      // Validar geométricamente con el auditor técnico independiente
      const validation = validateLabelAndBatchGeometry(standardDesign, nesting, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.overlappingPiecesCount).toBe(0);
      expect(validation.outOfBoundsPiecesCount).toBe(0);

      // Exportar SVG y auditar estructura 1:1 mm
      const svgArtifact = exportProductionSvg(standardDesign, nesting, suelaMat, {
        mode: 'combined',
        batchIndex: 0,
      });
      const svgAudit = parseAndAuditLightBurnSvg(svgArtifact.svgContent);
      expect(svgAudit.isValid).toBe(true);
      expect(svgAudit.viewBoxMatchesMm1To1).toBe(true);
      expect(svgAudit.hasInvalidNumbersOrNaN).toBe(false);
    }
  );

  it('genera patrón de calibración de Kerf (100x20 mm con 10 tablillas) para medición con calibre digital', () => {
    const artifact = generateKerfCalibrationPatternSvg('Ecocuero Suela');

    expect(artifact.widthMm).toBe(116); // 100 mm + 8 mm margen por lado
    expect(artifact.heightMm).toBe(46);
    expect(artifact.svgContent).toContain('CALIBRACION DE KERF');
    expect(artifact.svgContent).toContain('CAPA_00_GRABADO');
    expect(artifact.svgContent).toContain('CAPA_02_CORTE');
    expect(artifact.svgContent).not.toContain('NaN');
  });

  it('calcula alineación fina dentro de la zona segura sin invadir márgenes ni agujeros', () => {
    const design = createBlankLabelDesign(40, 20, 'rounded_rect');
    design.safetyMarginMm = 2.0;
    const safeZone = computeSafeEngravingZone(design);

    // Margen seguro de 2 mm en 40x20 mm resulta en zona útil de [2..38, 2..18]
    expect(safeZone.minX).toBeCloseTo(2.0, 2);
    expect(safeZone.maxX).toBeCloseTo(38.0, 2);
    expect(safeZone.minY).toBeCloseTo(2.0, 2);
    expect(safeZone.maxY).toBeCloseTo(18.0, 2);
    expect(safeZone.width).toBeCloseTo(36.0, 2);
    expect(safeZone.height).toBeCloseTo(16.0, 2);
  });
});


