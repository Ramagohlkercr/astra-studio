import { describe, expect, it } from 'vitest';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { computeNestingLayout } from '../nesting/nestingEngine';
import { createInitialOrdersCatalog } from '../projects/projectManager';
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../workbench/lbrn2Exporter';
import {
  buildRuidaUdpPackets,
  compileWorkbenchToRuidaRd,
  decodeRuidaAbsCoordMm,
  decodeRuidaPowerPercent,
  encodeRuidaAbsCoordMm,
  encodeRuidaPowerPercent,
  scrambleRuidaByte,
  unscrambleRuidaByte,
} from '../workbench/ruidaCompiler';
import {
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  computeJobOriginPointMm,
  createWorkbenchJobFromOrder,
  simulateWorkbenchToolpath,
  updateWorkbenchJobGrid,
  validateWorkbenchState,
} from '../workbench/workbenchEngine';
import { createDefaultWorkbenchConfig } from '../workbench/workbenchTypes';

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
    // Verificar inicio D8 00 y fin D7 en bytes sin ofuscar
    expect(rdArtifact.rawUnscrambledBytes[0]).toBe(0xd8);
    expect(rdArtifact.rawUnscrambledBytes[1]).toBe(0x00);
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
});
