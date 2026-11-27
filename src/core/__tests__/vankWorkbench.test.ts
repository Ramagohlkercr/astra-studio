import { describe, expect, it } from 'vitest';
import { parseAndAuditDxfR12 } from '../exporters/fileFormatValidator';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { computeNestingLayout } from '../nesting/nestingEngine';
import { createInitialOrdersCatalog } from '../projects/projectManager';
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../workbench/lbrn2Exporter';
import {
  exportWorkbenchToAi,
  exportWorkbenchToDxf,
  extractClosedContoursFromRasterMask,
} from '../workbench/workbenchVectorExporters';
import {
  applyLibraryEntryToWorkbenchLayers,
  compileMaterialTestToRuidaRd,
  DEFAULT_CUT_TEST_CONFIG,
  DEFAULT_ENGRAVE_TEST_CONFIG,
  deleteMaterialLibraryEntry,
  exportMaterialTestToLbrn2,
  exportMaterialTestToSvg,
  generateMaterialTestCells,
  loadMaterialLibrary,
  saveMaterialLibraryEntry,
} from '../workbench/materialCalibrationEngine';
import {
  buildRasterMaskCacheKey,
  buildScanlineMaskFromRgba,
  rasterizePolylinesToHorizontalRuns,
  RasterScanlineMask,
} from '../workbench/rasterScanlines';
import {
  buildRuidaThumbnailsCommands,
  encodeRuidaThumbnailPackets,
} from '../workbench/ruidaThumbnail';
import {
  buildRuidaFileUploadHeaderBytes,
  buildRuidaUdpPackets,
  compileWorkbenchToRuidaRd,
  decodeRuidaAbsCoordMm,
  decodeRuidaPowerPercent,
  encodeRuidaAbsCoordMm,
  encodeRuidaPowerPercent,
  isValidIpv4Address,
  sanitizeRuidaJobName,
  scrambleRuidaByte,
  unscrambleRuidaByte,
  verifyRuidaUdpPacketChecksums,
} from '../workbench/ruidaCompiler';
import {
  probeVankRuidaConnection,
  uploadRdBytesToVankRuida,
} from '../workbench/ruidaTransportClient';
import {
  analyzeStepMaterialSavings,
  applyExtremeMaterialSavingToWorkbench,
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  buildOptimalSavingNestingConfig,
  computeEcocueroRollMetrics,
  computeJobOriginPointMm,
  createWorkbenchJobFromOrder,
  createWorkbenchJobFromUploadedLogo,
  evaluateBalancedLayoutPresets,
  fillLastRowFreeSlotsInWorkbench,
  reorderWorkbenchJob,
  simulateWorkbenchToolpath,
  sortInstancesInTravelOrder,
  updateWorkbenchJobDesignAndQuantity,
  updateWorkbenchJobGrid,
  validateWorkbenchState,
} from '../workbench/workbenchEngine';
import {
  createDefaultWorkbenchConfig,
  ECOCUERO_BED_PASS_HEIGHT_MM,
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
} from '../workbench/workbenchTypes';

describe('Módulo Mesa de Trabajo y Plancha Vank 9060 (Estilo LightBurn / Ruida RDC8445S)', () => {
  const sampleOrder = createInitialOrdersCatalog()[0];
  const material = INITIAL_MATERIALS_CATALOG[0];
  const nesting = computeNestingLayout(
    sampleOrder.labelDesign,
    sampleOrder.nestingConfig
  );

  it('1. Crea trabajos en plancha desde tanda completa o pieza suelta y evita colisiones iniciales', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job1 = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      batchIndex: 0,
      mode: 'single_piece',
      projectName: 'Etiqueta Suelta',
      clientName: 'Cliente A',
      orderId: sampleOrder.id,
      existingJobs: [],
      config,
    });

    expect(job1.pieceCount).toBe(1);
    expect(job1.widthMm).toBeCloseTo(20, 1);
    expect(job1.heightMm).toBeCloseTo(10, 1);
    expect(job1.xMm).toBe(config.sheetSafetyMarginMm);
    expect(job1.yMm).toBe(config.sheetSafetyMarginMm);

    const job2 = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      batchIndex: 0,
      mode: 'single_piece',
      projectName: 'Segunda Etiqueta',
      clientName: 'Cliente B',
      orderId: sampleOrder.id,
      existingJobs: [job1],
      config,
    });

    expect(job2.xMm).toBeGreaterThan(job1.xMm + job1.widthMm);
  });

  it('2. Acomoda automáticamente múltiples pedidos en una misma plancha (Auto-Arrange) sin superposición', () => {
    const config = createDefaultWorkbenchConfig(300, 200, material);
    const baseJob = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'custom_grid',
      customColumns: 4,
      customRows: 2,
      projectName: 'Lote A',
      clientName: 'Cliente 1',
      orderId: 'ord-1',
      existingJobs: [],
      config,
    });

    // Forzar superposición colocando 3 bloques en (0,0)
    const overlappingJobs = [
      { ...baseJob, id: 'j1', xMm: 10, yMm: 10 },
      { ...baseJob, id: 'j2', xMm: 10, yMm: 10 },
      { ...baseJob, id: 'j3', xMm: 10, yMm: 10 },
    ];

    const beforeValidation = validateWorkbenchState(overlappingJobs, config);
    expect(beforeValidation.overlappingJobsCount).toBeGreaterThan(0);
    expect(beforeValidation.isValidForExport).toBe(false);

    const arranged = autoArrangeWorkbenchJobs(overlappingJobs, config, 4);
    const afterValidation = validateWorkbenchState(arranged, config);
    expect(afterValidation.overlappingJobsCount).toBe(0);
    expect(afterValidation.outOfSheetJobsCount).toBe(0);
    expect(afterValidation.isValidForExport).toBe(true);
  });

  it('3. Actualiza grilla de columnas, filas y rotación de 90° de un trabajo en plancha', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Prueba Grid',
      clientName: 'Cliente',
      orderId: 'ord-grid',
      existingJobs: [],
      config,
    });

    const expanded = updateWorkbenchJobGrid(job, {
      columns: 5,
      rows: 3,
      pieceCount: 15,
    });
    expect(expanded.pieceCount).toBe(15);
    expect(expanded.columns).toBe(5);
    expect(expanded.rows).toBe(3);

    // Editar columnas manteniendo cantidad exacta (reflow 15 u. -> 3 columnas x 5 filas)
    const reflowCols = updateWorkbenchJobGrid(expanded, {
      columns: 3,
      preservePieceCount: true,
    });
    expect(reflowCols.pieceCount).toBe(15);
    expect(reflowCols.columns).toBe(3);
    expect(reflowCols.rows).toBe(5);

    // Editar filas manteniendo cantidad exacta (reflow 15 u. -> 3 filas -> 5 columnas)
    const reflowRows = updateWorkbenchJobGrid(reflowCols, {
      rows: 3,
      preservePieceCount: true,
    });
    expect(reflowRows.pieceCount).toBe(15);
    expect(reflowRows.rows).toBe(3);
    expect(reflowRows.columns).toBe(5);

    // Separación X/Y recalcula ancho y alto total sin alterar cantidad
    const spaced = updateWorkbenchJobGrid(reflowRows, {
      gapXMm: 4,
      gapYMm: 3,
      preservePieceCount: true,
    });
    expect(spaced.pieceCount).toBe(15);
    expect(spaced.gapXMm).toBe(4);
    expect(spaced.gapYMm).toBe(3);
    expect(spaced.widthMm).toBeGreaterThan(reflowRows.widthMm);
    expect(spaced.heightMm).toBeGreaterThan(reflowRows.heightMm);

    const rotated = updateWorkbenchJobGrid(expanded, {
      blockRotationDeg: 90,
    });
    expect(rotated.blockRotationDeg).toBe(90);
    expect(rotated.instances[0].rotated90).toBe(true);
  });

  it('4. Calcula exactamente los 9 puntos de Origen del Trabajo (Job Origin) estilo LightBurn', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const bounds = {
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 80,
      width: 100,
      height: 60,
    };

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'top_left' })
    ).toEqual({ x: 10, y: 20 });

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'center' })
    ).toEqual({ x: 60, y: 50 });

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'bottom_right' })
    ).toEqual({ x: 110, y: 80 });

    expect(
      computeJobOriginPointMm(bounds, {
        ...config,
        startFromMode: 'absolute_coords',
        jobOriginAnchor: 'center',
      })
    ).toEqual({ x: 0, y: 0 });
  });

  it('5. Bloquea envío directo a Ruida si las capas tienen velocidad/potencia sin configurar (null)', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Seguridad Ruida',
      clientName: 'Cliente',
      orderId: 'ord-sec',
      existingJobs: [],
      config,
    });

    // Por defecto el catálogo no inventa potencias ni velocidades (son null)
    const valUnconfigured = validateWorkbenchState([job], config);
    expect(valUnconfigured.isValidForExport).toBe(true);
    expect(valUnconfigured.isValidForMachineSend).toBe(false);
    expect(valUnconfigured.unconfiguredLayersCount).toBeGreaterThan(0);

    expect(() => compileWorkbenchToRuidaRd([job], config)).toThrow(
      /bloqueada por seguridad/i
    );

    // Configurar parámetros validados por el operador en las capas activas
    const configuredConfig = {
      ...config,
      layers: config.layers.map((l) =>
        l.role === 'ENGRAVE'
          ? { ...l, speedMmPerSec: 220, maxPowerPercent: 18, minPowerPercent: 12 }
          : l.role === 'HOLES'
            ? { ...l, speedMmPerSec: 18, maxPowerPercent: 55, minPowerPercent: 45 }
            : { ...l, speedMmPerSec: 22, maxPowerPercent: 60, minPowerPercent: 50 }
      ),
    };

    const valConfigured = validateWorkbenchState([job], configuredConfig);
    expect(valConfigured.isValidForMachineSend).toBe(true);
    expect(valConfigured.unconfiguredLayersCount).toBe(0);

    // Verificar persistencia hacia el perfil del material
    const updatedMat = applyWorkbenchLayersToMaterialProfile(
      configuredConfig.layers,
      material
    );
    expect(updatedMat.engraveParams.speedMmPerSec).toBe(220);
    expect(updatedMat.cutParams.maxPowerPercent).toBe(60);
    expect(updatedMat.cutParams.operatorValidated).toBe(true);
  });

  it('6. Advierte si la capa de Corte Exterior (C02) tiene prioridad anterior al Grabado (C00)', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Orden Capas',
      clientName: 'Cliente',
      orderId: 'ord-prio',
      existingJobs: [],
      config,
    });

    const invertedPriorityConfig = {
      ...config,
      layers: config.layers.map((l) =>
        l.role === 'CUT'
          ? { ...l, priority: 0, speedMmPerSec: 20, maxPowerPercent: 50 }
          : l.role === 'ENGRAVE'
            ? { ...l, priority: 2, speedMmPerSec: 200, maxPowerPercent: 20 }
            : { ...l, priority: 1, speedMmPerSec: 20, maxPowerPercent: 50 }
      ),
    };

    const report = validateWorkbenchState([job], invertedPriorityConfig);
    expect(
      report.issues.some((i) => i.code === 'UNSAFE_LAYER_ORDER_CUT_BEFORE_ENGRAVE')
    ).toBe(true);
  });

  it('7. Simula trayectoria del cabezal láser y exporta proyecto nativo LightBurn (.lbrn2) y SVG de plancha', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const configuredConfig = {
      ...config,
      layers: config.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 200 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 20 : 55,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 45,
      })),
    };

    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'custom_grid',
      customColumns: 2,
      customRows: 2,
      projectName: 'Pedido LightBurn',
      clientName: 'Cliente LB',
      orderId: 'ord-lb',
      existingJobs: [],
      config: configuredConfig,
    });

    const sim = simulateWorkbenchToolpath([job], configuredConfig);
    expect(sim.segments.length).toBeGreaterThan(4);
    expect(sim.totalDurationSec).toBeGreaterThan(0);
    expect(sim.totalDistanceMm).toBeGreaterThan(0);

    const lbrn2 = exportWorkbenchToLbrn2([job], configuredConfig, 'Mesa_Prueba');
    expect(lbrn2.filenameSuggested).toBe('Mesa_Prueba_LightBurn.lbrn2');
    expect(lbrn2.pieceCount).toBe(4);
    expect(lbrn2.lbrn2Content).toContain('<LightBurnProject');
    expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Scan">');
    expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Cut">');
    expect(lbrn2.lbrn2Content).toContain('<Shape Type="Path"');

    const svg = exportWorkbenchToSvg([job], configuredConfig, 'Mesa_Prueba');
    expect(svg.pieceCount).toBe(4);
    expect(svg.svgContent).toContain('width="600mm" height="400mm"');
    expect(svg.svgContent).toContain('id="CAPA_00_GRABADO"');
    expect(svg.svgContent).toContain('id="CAPA_02_CORTE"');
  });

  it('8. Codifica coordenadas, potencias, scrambling 0x88 y compila archivo binario Ruida (.RD) + paquetes UDP', () => {
    // 1. Coordenadas en micrómetros (35 bits)
    for (const mm of [0, 10.5, 40, 250.125, 900, 600]) {
      const encoded = encodeRuidaAbsCoordMm(mm);
      expect(encoded).toHaveLength(5);
      expect(encoded.every((b) => (b & 0x80) === 0)).toBe(true);
      expect(decodeRuidaAbsCoordMm(encoded)).toBeCloseTo(mm, 3);
    }

    // 2. Potencia láser (14 bits: 0..100%)
    for (const pct of [0, 15, 25.5, 50, 85, 100]) {
      const encP = encodeRuidaPowerPercent(pct);
      expect(encP).toHaveLength(2);
      expect(decodeRuidaPowerPercent(encP)).toBeCloseTo(pct, 1);
    }

    // 3. Biyección perfecta de scrambling Ruida (0x00..0xFF)
    for (let b = 0; b <= 255; b++) {
      const s = scrambleRuidaByte(b);
      expect(unscrambleRuidaByte(s)).toBe(b);
    }

    // 4. Compilación completa de archivo .RD y empaquetado UDP con checksum 16-bit
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const configuredConfig = {
      ...config,
      ruidaJobName: 'VANK01',
      layers: config.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 200 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 20 : 60,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 50,
      })),
    };

    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Prueba RD',
      clientName: 'Cliente RD',
      orderId: 'ord-rd',
      existingJobs: [],
      config: configuredConfig,
    });

    const rdArtifact = compileWorkbenchToRuidaRd([job], configuredConfig);
    expect(rdArtifact.ruidaJobName).toBe('VANK01');
    expect(rdArtifact.filenameSuggested).toBe('VANK01_Vank9060.rd');
    expect(rdArtifact.rdBytes.length).toBeGreaterThan(40);
    // Verificar selector de modo de origen LightBurn (`D8 11` user_origin) + bandera RDC8445S (`E7 3B 41`) + pie `E5 05` y fin `D7`
    expect(rdArtifact.rawUnscrambledBytes[0]).toBe(0xd8);
    expect(rdArtifact.rawUnscrambledBytes[1]).toBe(0x11);
    const hasRdc8445Tag = rdArtifact.rawUnscrambledBytes.some(
      (b, idx, arr) => b === 0xe7 && arr[idx + 1] === 0x3b && arr[idx + 2] === 0x41
    );
    expect(hasRdc8445Tag).toBe(true);
    const hasFileSumTag = rdArtifact.rawUnscrambledBytes.some(
      (b, idx, arr) => b === 0xe5 && arr[idx + 1] === 0x05
    );
    expect(hasFileSumTag).toBe(true);
    expect(
      rdArtifact.rawUnscrambledBytes[rdArtifact.rawUnscrambledBytes.length - 1]
    ).toBe(0xd7);

    const packets = buildRuidaUdpPackets(rdArtifact.rdBytes, 500);
    expect(packets.length).toBeGreaterThanOrEqual(1);
    for (const pkt of packets) {
      const expectedChecksum =
        pkt.slice(2).reduce((acc, b) => (acc + b) & 0xffff, 0) & 0xffff;
      const headerChecksum = (pkt[0] << 8) | pkt[1];
      expect(headerChecksum).toBe(expectedChecksum);
    }
  });

  it('9. Toma automáticamente 73 cm de ancho (730 mm) y 5 m de rollo (5000 mm) cuando el material es Ecocuero', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG.find(
      (m) => m.id === 'ECOCUERO_SUELA'
    )!;
    const ecoConfig = createDefaultWorkbenchConfig(
      undefined,
      undefined,
      ecocueroMat
    );

    expect(ecoConfig.sheetWidthMm).toBe(ECOCUERO_ROLL_WIDTH_MM); // 730 mm (73 cm)
    expect(ecoConfig.sheetHeightMm).toBe(ECOCUERO_BED_PASS_HEIGHT_MM); // 600 mm (60 cm por tirada)
    expect(ecoConfig.isRollMaterial).toBe(true);
    expect(ecoConfig.rollTotalLengthMm).toBe(ECOCUERO_ROLL_TOTAL_LENGTH_MM); // 5000 mm (5 m)
  });

  it('10. Permite subir y combinar varios trabajos con distintos logos, medidas y cantidades en la misma tirada de 73 cm', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const config = createDefaultWorkbenchConfig(undefined, undefined, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    // Logo 1: 100 etiquetas de 40x20 mm (4x2 cm)
    const job1 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Alfa',
      element: sampleElement,
      widthMm: 40,
      heightMm: 20,
      quantity: 100,
      existingJobs: [],
      config,
    });

    // En 730 mm con 5 mm de margen a cada lado (720 mm útiles) y gap 2 mm:
    // floor((720 + 2) / (40 + 2)) = 17 columnas por fila -> 100 etiquetas ocupan 6 filas
    expect(job1.columns).toBe(17);
    expect(job1.rows).toBe(6);
    expect(job1.pieceCount).toBe(100);

    // Logo 2: 150 etiquetas de 30x15 mm
    const job2 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Beta',
      element: sampleElement,
      widthMm: 30,
      heightMm: 15,
      quantity: 150,
      existingJobs: [job1],
      config,
    });
    // floor((720 + 2) / (30 + 2)) = 22 columnas por fila -> 150 etiquetas ocupan 7 filas
    expect(job2.columns).toBe(22);
    expect(job2.rows).toBe(7);
    expect(job2.pieceCount).toBe(150);

    // Logo 3: Cambiar medida y cantidad dinámicamente a 80 etiquetas de 50x25 mm con 2 agujeros
    const job3Raw = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Gamma',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 20,
      existingJobs: [job1, job2],
      config,
    });
    const job3 = updateWorkbenchJobDesignAndQuantity(
      job3Raw,
      {
        widthMm: 50,
        heightMm: 25,
        holePreset: 'two_horizontal',
        pieceCount: 80,
        autoFitColumnsToRoll: true,
      },
      config
    );
    expect(job3.pieceCount).toBe(80);
    expect(job3.labelDesign.widthMm).toBe(50);
    expect(job3.labelDesign.heightMm).toBe(25);
    expect(job3.labelDesign.holes.preset).toBe('two_horizontal');

    const arranged = autoArrangeWorkbenchJobs([job1, job2, job3], config, 4, true);
    const validation = validateWorkbenchState(arranged, config);

    expect(validation.isValidForExport).toBe(true);
    expect(validation.totalJobs).toBe(3);
    expect(validation.totalPieces).toBe(330); // 100 + 150 + 80 en la misma tirada
    expect(validation.overlappingJobsCount).toBe(0);
    expect(validation.outOfSheetJobsCount).toBe(0);

    // Verificar métricas de consumo del rollo de 73 cm x 5 m (500 cm)
    const metrics = computeEcocueroRollMetrics(arranged, config);
    expect(metrics.rollWidthCm).toBe(73);
    expect(metrics.totalRollLengthCm).toBe(500);
    expect(metrics.usedLengthCm).toBeGreaterThan(35);
    expect(metrics.usedLengthCm).toBeLessThan(55); // Entra sobrado en los 60 cm de una tirada en mesa Vank 9060
    expect(metrics.remainingRollLengthCm).toBeCloseTo(
      500 - metrics.usedLengthCm,
      1
    );
    expect(metrics.exceedsSingleBedPass).toBe(false);
  });

  it('11. Ahorro Extremo Cero Desperdicio: intercala trabajos en flujo continuo sin huecos entre logos y completa la última fila sin gastar ni 1 mm más de rollo', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const baseCfg = createDefaultWorkbenchConfig(undefined, undefined, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    // 3 pedidos de 50 etiquetas de 20x10 mm cada uno (150 etiquetas en total)
    const j1 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_1',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [],
      config: baseCfg,
    });
    const j2 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_2',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [j1],
      config: baseCfg,
    });
    const j3 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_3',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [j1, j2],
      config: baseCfg,
    });

    // Aplicar Ahorro Extremo (Margen 2mm, Gap 0.5mm, Flujo continuo pieza a pieza)
    const { config: extremeCfg, jobs: extremeJobs } =
      applyExtremeMaterialSavingToWorkbench([j1, j2, j3], baseCfg);

    // Verificar que el Trabajo #2 continúa en la misma fila donde terminó el Trabajo #1 (firstRowIndentMm > 0)
    expect(extremeJobs[1].firstRowIndentMm).toBeGreaterThan(0);
    expect(extremeJobs[1].yMm).toBeGreaterThanOrEqual(extremeJobs[0].yMm);
    expect(extremeJobs[1].yMm).toBeLessThan(
      extremeJobs[0].yMm + extremeJobs[0].heightMm
    );
    expect(extremeJobs[2].firstRowIndentMm).toBeGreaterThan(0);
    expect(extremeJobs[2].yMm).toBeGreaterThan(extremeJobs[0].yMm);

    const val = validateWorkbenchState(extremeJobs, extremeCfg);
    expect(val.isValidForExport).toBe(true);
    expect(val.overlappingJobsCount).toBe(0); // 0 colisiones reales entre las 150 piezas

    const metricsBeforeFill = computeEcocueroRollMetrics(extremeJobs, extremeCfg);
    expect(metricsBeforeFill.freeSlotsInLastRow).toBeGreaterThan(0);
    const rollUsedBeforeFillMm = metricsBeforeFill.usedLengthMm;

    // Completar el hueco libre de la última fila con etiquetas gratis de rollo
    const { jobs: filledJobs, addedPieces } = fillLastRowFreeSlotsInWorkbench(
      extremeJobs,
      extremeCfg
    );
    expect(addedPieces).toBe(metricsBeforeFill.freeSlotsInLastRow);

    const metricsAfterFill = computeEcocueroRollMetrics(filledJobs, extremeCfg);
    // El avance de rollo consumido es EXACTAMENTE EL MISMO (0.0 mm extra de rollo)
    expect(metricsAfterFill.usedLengthMm).toBeCloseTo(rollUsedBeforeFillMm, 1);
    expect(metricsAfterFill.freeSlotsInLastRow).toBe(0);

    // Verificar también el optimizador de ahorro de Paso 5 / Paso 6 antes de exportar
    const stepOptCfg = buildOptimalSavingNestingConfig(
      sampleOrder.labelDesign,
      sampleOrder.nestingConfig,
      false
    );
    const stepOptNesting = computeNestingLayout(
      sampleOrder.labelDesign,
      stepOptCfg
    );
    const stepAnalysis = analyzeStepMaterialSavings(
      sampleOrder.labelDesign,
      stepOptNesting,
      0
    );
    expect(stepAnalysis.isAlreadyOptimal).toBe(true);
  });

  it('12. Caso Real Captura 100 u. (20x10 mm): evita dejar 32 lugares vacíos en la 3ra fila (44x3) formando un rectángulo 100% lleno (0 lugares vacíos) dentro de los 73 cm', () => {
    const design = sampleOrder.labelDesign; // 20 x 10 mm
    const optCfg = buildOptimalSavingNestingConfig(
      design,
      {
        ...sampleOrder.nestingConfig,
        requestedQuantity: 100,
        sheetWidthMm: 730,
        sheetHeightMm: 600,
      },
      false,
      'zero_waste'
    );

    const res = computeNestingLayout(design, optCfg);
    const batch = res.batches[0];

    expect(batch.count).toBe(100);
    // 0 lugares vacíos en la última fila: columnsUsed * rowsUsed === 100 exactos
    expect(batch.columnsUsed * batch.rowsUsed).toBe(100);
    // Entra dentro del rollo de 73 cm (730 mm)
    expect(batch.occupiedBounds.maxX).toBeLessThanOrEqual(730);
    // El área del bloque es mucho menor que los 26706 mm2 del armado desbalanceado 44x3
    const blockAreaMm2 =
      batch.occupiedBounds.width * batch.occupiedBounds.height;
    expect(blockAreaMm2).toBeLessThan(21500);
  });

  it('13. Evalúa las 3 opciones de Equilibrio (Espacio en Plancha + Velocidad de Máquina): Equilibrio 25x4 (0 vacíos), Velocidad 34x3 (3 filas) y Compacto 20x5 (0 vacíos)', () => {
    const design = sampleOrder.labelDesign; // 20 x 10 mm
    const presets = evaluateBalancedLayoutPresets(design, {
      ...sampleOrder.nestingConfig,
      requestedQuantity: 100,
      sheetWidthMm: 730,
      sheetHeightMm: 600,
    });

    expect(presets).toHaveLength(3);
    const eq = presets.find((p) => p.id === 'equilibrium')!;
    const spd = presets.find((p) => p.id === 'max_speed')!;
    const cmp = presets.find((p) => p.id === 'compact_block')!;

    // Equilibrio Ideal: 25 col x 4 filas (0 lugares vacíos, 100% lleno)
    expect(eq.cols).toBe(25);
    expect(eq.rows).toBe(4);
    expect(eq.emptySlots).toBe(0);
    expect(eq.blockFillPercent).toBe(100);

    // Velocidad Máxima: 34 col x 3 filas (solo 3 filas verticales = menor tiempo de máquina)
    expect(spd.cols).toBe(34);
    expect(spd.rows).toBe(3);
    expect(spd.estimatedMachineTimeSec).toBeLessThan(eq.estimatedMachineTimeSec);

    // Bloque Compacto: 20 col x 5 filas (0 lugares vacíos, mayor sobrante libre al costado)
    expect(cmp.cols).toBe(20);
    expect(cmp.rows).toBe(5);
    expect(cmp.emptySlots).toBe(0);
    expect(cmp.freeSideWidthCm).toBeGreaterThan(eq.freeSideWidthCm);
  });

  it('14. Genera Matriz de Calibración de Potencia x Velocidad (Grabado C00 0.073mm/348 DPI y Corte C02) y exporta a LightBurn (.lbrn2), Ruida (.RD) y SVG', () => {
    const engraveGrid = generateMaterialTestCells(DEFAULT_ENGRAVE_TEST_CONFIG);
    // 5 velocidades x 5 potencias = 25 celdas (C00 a C24)
    expect(engraveGrid.cells).toHaveLength(25);
    expect(engraveGrid.speedValues).toEqual([200, 300, 400, 500, 600]);
    expect(engraveGrid.powerValues).toEqual([15, 20, 25, 30, 35]);
    expect(engraveGrid.cells[0].lineIntervalMm).toBe(0.073);

    const lbrn2Matrix = exportMaterialTestToLbrn2(
      DEFAULT_ENGRAVE_TEST_CONFIG,
      'Ecocuero_73cm'
    );
    expect(lbrn2Matrix.cellCount).toBe(25);
    expect(lbrn2Matrix.lbrn2Content).toContain('<CutSetting type="Scan">');
    expect(lbrn2Matrix.lbrn2Content).toContain('<speed Value="600"/>');
    expect(lbrn2Matrix.lbrn2Content).toContain('<maxPower Value="30"/>');
    expect(lbrn2Matrix.lbrn2Content).toContain('<interval Value="0.073"/>');

    const rdMatrix = compileMaterialTestToRuidaRd(
      DEFAULT_CUT_TEST_CONFIG,
      'CALCORTE'
    );
    expect(rdMatrix.ruidaJobName).toBe('CALCORTE');
    expect(rdMatrix.totalPieces).toBe(25);
    expect(rdMatrix.rdBytes.length).toBeGreaterThan(100);
    expect(rdMatrix.rawUnscrambledBytes[0]).toBe(0xd8);
    expect(
      rdMatrix.rawUnscrambledBytes[rdMatrix.rawUnscrambledBytes.length - 1]
    ).toBe(0xd7);

    const svgMatrix = exportMaterialTestToSvg(
      DEFAULT_ENGRAVE_TEST_CONFIG,
      'Ecocuero'
    );
    expect(svgMatrix.svgContent).toContain('600mm/s');
    expect(svgMatrix.svgContent).toContain('30%');
  });

  it('15. Persiste entradas en la Biblioteca de Materiales LightBurn y aplica modo Imagen 600mm/s · 30% · Intervalo 0.073mm (348 DPI) a las capas', () => {
    const config = createDefaultWorkbenchConfig(730, 600, material);
    expect(config.ruidaIpAddress).toBe('192.168.0.195');

    const entry = {
      id: 'test-vank-lb-600-30',
      materialName: 'Ecocuero 73cm — Captura LightBurn Vank 9060',
      thicknessMm: 1.4,
      description: 'C00 Imagen 600/30 Int 0.073mm · C01/C02 Línea 100/100',
      updatedAt: '2026-11-24T18:45:00.000Z',
      engrave: {
        mode: 'image' as const,
        speedMmPerSec: 600,
        maxPowerPercent: 30,
        minPowerPercent: 30,
        lineIntervalMm: 0.073,
        passes: 1,
        airAssist: true,
        imageDitherMode: 'jarvis' as const,
      },
      holes: {
        speedMmPerSec: 100,
        maxPowerPercent: 100,
        minPowerPercent: 100,
        passes: 1,
        airAssist: true,
      },
      cut: {
        speedMmPerSec: 100,
        maxPowerPercent: 100,
        minPowerPercent: 100,
        passes: 1,
        airAssist: true,
        kerfOffsetMm: 0.08,
      },
    };

    const savedList = saveMaterialLibraryEntry(entry);
    expect(savedList.some((e) => e.id === entry.id)).toBe(true);
    expect(loadMaterialLibrary().some((e) => e.id === entry.id)).toBe(true);

    const appliedLayers = applyLibraryEntryToWorkbenchLayers(entry, config.layers);
    const c00 = appliedLayers.find((l) => l.cutIndex === 0)!;
    const c02 = appliedLayers.find((l) => l.cutIndex === 2)!;

    expect(c00.mode).toBe('image');
    expect(c00.speedMmPerSec).toBe(600);
    expect(c00.maxPowerPercent).toBe(30);
    expect(c00.minPowerPercent).toBe(30);
    expect(c00.lineIntervalMm).toBe(0.073);
    expect(c00.operatorValidated).toBe(true);

    expect(c02.mode).toBe('line');
    expect(c02.speedMmPerSec).toBe(100);
    expect(c02.maxPowerPercent).toBe(100);
    expect(c02.kerfOffsetMm).toBe(0.08);

    // Exportar proyecto con modo Imagen e intervalo 0.073 mm a .lbrn2
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Prueba_Imagen_0073',
      clientName: 'Cliente',
      orderId: 'ord-img',
      existingJobs: [],
      config: { ...config, layers: appliedLayers },
    });
    const lbrn2 = exportWorkbenchToLbrn2(
      [job],
      { ...config, layers: appliedLayers },
      'Prueba_Imagen_0073'
    );
    expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Image">');
    expect(lbrn2.lbrn2Content).toContain('<interval Value="0.073"/>');
    expect(lbrn2.lbrn2Content).toContain('<ditherMode Value="jarvis"/>');
    expect(lbrn2.lbrn2Content).toContain('<kerf Value="0.08"/>');

    const afterDelete = deleteMaterialLibraryEntry(entry.id);
    expect(afterDelete.some((e) => e.id === entry.id)).toBe(false);
  });

  it('16. Relleno 2D de bolsillos laterales: acomoda múltiples mini-filas de etiquetas chicas dentro del hueco lateral de un trabajo más alto sin gastar rollo extra', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const baseCfg = createDefaultWorkbenchConfig(730, 600, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    // Trabajo grande alto: 8 etiquetas de 60x30 mm (en 73cm ocupan sólo ~490 mm de los 726 mm, dejando un bolsillo de ~230x30 mm libre a la derecha)
    const tallJob = createWorkbenchJobFromUploadedLogo({
      logoName: 'Parche_Grande_60x30',
      element: sampleElement,
      widthMm: 60,
      heightMm: 30,
      quantity: 8,
      existingJobs: [],
      config: baseCfg,
    });

    // Trabajo chico: 18 etiquetas de 20x10 mm (caben 2 mini-filas horizontales de altura 10mm dentro de los 30mm del bolsillo lateral!)
    const smallJob = createWorkbenchJobFromUploadedLogo({
      logoName: 'Etiqueta_Chica_20x10',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 18,
      existingJobs: [tallJob],
      config: baseCfg,
    });

    const { config: optCfg, jobs: optJobs } =
      applyExtremeMaterialSavingToWorkbench([smallJob, tallJob], baseCfg);

    const val = validateWorkbenchState(optJobs, optCfg);
    expect(val.isValidForExport).toBe(true);
    expect(val.overlappingJobsCount).toBe(0);
    expect(val.totalPieces).toBe(26);

    const metrics = computeEcocueroRollMetrics(optJobs, optCfg);
    // Todo entra en los 30 mm de altura del parche grande + márgenes (<= 36 mm total de avance de rollo!)
    expect(metrics.usedLengthMm).toBeLessThanOrEqual(42);
    expect(metrics.stripAreaEfficiencyPercent).toBeGreaterThan(75);
    expect(metrics.wastePercent).toBeDefined();
    expect(metrics.wasteAreaCm2).toBeDefined();
  });

  it('17. Tirada secuencial multi-archivo (Trabajo #1 completo → #2 → #3): termina C00+C01+C02 del primer trabajo antes de iniciar el siguiente en Simulación, Ruida .RD y LightBurn .lbrn2', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const baseCfg = createDefaultWorkbenchConfig(730, 600, ecocueroMat);
    const configuredCfg = {
      ...baseCfg,
      executionSequenceMode: 'sequential_per_job' as const,
      travelOrder: 'zigzag_rows' as const,
      layers: baseCfg.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 220 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 25 : 65,
        minPowerPercent: l.role === 'ENGRAVE' ? 20 : 55,
      })),
    };

    const sampleElement = sampleOrder.labelDesign.elements[0];
    const job1 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Primero_Alfa',
      element: sampleElement,
      widthMm: 30,
      heightMm: 15,
      holePreset: 'two_horizontal',
      quantity: 4,
      existingJobs: [],
      config: configuredCfg,
    });
    const job2 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Segundo_Beta',
      element: sampleElement,
      widthMm: 25,
      heightMm: 12,
      holePreset: 'two_horizontal',
      quantity: 4,
      existingJobs: [job1],
      config: configuredCfg,
    });
    const job3 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Tercero_Gamma',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      holePreset: 'two_horizontal',
      quantity: 3,
      existingJobs: [job1, job2],
      config: configuredCfg,
    });

    const arranged = autoArrangeWorkbenchJobs([job1, job2, job3], configuredCfg, 2, true);

    // 1. Verificar en Simulación de trayectoria que los índices de trabajo son estrictamente monótonos (#0 -> #1 -> #2)
    const sim = simulateWorkbenchToolpath(arranged, configuredCfg);
    const nonRapidJobIndices = sim.segments
      .filter((s) => s.kind !== 'rapid_move' && s.jobIndex !== undefined)
      .map((s) => s.jobIndex as number);

    expect(nonRapidJobIndices.length).toBeGreaterThan(10);
    for (let i = 1; i < nonRapidJobIndices.length; i++) {
      expect(nonRapidJobIndices[i]).toBeGreaterThanOrEqual(nonRapidJobIndices[i - 1]);
    }
    // Dentro de Trabajo #1, primero ocurre Grabado (engrave_scan), luego Agujeros (hole_cut), luego Corte (outer_cut)
    const job0Kinds = sim.segments
      .filter((s) => s.jobIndex === 0 && s.kind !== 'rapid_move')
      .map((s) => s.kind);
    const firstHole0 = job0Kinds.indexOf('hole_cut');
    const firstCut0 = job0Kinds.indexOf('outer_cut');
    expect(job0Kinds[0]).toBe('engrave_scan');
    expect(firstHole0).toBeGreaterThan(0);
    expect(firstCut0).toBeGreaterThan(firstHole0);

    // 2. Verificar en Ruida .RD binario que CA 02 <layer> cambia por cada trabajo completo (0 -> 1 -> 2, luego 0 -> 1 -> 2...)
    const rd = compileWorkbenchToRuidaRd(arranged, configuredCfg);
    const layerTransitions: number[] = [];
    for (let i = 0; i < rd.rawUnscrambledBytes.length - 2; i++) {
      if (
        rd.rawUnscrambledBytes[i] === 0xca &&
        rd.rawUnscrambledBytes[i + 1] === 0x02
      ) {
        layerTransitions.push(rd.rawUnscrambledBytes[i + 2]);
      }
    }
    expect(layerTransitions).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);

    // 3. Verificar en LightBurn (.lbrn2) agrupación secuencial y Optimize_ByGroup=1
    const lbrn2 = exportWorkbenchToLbrn2(arranged, configuredCfg, 'Multi_Ordenado');
    expect(lbrn2.lbrn2Content).toContain('<Optimize_ByGroup Value="1"/>');
    expect(lbrn2.lbrn2Content).toContain('<Shape Type="Group">');
    expect(lbrn2.lbrn2Content).toContain('Orden: #1 Primero_Alfa');
  });

  it('18. Sentido de recorrido ordenado (ZigZag / Izq→Der), reordenamiento de trabajos y optimización con bloqueo de orden', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const cfg = createDefaultWorkbenchConfig(730, 600, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    const jobA = createWorkbenchJobFromUploadedLogo({
      logoName: 'Pedido_A',
      element: sampleElement,
      widthMm: 100,
      heightMm: 50,
      quantity: 6,
      existingJobs: [],
      config: cfg,
    });
    const jobB = createWorkbenchJobFromUploadedLogo({
      logoName: 'Pedido_B',
      element: sampleElement,
      widthMm: 180,
      heightMm: 40,
      quantity: 4,
      existingJobs: [jobA],
      config: cfg,
    });

    // ZigZag serpenteo en jobB (2 filas de 2 piezas aprox): fila 0 izq->der, fila 1 der->izq
    const zigzag = sortInstancesInTravelOrder(jobA.instances, 'zigzag_rows');
    const row0Y = zigzag[0].localYMm;
    const row0 = zigzag.filter((i) => Math.abs(i.localYMm - row0Y) < 1);
    const row1 = zigzag.filter((i) => Math.abs(i.localYMm - row0Y) >= 1);
    if (row0.length > 1 && row1.length > 1) {
      expect(row0[1].localXMm).toBeGreaterThan(row0[0].localXMm);
      expect(row1[1].localXMm).toBeLessThan(row1[0].localXMm);
    }

    // Reordenar cola manualmente: subir Pedido_B al #1
    const reordered = reorderWorkbenchJob([jobA, jobB], jobB.id, 'up');
    expect(reordered[0].id).toBe(jobB.id);
    expect(reordered[1].id).toBe(jobA.id);

    // Optimizar respetando orden exacto (preserveOrder: true) mantiene #1 Pedido_B y #2 Pedido_A
    const { jobs: optPreserved } = applyExtremeMaterialSavingToWorkbench(
      reordered,
      cfg,
      { preserveOrder: true }
    );
    expect(optPreserved[0].id).toBe(jobB.id);
    expect(optPreserved[1].id).toBe(jobA.id);
  });

  it('19. Coordenadas Ruida 35-bit con signo, normalización de origen (user_origin top_right vs absolute_coords) y verificación de checksum UDP', async () => {
    // 1. Roundtrip exacto incluyendo coordenadas negativas grandes (ej. User Origin Superior Derecha)
    for (const mm of [-720, -250.375, -10.5, -0.001, 0, 145.125, 900]) {
      const enc = encodeRuidaAbsCoordMm(mm);
      expect(enc).toHaveLength(5);
      expect(decodeRuidaAbsCoordMm(enc)).toBeCloseTo(mm, 3);
    }

    // 2. Verificar que en user_origin top_right los límites E7 03/07 y E7 50/51 se emiten respecto al ancla derecha (minX negativo, maxX = 0)
    const ecoCfg = createDefaultWorkbenchConfig(730, 600, material);
    const sampleElement = sampleOrder.labelDesign.elements[0];
    const job = createWorkbenchJobFromUploadedLogo({
      logoName: 'Origen_Der',
      element: sampleElement,
      widthMm: 40,
      heightMm: 20,
      quantity: 2,
      existingJobs: [],
      config: ecoCfg,
    });

    const userOriginCfg = {
      ...ecoCfg,
      startFromMode: 'user_origin' as const,
      jobOriginAnchor: 'top_right' as const,
      layers: ecoCfg.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 200 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 25 : 65,
        minPowerPercent: l.role === 'ENGRAVE' ? 20 : 55,
      })),
    };

    const rdUser = compileWorkbenchToRuidaRd([job], userOriginCfg);
    const e703Idx = rdUser.rawUnscrambledBytes.findIndex(
      (b, idx, arr) => b === 0xe7 && arr[idx + 1] === 0x03
    );
    const e707Idx = rdUser.rawUnscrambledBytes.findIndex(
      (b, idx, arr) => b === 0xe7 && arr[idx + 1] === 0x07
    );
    const e750Idx = rdUser.rawUnscrambledBytes.findIndex(
      (b, idx, arr) => b === 0xe7 && arr[idx + 1] === 0x50
    );
    expect(e703Idx).toBeGreaterThan(-1);
    expect(e707Idx).toBeGreaterThan(-1);
    expect(e750Idx).toBeGreaterThan(-1);

    const minXRel = decodeRuidaAbsCoordMm(
      Array.from(rdUser.rawUnscrambledBytes.slice(e703Idx + 2, e703Idx + 7))
    );
    const maxXRel = decodeRuidaAbsCoordMm(
      Array.from(rdUser.rawUnscrambledBytes.slice(e707Idx + 2, e707Idx + 7))
    );
    // En Vank 9060 (Home físico Superior Derecha, +X hacia la izquierda), el ancla top_right está en X = 0 y el trabajo se extiende hacia X > 0
    expect(minXRel).toBeCloseTo(0, 2);
    expect(maxXRel).toBeGreaterThan(0);

    // 3. Verificación estricta de checksum UDP e IPv4 sin transmitir paquetes reales
    const packets = buildRuidaUdpPackets(rdUser.rdBytes);
    expect(verifyRuidaUdpPacketChecksums(packets)).toBe(true);
    const corrupted = packets.map((p) => new Uint8Array(p));
    corrupted[0][2] ^= 0xff;
    expect(verifyRuidaUdpPacketChecksums(corrupted)).toBe(false);

    expect(isValidIpv4Address('192.168.0.195')).toBe(true);
    expect(isValidIpv4Address('999.168.0.1')).toBe(false);

    // 4. Preámbulo de carga con nombre (`E8 02 E7 01 <NOMBRE> 00`) para pantalla Vank 9060
    expect(sanitizeRuidaJobName('Churitas 2026')).toBe('CHURITAS');
    const hdr = Array.from(buildRuidaFileUploadHeaderBytes('Churitas 2026')).map((b) =>
      unscrambleRuidaByte(b)
    );
    expect(hdr).toEqual([0xe8, 0x02, 0xe7, 0x01, 67, 72, 85, 82, 73, 84, 65, 83, 0x00]);

    // 5. Verificar que imágenes raster generen corridas reales píxel a píxel (NO rectángulos sólidos)
    // Matriz RGBA 10x4: filas 0 y 3 todo blanco; filas 1 y 2 barra oscura solo en columnas 2..7
    const rgba = new Uint8ClampedArray(10 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (y * 10 + x) * 4;
        const isInk = (y === 1 || y === 2) && x >= 2 && x <= 7;
        rgba[idx] = isInk ? 10 : 255;
        rgba[idx + 1] = isInk ? 10 : 255;
        rgba[idx + 2] = isInk ? 10 : 255;
        rgba[idx + 3] = 255;
      }
    }
    const mask = buildScanlineMaskFromRgba(rgba, 10, 4, 'threshold');
    expect(mask.rowRuns[0]).toEqual([]);
    expect(mask.rowRuns[1]).toEqual([[0.2, 0.8]]);
    expect(mask.rowRuns[2]).toEqual([[0.2, 0.8]]);
    expect(mask.rowRuns[3]).toEqual([]);

    const fakePng = 'data:image/png;base64,iVBORw0KGgo=';
    const rasterDesign = {
      ...sampleOrder.labelDesign,
      elements: [
        {
          id: 'logo-raster',
          type: 'logo_raster' as const,
          name: 'Logo Raster',
          visible: true,
          locked: false,
          xMm: 10,
          yMm: 5,
          widthMm: 10,
          heightMm: 4,
          aspectRatio: 2.5,
          lockAspectRatio: true,
          rotationDeg: 0,
          mirrored: false,
          operationLayer: 'ENGRAVE' as const,
          originalDataUrl: fakePng,
          processedDataUrl: fakePng,
          pixelWidth: 100,
          pixelHeight: 40,
          processing: {
            mode: 'raster' as const,
            threshold: 175,
            ditherStrength: 0.5,
            invert: false,
            contrast: 1.1,
            brightness: 0,
            gamma: 1,
            removeLightBackground: true,
            removeBackground: true,
            turdSize: 2,
            backgroundTolerance: 24,
            preserveLogoDetail: true,
          },
          vectorizedPathsNormalized: [],
          effectiveDpi: 254,
        },
      ],
    };
    const rasterJob = createWorkbenchJobFromOrder({
      design: rasterDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Raster Logo',
      clientName: 'Cliente',
      orderId: 'ord-raster',
      existingJobs: [],
      config: userOriginCfg,
    });
    const engItem = rasterJob.instances[0].engraveItems.find(
      (it) => it.kind === 'raster_image'
    )!;
    const maskKey = buildRasterMaskCacheKey({
      dataUrl: engItem.dataUrl!,
      bboxWidthMm: engItem.boundingBox.width,
      bboxHeightMm: engItem.boundingBox.height,
      rotationDeg: engItem.rotationDeg ?? 0,
      mirrored: !!engItem.mirrored,
      lineIntervalMm: userOriginCfg.layers[0].lineIntervalMm || 0.08,
      ditherMode: userOriginCfg.layers[0].imageDitherMode ?? 'threshold',
    });
    const rdRaster = compileWorkbenchToRuidaRd(
      [rasterJob],
      userOriginCfg,
      new Map([[maskKey, mask]])
    );
    const emptyMask = { cols: 10, rows: 4, rowRuns: [[], [], [], []] };
    const rdRasterEmpty = compileWorkbenchToRuidaRd(
      [rasterJob],
      userOriginCfg,
      new Map([[maskKey, emptyMask]])
    );
    // Solo las 2 filas con tinta emiten (Move + Cut = 2 comandos c/u -> exactamente +4 comandos vs máscara vacía)
    expect(rdRaster.commandCount - rdRasterEmpty.commandCount).toBe(4);

    // En navegador (sin Tauri), probeVankRuidaConnection NO simula falso online (reachable === false)
    const probeBadIp = await probeVankRuidaConnection({ ip: 'bad-ip', port: 50200 });
    expect(probeBadIp.reachable).toBe(false);
    const probeWeb = await probeVankRuidaConnection({
      ip: '192.168.0.195',
      port: 50200,
    });
    expect(probeWeb.reachable).toBe(false);
    expect(probeWeb.udp_handshake_ok).toBe(false);

    await expect(
      uploadRdBytesToVankRuida({
        ip: 'invalid-ip',
        port: 50200,
        rdBytes: rdUser.rdBytes,
      })
    ).rejects.toThrow('Dirección IP inválida');
  });

  it('20. Emite CA 41 (Scan vs Cut), CA 01 05, miniaturas LCD LightBurn E7 11/12 y relleno vectorial analítico par-impar', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG.find(
      (m) => m.id === 'ECOCUERO_SUELA'
    )!;
    const baseCfg = createDefaultWorkbenchConfig(730, 600, ecocueroMat);
    const cfg = {
      ...baseCfg,
      layers: baseCfg.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 600 : 100,
        maxPowerPercent: l.role === 'ENGRAVE' ? 30 : 100,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 80,
        lineIntervalMm: l.role === 'ENGRAVE' ? 0.073 : l.lineIntervalMm,
        bidirectional: true,
      })),
    };

    const orders = createInitialOrdersCatalog();
    const order = orders[0];
    const nesting = computeNestingLayout(order.labelDesign, {
      ...order.nestingConfig,
      sheetWidthMm: 730,
      sheetHeightMm: 600,
    });
    const job = createWorkbenchJobFromOrder({
      design: order.labelDesign,
      nesting,
      mode: 'active_batch',
      projectName: 'Churitas',
      clientName: 'Cliente',
      orderId: 'ord-churitas',
      existingJobs: [],
      config: cfg,
    });

    const compiled = compileWorkbenchToRuidaRd([job], cfg);
    const raw = compiled.rawUnscrambledBytes;

    const findSubseq = (seq: number[]): number => {
      for (let i = 0; i <= raw.length - seq.length; i++) {
        let ok = true;
        for (let j = 0; j < seq.length; j++) {
          if (raw[i + j] !== seq[j]) {
            ok = false;
            break;
          }
        }
        if (ok) return i;
      }
      return -1;
    };

    // CA 41: C00 en Scan Bidireccional Horizontal (0x02), C01 y C02 en Línea/Corte (0x00)
    expect(findSubseq([0xca, 0x41, 0x00, 0x02])).toBeGreaterThan(-1);
    expect(findSubseq([0xca, 0x41, 0x01, 0x00])).toBeGreaterThan(-1);
    expect(findSubseq([0xca, 0x41, 0x02, 0x00])).toBeGreaterThan(-1);
    // Bandera inline Scan CA 01 05 seguido de CA 01 02 y capa C00 (sin E7 11/12 que RDC8445S hwType 0x13 rechaza)
    expect(findSubseq([0xca, 0x01, 0x05, 0xca, 0x01, 0x02, 0xca, 0x02, 0x00])).toBeGreaterThan(-1);
    expect(findSubseq([0xe7, 0x11])).toBe(-1);
    expect(findSubseq([0xe7, 0x12])).toBe(-1);
    expect(findSubseq([0xea, 0x00])).toBeGreaterThan(-1);
    expect(findSubseq([0xeb])).toBeGreaterThan(findSubseq([0xea, 0x00]));

    // Miniaturas hardware RDC8445S (`E7 11` 144x144 -> 3x1010B, `E7 12` 300x300 -> 15x862B)
    const thumbs = buildRuidaThumbnailsCommands({
      visibleJobs: [job],
      boundsMm: compiled.boundingBoxMm,
      engraveIntervalMm: 0.073,
      engraveDitherMode: 'threshold',
    });
    const pkts11 = thumbs.filter((p) => p[0] === 0xe7 && p[1] === 0x11);
    const pkts12 = thumbs.filter((p) => p[0] === 0xe7 && p[1] === 0x12);
    expect(pkts11).toHaveLength(3);
    expect(pkts12).toHaveLength(15);
    expect(pkts11[0]).toHaveLength(1010);
    expect(pkts12[0]).toHaveLength(862);
    // Todos los bytes de datos de miniatura deben ser de 7 bits seguros (< 0x80) para nunca confundirse con comandos Ruida (>= 0x80)
    for (const pkt of [...pkts11, ...pkts12]) {
      for (const b of pkt.slice(2)) {
        expect(b).toBeLessThan(0x80);
      }
    }
    // Al menos un paquete de miniatura debe contener bits encendidos
    expect(
      pkts12.some((p) => p.slice(2).some((b) => b !== 0))
    ).toBe(true);

    // Empaquetado exacto bit-0 = pixel(0, H-1) -> bit 6 del primer byte
    const bmp144 = new Uint8Array(144 * 144);
    bmp144[143 * 144 + 0] = 1; // fila inferior izquierda
    const e11 = encodeRuidaThumbnailPackets(bmp144, 144);
    expect(e11[0][2]).toBe(0x40);

    // Relleno vectorial analítico par-impar: cuadrado exterior 10x10 con hueco interior 4x4
    const outerPoly = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const innerHole = {
      closed: true,
      points: [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
    };
    const fillRows = rasterizePolylinesToHorizontalRuns(
      [outerPoly, innerHole],
      0,
      10,
      0,
      10,
      1
    );
    const middleRow = fillRows.find((r) => r.yMm >= 4.4 && r.yMm <= 5.6)!;
    expect(middleRow.runsMm).toEqual([
      [0, 3],
      [7, 10],
    ]);
  });

  it('21. Barrido simultáneo por fila en C00 (todas las columnas juntas) y transición limpia C00→C01→C02 (CA 01 30/10 + CA 03 00)', () => {
    const eco = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
    const base = createDefaultWorkbenchConfig(730, 600, eco);
    const cfg = {
      ...base,
      engraveGrouping: 'all_at_once' as const,
      layers: base.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 600 : 100,
        maxPowerPercent: l.role === 'ENGRAVE' ? 30 : 100,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 80,
      })),
    };

    const fakePng = 'data:image/png;base64,iVBORw0KGgo=';
    const baseOrders = createInitialOrdersCatalog();
    const rasterDesign = {
      ...baseOrders[0].labelDesign,
      widthMm: 20,
      heightMm: 10,
      holes: { ...baseOrders[0].labelDesign.holes, preset: 'two_horizontal' as const },
      elements: [
        {
          id: 'logo-row-sweep',
          type: 'logo_raster' as const,
          name: 'Logo Sweep',
          visible: true,
          locked: false,
          xMm: 10,
          yMm: 5,
          widthMm: 12,
          heightMm: 6,
          aspectRatio: 2,
          lockAspectRatio: true,
          rotationDeg: 0,
          mirrored: false,
          operationLayer: 'ENGRAVE' as const,
          originalDataUrl: fakePng,
          processedDataUrl: fakePng,
          pixelWidth: 100,
          pixelHeight: 50,
          processing: {
            mode: 'raster' as const,
            threshold: 175,
            ditherStrength: 0.5,
            invert: false,
            contrast: 1.1,
            brightness: 0,
            gamma: 1,
            removeLightBackground: true,
            removeBackground: true,
            turdSize: 2,
            backgroundTolerance: 24,
            preserveLogoDetail: true,
          },
          vectorizedPathsNormalized: [],
          effectiveDpi: 254,
        },
      ],
    };

    // 3 columnas en la misma fila horizontal + agujeros + corte exterior
    const job = createWorkbenchJobFromOrder({
      design: rasterDesign,
      nesting: computeNestingLayout(rasterDesign, {
        ...baseOrders[0].nestingConfig,
        sheetWidthMm: 730,
        sheetHeightMm: 600,
      }),
      mode: 'custom_grid',
      customColumns: 3,
      customRows: 1,
      projectName: 'Sweep Row',
      clientName: 'Cliente',
      orderId: 'ord-sweep',
      existingJobs: [],
      config: cfg,
    });

    const engItem = job.instances[0].engraveItems[0];
    const maskKey = buildRasterMaskCacheKey({
      dataUrl: engItem.dataUrl!,
      bboxWidthMm: engItem.boundingBox.width,
      bboxHeightMm: engItem.boundingBox.height,
      rotationDeg: engItem.rotationDeg ?? 0,
      mirrored: !!engItem.mirrored,
      lineIntervalMm: cfg.layers[0].lineIntervalMm || 0.08,
      ditherMode: cfg.layers[0].imageDitherMode ?? 'threshold',
    });
    // 2 filas oscuras: la fila 0 debe barrer las 3 etiquetas (3 cortes en Y0) antes de bajar a Y1
    const twoRowMask: RasterScanlineMask = {
      cols: 12,
      rows: 2,
      rowRuns: [[[0.1, 0.9]], [[0.1, 0.9]]],
    };

    const compiled = compileWorkbenchToRuidaRd(
      [job],
      cfg,
      new Map([[maskKey, twoRowMask]])
    );
    const raw = compiled.rawUnscrambledBytes;

    // Verificar los 3 cambios de capa C00 (Scan) -> C01 (Cut) -> C02 (Cut) con CA 01 30/10 y CA 03 00
    const findSub = (seq: number[], from = 0): number => {
      for (let i = from; i <= raw.length - seq.length; i++) {
        if (seq.every((v, k) => raw[i + k] === v)) return i;
      }
      return -1;
    };
    const c00Idx = findSub([0xca, 0x01, 0x05, 0xca, 0x01, 0x02, 0xca, 0x02, 0x00, 0xca, 0x01, 0x30, 0xca, 0x01, 0x10]);
    const c01Idx = findSub([0xca, 0x01, 0x00, 0xca, 0x02, 0x01, 0xca, 0x01, 0x30, 0xca, 0x01, 0x10], c00Idx + 1);
    const c02Idx = findSub([0xca, 0x01, 0x00, 0xca, 0x02, 0x02, 0xca, 0x01, 0x30, 0xca, 0x01, 0x10], c01Idx + 1);
    expect(c00Idx).toBeGreaterThan(-1);
    expect(c01Idx).toBeGreaterThan(c00Idx);
    expect(c02Idx).toBeGreaterThan(c01Idx);
    // Tube 1 activo explícitamente (CA 03 01) y retardos C6 12/13 tanto en grabado como en corte
    expect(findSub([0xca, 0x03, 0x01], c00Idx)).toBeGreaterThan(c00Idx);
    expect(findSub([0xca, 0x03, 0x01], c01Idx)).toBeGreaterThan(c01Idx);
    expect(findSub([0xca, 0x03, 0x01], c02Idx)).toBeGreaterThan(c02Idx);
    expect(findSub([0xc6, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00], c01Idx)).toBeGreaterThan(c01Idx);
    expect(findSub([0xc6, 0x13, 0x00, 0x00, 0x00, 0x00, 0x00], c01Idx)).toBeGreaterThan(c01Idx);
    // Layer bank RDC8445S completo: E7 52/53/61/62 + CA 06 colores + CA 22 maxLayer + EA 00 .. EB sin thumbnails E7 11/12
    expect(findSub([0xe7, 0x52, 0x01])).toBeGreaterThan(-1);
    expect(findSub([0xe7, 0x53, 0x02])).toBeGreaterThan(-1);
    expect(findSub([0xca, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])).toBeGreaterThan(-1);
    expect(findSub([0xca, 0x06, 0x01, 0x00, 0x07, 0x7c, 0x00, 0x00])).toBeGreaterThan(-1);
    expect(findSub([0xca, 0x06, 0x02, 0x00, 0x00, 0x00, 0x01, 0x7f])).toBeGreaterThan(-1);
    expect(findSub([0xca, 0x22, 0x02])).toBeGreaterThan(-1);
    expect(findSub([0xea, 0x00])).toBeGreaterThan(-1);
    expect(findSub([0xea, 0x00])).toBeLessThan(c00Idx);
    expect(findSub([0xe7, 0x11])).toBe(-1);
    expect(findSub([0xeb], c02Idx)).toBeGreaterThan(c02Idx);

    // Extraer coordenadas Y de los cortes en C00 (0xA8 o 0xAA): en Y0 deben ocurrir 3 cortes seguidos y luego 3 en Y1
    let curX = 0;
    let curY = 0;
    const cutYs: number[] = [];
    for (let i = c00Idx; i < c01Idx; ) {
      const b = raw[i];
      if (b === 0x88 && i + 10 < c01Idx) {
        curX = decodeRuidaAbsCoordMm(Array.from(raw.slice(i + 1, i + 6)));
        curY = decodeRuidaAbsCoordMm(Array.from(raw.slice(i + 6, i + 11)));
        i += 11;
      } else if (b === 0xa8 && i + 10 < c01Idx) {
        curX = decodeRuidaAbsCoordMm(Array.from(raw.slice(i + 1, i + 6)));
        curY = decodeRuidaAbsCoordMm(Array.from(raw.slice(i + 6, i + 11)));
        cutYs.push(Math.round(curY * 100));
        i += 11;
      } else if ((b === 0x8a || b === 0xaa) && i + 2 < c01Idx) {
        if (b === 0xaa) cutYs.push(Math.round(curY * 100));
        i += 3;
      } else {
        i++;
      }
    }
    expect(cutYs).toHaveLength(6);
    // Los primeros 3 cortes comparten exactamente la misma fila Y (barriendo 3 etiquetas a la vez), luego los 3 siguientes bajan a Y1
    expect(cutYs[0]).toBe(cutYs[1]);
    expect(cutYs[1]).toBe(cutYs[2]);
    expect(cutYs[3]).toBe(cutYs[4]);
    expect(cutYs[4]).toBe(cutYs[5]);
    expect(cutYs[3]).not.toBe(cutYs[0]);
  });

  it('exporta plancha Vank 9060 en DXF R12 (1:1 mm) y Adobe Illustrator (.AI) con 3 capas precisas y vectorización automática de logos ráster', () => {
    const orders = createInitialOrdersCatalog();
    const cfg = createDefaultWorkbenchConfig(600, 400);
    const baseDesign = orders[0].labelDesign;
    const fakePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const rasterDesign = {
      ...baseDesign,
      holes: { ...baseDesign.holes, preset: 'two_horizontal' as const },
      elements: [
        {
          id: 'logo-vec-export',
          type: 'logo_raster' as const,
          name: 'Logo Export',
          visible: true,
          locked: false,
          xMm: 10,
          yMm: 5,
          widthMm: 12,
          heightMm: 6,
          aspectRatio: 2,
          lockAspectRatio: true,
          rotationDeg: 0,
          mirrored: false,
          operationLayer: 'ENGRAVE' as const,
          originalDataUrl: fakePng,
          processedDataUrl: fakePng,
          pixelWidth: 100,
          pixelHeight: 50,
          processing: {
            mode: 'raster' as const,
            threshold: 175,
            ditherStrength: 0.5,
            invert: false,
            contrast: 1.1,
            brightness: 0,
            gamma: 1,
            removeLightBackground: true,
            removeBackground: true,
            turdSize: 2,
            backgroundTolerance: 24,
            preserveLogoDetail: true,
          },
          vectorizedPathsNormalized: [],
          effectiveDpi: 254,
        },
      ],
    };
    const job = createWorkbenchJobFromOrder({
      design: rasterDesign,
      nesting: computeNestingLayout(rasterDesign, {
        ...orders[0].nestingConfig,
        sheetWidthMm: cfg.sheetWidthMm,
        sheetHeightMm: cfg.sheetHeightMm,
      }),
      mode: 'custom_grid',
      customColumns: 3,
      customRows: 1,
      projectName: 'Etiquetas Precision',
      clientName: 'Cliente',
      orderId: 'ord-vec-exp',
      existingJobs: [],
      config: cfg,
    });

    // Máscara de logo ráster con hueco interior (anillo) para verificar contornos cerrados
    const holeRingMask: RasterScanlineMask = {
      cols: 10,
      rows: 10,
      rowRuns: [
        [[0.0, 1.0]],
        [[0.0, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 0.3], [0.7, 1.0]],
        [[0.0, 1.0]],
        [[0.0, 1.0]],
      ],
    };
    const tracedLoops = extractClosedContoursFromRasterMask(holeRingMask, 10, 20, 30, 40);
    expect(tracedLoops.length).toBeGreaterThanOrEqual(2); // contorno exterior + hueco interior

    const rasterMasks = new Map<string, RasterScanlineMask>();
    for (const eng of job.instances[0]?.engraveItems || []) {
      if (eng.kind === 'raster_image' && eng.dataUrl) {
        const key = buildRasterMaskCacheKey({
          dataUrl: eng.dataUrl,
          bboxWidthMm: Math.max(0.5, eng.boundingBox.width || eng.widthMm || 10),
          bboxHeightMm: Math.max(0.5, eng.boundingBox.height || eng.heightMm || 10),
          rotationDeg: eng.rotationDeg ?? 0,
          mirrored: !!eng.mirrored,
          lineIntervalMm: Math.max(0.03, cfg.layers[0].lineIntervalMm || 0.08),
          ditherMode: cfg.layers[0].imageDitherMode ?? 'threshold',
        });
        rasterMasks.set(key, holeRingMask);
      }
    }

    const dxfArt = exportWorkbenchToDxf([job], cfg, rasterMasks, 'Etiquetas Precision');
    expect(dxfArt.pieceCount).toBe(3);
    expect(dxfArt.cutContourCount).toBe(3);
    expect(dxfArt.engravePolylineCount).toBeGreaterThan(0);
    const dxfAudit = parseAndAuditDxfR12(dxfArt.dxfContent);
    expect(dxfAudit.isValid).toBe(true);
    expect(dxfArt.dxfContent).toContain('$INSUNITS\n70\n4');
    expect(dxfArt.dxfContent).toContain('GRABADO');
    expect(dxfArt.dxfContent).toContain('AGUJEROS');
    expect(dxfArt.dxfContent).toContain('CORTE');

    const aiArt = exportWorkbenchToAi([job], cfg, rasterMasks, 'Etiquetas Precision');
    expect(aiArt.pieceCount).toBe(3);
    expect(aiArt.cutContourCount).toBe(3);
    expect(aiArt.engraveContourCount).toBeGreaterThan(0);
    expect(aiArt.aiContent).toContain('%!PS-Adobe-3.0');
    expect(aiArt.aiContent).toContain('%%HiResBoundingBox: 0.0000 0.0000');
    expect(aiArt.aiContent).toContain('%LayerName: GRABADO');
    expect(aiArt.aiContent).toContain('%LayerName: AGUJEROS');
    expect(aiArt.aiContent).toContain('%LayerName: CORTE');
    expect(aiArt.filenameSuggested.endsWith('.ai')).toBe(true);
  });
});
