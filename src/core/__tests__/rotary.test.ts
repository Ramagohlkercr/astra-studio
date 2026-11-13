import {describe, it, expect} from 'vitest';
import {computeRotaryLayout, DEFAULT_ROTARY_CONFIG, rotaryCircumferenceMm} from '../rotary/rotaryEngine';
import {exportRotarySvg} from '../exporters/rotaryExporter';
import {createInitialOrdersCatalog} from '../projects/projectManager';

const base = () => ({...createInitialOrdersCatalog()[0].labelDesign, widthMm: 80, heightMm: 40});

describe('Rotary layout', () => {
  it('computes circumference and centers the design', () => {
    const l = computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 75, usefulLengthMm: 100}, base());
    expect(l.valid).toBe(true);
    expect(l.circumferenceMm).toBeCloseTo(rotaryCircumferenceMm(75), 4);
    expect(l.canvasHeightMm).toBeCloseTo(235.6194, 3);
    expect(l.offsetXMm).toBe(10);
    expect(l.offsetYMm).toBeCloseTo((235.6194 - 40) / 2, 3);
  });
  it('limits the canvas to the chosen arc', () => {
    const l = computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, arcDeg: 180}, base());
    expect(l.arcLengthMm).toBeCloseTo(l.circumferenceMm / 2, 3);
  });
  it('rejects designs that do not fit', () => {
    expect(computeRotaryLayout(DEFAULT_ROTARY_CONFIG, {widthMm: 120, heightMm: 40}).valid).toBe(false);
    expect(computeRotaryLayout(DEFAULT_ROTARY_CONFIG, {widthMm: 80, heightMm: 300}).valid).toBe(false);
  });
  it('rejects invalid configuration', () => {
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 0}, base()).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, arcDeg: 400}, base()).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, usefulLengthMm: 1000}, base()).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, objectDiameterMm: NaN}, base()).valid).toBe(false);
  });
});

describe('Rotary export', () => {
  it('writes an engrave-only 1:1 mm SVG', () => {
    const a = exportRotarySvg(base(), DEFAULT_ROTARY_CONFIG);
    expect(a.svgContent).toContain(`width="${a.widthMm}mm"`);
    expect(a.svgContent).toContain(`height="${a.heightMm}mm"`);
    expect(a.svgContent).not.toContain('CAPA_02_CORTE');
    expect(a.svgContent).not.toContain('CAPA_01_AGUJEROS');
    expect(a.instructionsText).toContain('Circunferencia');
  });
  it('throws when the layout is invalid', () => {
    expect(() => exportRotarySvg({...base(), widthMm: 500}, DEFAULT_ROTARY_CONFIG)).toThrow();
  });
});
