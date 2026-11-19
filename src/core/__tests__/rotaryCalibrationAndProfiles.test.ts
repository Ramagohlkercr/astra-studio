import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeRotaryLayout,
  DEFAULT_ROTARY_CONFIG,
  RotaryConfig,
  sanitizeRotaryConfig,
  correctedRotarySteps,
} from '../rotary/rotaryEngine';
import {
  DEFAULT_ROTARY_ACCESSORY_PROFILES,
  loadRotaryAccessoryProfiles,
  saveRotaryAccessoryProfile,
  deleteRotaryAccessoryProfile,
  sanitizeAccessoryProfile,
  computeLinearCalibratedSteps,
  addRotaryCalibrationRecord,
  loadRotaryCalibrationHistory,
  clearRotaryCalibrationHistory,
} from '../rotary/rotaryProfiles';
import {
  exportRotarySvg,
  exportRotaryDxf,
  exportRotaryTestPatternSvg,
} from '../exporters/rotaryExporter';
import { LabelDesign, LabelElement } from '../types';

function createMockDesign(elements: LabelElement[] = []): LabelDesign {
  return {
    id: 'test-rotary-label',
    name: 'Logo Botella',
    shape: 'rectangle',
    widthMm: 40,
    heightMm: 30,
    cornerRadiusMm: 0,
    safetyMarginMm: 2,
    kerfCompensationMm: 0,
    holes: { preset: 'none', diameterMm: 2, edgeDistanceMm: 2, customHoles: [] },
    elements,
  };
}

function createTextElement(id = 'text-1', visible = true): LabelElement {
  return {
    id,
    name: 'Texto Marca',
    type: 'vector_text',
    xMm: 20,
    yMm: 15,
    widthMm: 30,
    heightMm: 10,
    aspectRatio: 3,
    lockAspectRatio: true,
    rotationDeg: 0,
    locked: false,
    visible,
    text: 'ASTRA',
    fontSizeMm: 8,
    letterSpacingMm: 0.5,
    fontStyle: 'sans_industrial',
    strokeWidthMm: 0.3,
  };
}

describe('Módulo Rotativo — Profesionalización Etapa 1', () => {
  beforeEach(() => {
    clearRotaryCalibrationHistory();
  });

  describe('1. Perfiles de accesorios rotativos (Rodillos vs. Mandril)', () => {
    it('carga perfiles predeterminados de taller diferenciando rodillos y mandril', () => {
      const profiles = loadRotaryAccessoryProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(2);

      const roller = profiles.find((p) => p.type === 'roller');
      expect(roller).toBeDefined();
      expect(roller?.rollerDiameterMm).toBe(50.0);
      expect(roller?.stepsPerRotation).toBe(3200);

      const chuck = profiles.find((p) => p.type === 'chuck');
      expect(chuck).toBeDefined();
      expect(chuck?.rollerDiameterMm).toBeUndefined();
      expect(chuck?.stepsPerRotation).toBe(3200);
    });

    it('sanitiza perfiles correctamente y descarta configuraciones inválidas', () => {
      expect(sanitizeAccessoryProfile(null)).toBeNull();
      expect(sanitizeAccessoryProfile({})).toBeNull();
      expect(sanitizeAccessoryProfile({ id: '1', name: '' })).toBeNull();
      expect(sanitizeAccessoryProfile({ id: '1', name: 'Test', stepsPerRotation: -5 })).toBeNull();

      const validChuck = sanitizeAccessoryProfile({
        id: 'c1',
        name: 'Mandril K11',
        type: 'chuck',
        stepsPerRotation: 6400,
        rotationDirection: 'inverted',
      });
      expect(validChuck).toMatchObject({
        id: 'c1',
        name: 'Mandril K11',
        type: 'chuck',
        stepsPerRotation: 6400,
        rotationDirection: 'inverted',
      });
    });

    it('permite registrar y persistir un nuevo perfil de accesorio', () => {
      const custom = {
        id: 'custom-roller-60',
        name: 'Rodillos Grandes 60mm',
        type: 'roller' as const,
        rollerDiameterMm: 60.0,
        stepsPerRotation: 5000,
        rotationDirection: 'normal' as const,
      };
      const updated = saveRotaryAccessoryProfile(custom);
      expect(updated.some((p) => p.id === 'custom-roller-60')).toBe(true);

      const deleted = deleteRotaryAccessoryProfile('custom-roller-60');
      expect(deleted.some((p) => p.id === 'custom-roller-60')).toBe(false);
    });
  });

  describe('2. Asistente de calibración (Giro, Calibre lineal y Sentido)', () => {
    it('calcula pasos corregidos con método angular 360°', () => {
      // Si con 3200 pasos dio 350° (quedó corto), necesita más pasos
      const steps = correctedRotarySteps(3200, 350);
      expect(steps).toBeCloseTo(3291.429, 2);

      // Si con 3200 pasos dio 370° (se pasó), necesita menos pasos
      const stepsOver = correctedRotarySteps(3200, 370);
      expect(stepsOver).toBeCloseTo(3113.514, 2);

      // Desecha mediciones no finitas o menores o iguales a cero
      expect(correctedRotarySteps(3200, 0)).toBeNull();
      expect(correctedRotarySteps(0, 360)).toBeNull();
    });

    it('calcula pasos corregidos con método lineal (medición con calibre)', () => {
      // Cota esperada: 50 mm. Cota real medida con calibre: 48.5 mm (grabó más chico -> faltan pasos)
      const steps = computeLinearCalibratedSteps(3200, 50, 48.5);
      expect(steps).toBeCloseTo((3200 * 50) / 48.5, 3);
      expect(steps).toBeGreaterThan(3200);

      // Cota esperada: 50 mm. Cota real medida: 52.0 mm (grabó más grande -> sobran pasos)
      const stepsDown = computeLinearCalibratedSteps(3200, 50, 52);
      expect(stepsDown).toBeCloseTo((3200 * 50) / 52, 3);
      expect(stepsDown).toBeLessThan(3200);

      // Desecha mediciones absurdas o errores de dedo
      expect(computeLinearCalibratedSteps(3200, 50, 0)).toBeNull();
      expect(computeLinearCalibratedSteps(3200, 50, 1000)).toBeNull(); // ratio 0.05
    });

    it('registra y recupera historial de calibraciones con metadatos reales', () => {
      const record = addRotaryCalibrationRecord({
        accessoryId: 'vank-roller-standard',
        accessoryName: 'Rotativo de Rodillos Vank 9060',
        method: 'linear_caliper',
        initialSteps: 3200,
        expectedValue: 50,
        measuredValue: 49.2,
        computedSteps: 3252.033,
        operatorNotes: 'Prueba en vaso recto con cinta de pintor',
      });

      expect(record.id).toMatch(/^calib-/);
      expect(record.timestampIso).toBeDefined();

      const history = loadRotaryCalibrationHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].computedSteps).toBe(3252.033);
    });

    it('sanitiza y preserva el sentido de giro en RotaryConfig', () => {
      const normalConfig = sanitizeRotaryConfig({
        ...DEFAULT_ROTARY_CONFIG,
        rotationDirection: 'normal',
      });
      expect(normalConfig?.rotationDirection).toBe('normal');

      const invertedConfig = sanitizeRotaryConfig({
        ...DEFAULT_ROTARY_CONFIG,
        rotationDirection: 'inverted',
      });
      expect(invertedConfig?.rotationDirection).toBe('inverted');
    });
  });

  describe('3. Patrón SVG de prueba y calibración con dimensiones conocidas', () => {
    it('genera un patrón de calibración métrico 1:1 con cotas y dirección exactas', () => {
      const config: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 75,
        usefulLengthMm: 120,
        arcDeg: 360,
        rotationDirection: 'normal',
      };

      const pattern = exportRotaryTestPatternSvg(config, 50);
      expect(pattern.svgContent).toContain('<svg');
      expect(pattern.svgContent).toContain('width="120mm"');
      expect(pattern.targetSquareMm).toBe(50);

      // Contiene el cuadrado de calibración en la capa de grabado (00)
      expect(pattern.svgContent).toContain('id="CAPA_00_GRABADO"');
      expect(pattern.svgContent).toContain('cuadrado_calibracion_50mm');
      expect(pattern.svgContent).toContain('COTA X (AXIAL): 50.00 mm');
      expect(pattern.svgContent).toContain('COTA Y (GIRO): 50.00 mm');

      // Contiene flecha de sentido de giro
      expect(pattern.svgContent).toContain('flecha_eje_y');
      expect(pattern.svgContent).toContain('SENTIDO GIRO: NORMAL (+Y)');

      // Contiene guías T1 de encuadre
      expect(pattern.svgContent).toContain('id="GUIAS_T1"');

      // Contiene instrucciones para calibración con calibre
      expect(pattern.instructionsText).toContain('PROCEDIMIENTO DE CALIBRACIÓN CON CALIBRE');
      expect(pattern.instructionsText).toContain('50.00 mm');
    });

    it('adapta el cuadrado del patrón si el objeto tiene dimensiones menores', () => {
      const smallConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 15, // Circunferencia ~ 47.1 mm
        usefulLengthMm: 30,
        arcDeg: 360,
      };

      const pattern = exportRotaryTestPatternSvg(smallConfig, 50);
      // El cuadrado debe adaptarse automáticamente para no desbordar el objeto
      expect(pattern.targetSquareMm).toBeLessThan(30);
      expect(pattern.svgContent).toContain(`cuadrado_calibracion_${pattern.targetSquareMm}mm`);
    });
  });

  describe('4. Validación y bloqueo estricto de exportación sin grabado o con errores', () => {
    it('rechaza exportar SVG si el diseño no tiene elementos de grabado visibles', () => {
      const emptyDesign = createMockDesign([]);
      expect(() => exportRotarySvg(emptyDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );

      const invisibleDesign = createMockDesign([createTextElement('t1', false)]);
      expect(() => exportRotarySvg(invisibleDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );
    });

    it('rechaza exportar DXF si el diseño no tiene trazados vectoriales o elementos', () => {
      const emptyDesign = createMockDesign([]);
      expect(() => exportRotaryDxf(emptyDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );
    });

    it('informa error en layout si el diseño no tiene elementos visibles', () => {
      const layoutEmpty = computeRotaryLayout(DEFAULT_ROTARY_CONFIG, {
        widthMm: 40,
        heightMm: 20,
        elements: [],
      });
      expect(layoutEmpty.valid).toBe(false);
      expect(layoutEmpty.errors.some((e) => e.includes('no contiene elementos de grabado'))).toBe(true);

      const layoutValid = computeRotaryLayout(DEFAULT_ROTARY_CONFIG, {
        widthMm: 40,
        heightMm: 20,
        elements: [createTextElement('t1', true)],
      });
      expect(layoutValid.valid).toBe(true);
    });

    it('valida límites físicos de la Vank 9060 (ancho 900mm y aviso de diámetro)', () => {
      const overflowConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        usefulLengthMm: 950, // mayor que 900
      };
      const l = computeRotaryLayout(overflowConfig, { widthMm: 40, heightMm: 20 });
      expect(l.valid).toBe(false);
      expect(l.errors.some((e) => e.includes('supera el ancho de la máquina'))).toBe(true);

      const largeDConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 280, // objeto muy grande, advertir altura Z
      };
      const l2 = computeRotaryLayout(largeDConfig, { widthMm: 40, heightMm: 20 });
      expect(l2.warnings.some((w) => w.includes('altura libre del eje Z'))).toBe(true);
    });
  });

  describe('5. Cilindros, Conos, Múltiples Copias y Retrocompatibilidad', () => {
    it('exporta correctamente diseño vectorial en cilindro recto con instrucciones completas', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const config: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        accessoryProfileId: 'vank-roller-standard',
        rotationDirection: 'normal',
        objectDiameterMm: 75,
        usefulLengthMm: 100,
        arcDeg: 360,
        stepsPerRotation: 3200,
      };

      const result = exportRotarySvg(design, config);
      expect(result.svgContent).toContain('<path id="rotativo-t1"');
      expect(result.svgContent).toContain('data-rotary-direction="normal"');
      expect(result.engravePathCount).toBeGreaterThan(0);
      expect(result.instructionsText).toContain('Perfil de accesorio: vank-roller-standard');
      expect(result.instructionsText).toContain('Sentido de giro: Normal (+Y)');
    });

    it('aplica compensación en objetos cónicos y exporta arte pre-deformado', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const conicConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 90,
        endDiameterMm: 65, // Cono: boca 90mm, base 65mm
        usefulLengthMm: 120,
        arcDeg: 360,
      };

      const result = exportRotarySvg(design, conicConfig);
      expect(result.svgContent).toContain('data-rotary-tapered="true"');
      expect(result.instructionsText).toContain('Objeto cónico');
      expect(result.instructionsText).toContain('diámetro de referencia');
    });

    it('distribuye múltiples copias equidistantes alrededor del objeto', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const multiConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 80,
        usefulLengthMm: 100,
        arcDeg: 360,
        repeatCount: 2, // Frente y dorso
      };

      const layout = computeRotaryLayout(multiConfig, design);
      expect(layout.valid).toBe(true);
      expect(layout.placements.length).toBe(2);
      expect(layout.placements[1].centerYMm - layout.placements[0].centerYMm).toBeCloseTo(layout.copyPitchMm, 2);

      const svg = exportRotarySvg(design, multiConfig);
      expect(svg.svgContent).toContain('data-rotary-copies="2"');
    });

    it('mantiene retrocompatibilidad con configuraciones antiguas guardadas', () => {
      const legacyRaw = {
        objectDiameterMm: 70,
        usefulLengthMm: 110,
        arcDeg: 180,
        rotaryType: 'chuck',
      };
      const sanitized = sanitizeRotaryConfig(legacyRaw);
      expect(sanitized).toBeDefined();
      expect(sanitized?.rotaryType).toBe('chuck');
      expect(sanitized?.rotationDirection).toBe('normal');
      expect(sanitized?.accessoryProfileId).toBe('vank-roller-standard');
    });
  });
});
