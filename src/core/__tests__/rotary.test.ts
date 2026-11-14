import {describe, it, expect} from 'vitest';
import {computeRotaryLayout, DEFAULT_ROTARY_CONFIG, rotaryCircumferenceMm, sanitizeRotaryConfig, warpPointForTaper, diameterAtX} from '../rotary/rotaryEngine';
import {exportRotarySvg, exportRotaryGuideSvg, exportRotaryDxf} from '../exporters/rotaryExporter';
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

describe('Rotary tapered objects', () => {
  const cone = {...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 60, endDiameterMm: 80, usefulLengthMm: 100};
  it('uses the average diameter as reference', () => {
    const l = computeRotaryLayout(cone, {widthMm: 40, heightMm: 40});
    expect(l.tapered).toBe(true);
    expect(l.referenceDiameterMm).toBe(70);
    expect(l.circumferenceMm).toBeCloseTo(Math.PI * 70, 3);
  });
  it('pre-compensates Y: narrower end stretches, wider end shrinks, center unchanged', () => {
    const h = 100; // línea central de la copia
    expect(warpPointForTaper(cone, h, 50, 150).y).toBeCloseTo(150, 3);
    expect(warpPointForTaper(cone, h, 0, 150).y).toBeGreaterThan(150);
    expect(warpPointForTaper(cone, h, 100, 150).y).toBeLessThan(150);
    expect(diameterAtX(cone, 0)).toBe(60);
    // arco real = y' * d(x)/dRef recupera el arco deseado
    const p = warpPointForTaper(cone, h, 0, 150);
    expect((p.y - 100) * diameterAtX(cone, 0) / 70).toBeCloseTo(50, 2);
  });
  it('rejects designs that do not fit the narrow end', () => {
    expect(computeRotaryLayout({...cone, objectDiameterMm: 20, endDiameterMm: 80}, {widthMm: 100, heightMm: 120}).valid).toBe(false);
  });
  it('exports warped vector art with reference diameter', () => {
    const d = {...base(), widthMm: 60, heightMm: 40};
    const a = exportRotarySvg(d, cone);
    expect(a.svgContent).toContain('data-rotary-tapered="true"');
    expect(a.instructionsText).toContain('CARGAR EN LA MÁQUINA');
  });
});

describe('Rotary guides and persistence', () => {
  it('guide SVG uses the non-productive T1 layer only', () => {
    const g = exportRotaryGuideSvg(base(), DEFAULT_ROTARY_CONFIG);
    expect(g.svgContent).toContain('data-lightburn-layer="T1"');
    expect(g.svgContent).not.toContain('#000000');
    expect(g.svgContent).not.toContain('#FF0000');
  });
  it('sanitizes stored configs', () => {
    expect(sanitizeRotaryConfig(undefined)).toBeUndefined();
    expect(sanitizeRotaryConfig({objectDiameterMm: 'x'})).toBeUndefined();
    const c = sanitizeRotaryConfig({objectDiameterMm: 60, endDiameterMm: 80, usefulLengthMm: 90, arcDeg: 180, rotaryType: 'chuck'});
    expect(c).toMatchObject({objectDiameterMm: 60, endDiameterMm: 80, usefulLengthMm: 90, arcDeg: 180, rotaryType: 'chuck', machineBedWidthMm: 900});
  });
});

describe('Rotary repeats, offsets and DXF', () => {
  const d = {widthMm: 30, heightMm: 40};
  it('spreads copies evenly around the circumference', () => {
    const l = computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 75, repeatCount: 3}, d);
    expect(l.valid).toBe(true);
    expect(l.placements).toHaveLength(3);
    expect(l.copyPitchMm).toBeCloseTo(l.circumferenceMm / 3, 3);
    expect(l.placements[1].centerYMm - l.placements[0].centerYMm).toBeCloseTo(l.copyPitchMm, 3);
  });
  it('rejects overlapping copies and invalid counts', () => {
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 75, repeatCount: 8}, d).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, repeatCount: 0}, d).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, repeatCount: 1.5}, d).valid).toBe(false);
  });
  it('applies axial and angular offsets and rejects out-of-range ones', () => {
    const l = computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, axisOffsetMm: 10, angularOffsetDeg: 30}, d);
    expect(l.valid).toBe(true);
    expect(l.offsetXMm).toBe(45);
    expect(l.placements[0].centerYMm - l.canvasHeightMm / 2).toBeCloseTo(l.circumferenceMm * 30 / 360, 2);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, axisOffsetMm: 60}, d).valid).toBe(false);
    expect(computeRotaryLayout({...DEFAULT_ROTARY_CONFIG, angularOffsetDeg: 170}, d).valid).toBe(false);
  });
  it('exports every copy in SVG and DXF', () => {
    const cfg = {...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 75, repeatCount: 2};
    const des = {...base(), widthMm: 60, heightMm: 40};
    const svg = exportRotarySvg(des, cfg);
    expect(svg.svgContent).toContain('data-rotary-copies="2"');
    const one = exportRotarySvg(des, {...cfg, repeatCount: 1});
    expect(svg.engravePathCount).toBe(one.engravePathCount * 2);
    const dxf = exportRotaryDxf(des, cfg);
    expect(dxf.dxfContent).toContain('AC1009');
    expect(dxf.dxfContent).toContain('GRABADO');
    expect(dxf.dxfContent).not.toContain('CORTE');
    expect(dxf.polylineCount).toBeGreaterThan(0);
  });
  it('warps each copy about its own center when tapered', () => {
    const cfg = {...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 60, endDiameterMm: 80, usefulLengthMm: 100, repeatCount: 2};
    const l = computeRotaryLayout(cfg, {widthMm: 40, heightMm: 40});
    expect(l.valid).toBe(true);
    const c = l.placements[1].centerYMm;
    expect(warpPointForTaper(cfg, c, 50, c + 10).y).toBeCloseTo(c + 10, 3);
  });
});
