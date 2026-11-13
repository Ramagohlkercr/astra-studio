import {compileLabelGeometry, roundMm} from '../geometry/geometryEngine';
import {computeRotaryLayout, RotaryConfig} from '../rotary/rotaryEngine';
import {LabelDesign, LIGHTBURN_LAYERS} from '../types';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/--/g, '—');
}

function sanitizeName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Rotativo_Astra';
}

export interface RotaryExportArtifact {
  svgContent: string;
  instructionsText: string;
  svgFilename: string;
  instructionsFilename: string;
  widthMm: number;
  heightMm: number;
  engravePathCount: number;
}

/**
 * SVG 1:1 mm sólo de grabado (capa 00) con el arte desenrollado sobre el objeto cilíndrico.
 * Lanza error si la configuración o el diseño no son válidos.
 */
export function exportRotarySvg(design: LabelDesign, config: RotaryConfig): RotaryExportArtifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) throw new Error(`Rotativo inválido: ${layout.errors.join(' ')}`);

  const compiled = compileLabelGeometry(design, {
    offsetXMm: layout.offsetXMm,
    offsetYMm: layout.offsetYMm,
    instanceIdPrefix: 'rotativo',
  });

  const nodes: string[] = [];
  let engravePathCount = 0;
  for (const eng of compiled.engravingItems) {
    if (eng.kind === 'vector_path' && eng.svgPathD) {
      engravePathCount++;
      if (eng.filled) {
        nodes.push(`    <path id="${xml(eng.id)}" d="${eng.svgPathD}" fill="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" fill-rule="${eng.fillRule || 'evenodd'}" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="0.05" />`);
      } else {
        const sw = roundMm(eng.strokeWidthMm || 0.3);
        nodes.push(`    <path id="${xml(eng.id)}" d="${eng.svgPathD}" fill="none" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`);
      }
    } else if (eng.kind === 'raster_image' && eng.dataUrl) {
      engravePathCount++;
      const rot = eng.rotationDeg
        ? ` transform="rotate(${eng.rotationDeg} ${roundMm((eng.xMm || 0) + (eng.widthMm || 0) / 2)} ${roundMm((eng.yMm || 0) + (eng.heightMm || 0) / 2)})"`
        : '';
      nodes.push(`    <image id="${xml(eng.id)}" x="${eng.xMm}" y="${eng.yMm}" width="${eng.widthMm}" height="${eng.heightMm}" preserveAspectRatio="none" href="${xml(eng.dataUrl)}"${rot} />`);
    }
  }

  const w = layout.canvasWidthMm;
  const h = layout.canvasHeightMm;
  const lines = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!--`,
    `  ASTRA STUDIO — ARCHIVO ROTATIVO (ESCALA REAL 1:1 EN MM, SÓLO GRABADO)`,
    `  Máquina destino : Vank 9060 CO2 + accesorio rotativo (${config.rotaryType === 'roller' ? 'rodillos' : 'mandril'})`,
    `  Objeto          : Ø ${config.objectDiameterMm} mm (circunferencia ${layout.circumferenceMm} mm), arco ${config.arcDeg}°`,
    `  Lienzo          : ${w} mm (eje X, largo del objeto) x ${h} mm (eje Y, giro del objeto)`,
    `  Capa 00 (#000000): GRABADO (${engravePathCount} elementos)`,
    `-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
    `  width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" version="1.1"`,
    `  data-generator="Astra Studio rotary" data-units="mm" data-rotary-diameter-mm="${config.objectDiameterMm}" data-rotary-arc-deg="${config.arcDeg}">`,
    `  <g id="CAPA_00_GRABADO" inkscape:groupmode="layer" inkscape:label="00_GRABADO" data-layer="ENGRAVE" data-lightburn-layer="00">`,
    ...nodes,
    `  </g>`,
    `</svg>`,
  ];

  const base = `${sanitizeName(design.name)}_ROTATIVO_D${config.objectDiameterMm}mm_${w}x${h}mm`;
  return {
    svgContent: lines.join('\n'),
    instructionsText: buildRotaryInstructions(design, config, layout),
    svgFilename: `${base}.svg`,
    instructionsFilename: `${base}_INSTRUCCIONES.txt`,
    widthMm: w,
    heightMm: h,
    engravePathCount,
  };
}

export function buildRotaryInstructions(design: LabelDesign, config: RotaryConfig, layout = computeRotaryLayout(config, design)): string {
  const rows = [
    'ASTRA STUDIO — INSTRUCCIONES DE ROTATIVO (Vank 9060 / Ruida RDC8445S)',
    '',
    `Diseño: ${design.name} (${design.widthMm} mm a lo largo del eje x ${design.heightMm} mm alrededor del objeto)`,
    `Tipo de rotativo: ${config.rotaryType === 'roller' ? 'rodillos' : 'mandril'}`,
    `Diámetro del objeto: ${config.objectDiameterMm} mm`,
    `Circunferencia: ${layout.circumferenceMm} mm`,
    `Arco a grabar: ${config.arcDeg}° (${layout.arcLengthMm} mm)`,
    `Diseño ocupa: ${layout.designArcDeg}° de la circunferencia, centrado en el lienzo`,
    `Lienzo del archivo: ${layout.canvasWidthMm} x ${layout.canvasHeightMm} mm`,
    '',
    'ANTES DE GRABAR (a cargar por el operador, la app NO los inventa):',
    '- Activar el rotativo en LightBurn (Rotary Setup) o en la Ruida, y cargar el diámetro del objeto indicado arriba.',
    config.rotaryType === 'roller'
      ? `- Cargar el diámetro de los rodillos${config.rollerDiameterMm ? ` (referencia: ${config.rollerDiameterMm} mm)` : ''} y verificar los pasos por vuelta.`
      : '- Verificar los pasos por vuelta del mandril.',
    '- Potencia, velocidad e intervalo de línea: validar con una prueba sobre un objeto de descarte.',
    '- Si el software de la máquina ya compensa el diámetro, NO volver a escalar el arte.',
    '- El eje Y del archivo es el giro del objeto: mantener el origen en la marca elegida como costura.',
    '- Probar primero con "Frame" para confirmar que el láser queda dentro del largo útil.',
    '',
    'Este archivo es sólo grabado: no incluye corte ni agujeros.',
  ];
  if (layout.warnings.length) rows.push('', 'ADVERTENCIAS:', ...layout.warnings.map(w => `- ${w}`));
  return rows.join('\n') + '\n';
}
