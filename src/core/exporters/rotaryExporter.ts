import {compileLabelGeometry, roundMm} from '../geometry/geometryEngine';
import {computeRotaryLayout, RotaryConfig, warpPointForTaper} from '../rotary/rotaryEngine';
import {LabelDesign, LIGHTBURN_LAYERS, Point2D} from '../types';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/--/g, '—');
}

function sanitizeName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Rotativo_Astra';
}

const MAX_SEGMENT_MM = 0.5;

/** Subdivide segmentos largos para que la deformación cónica siga curvando las rectas. */
function densify(points: Point2D[], closed: boolean): Point2D[] {
  const out: Point2D[] = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / MAX_SEGMENT_MM));
    for (let k = 0; k < steps; k++) out.push({x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps});
  }
  if (!closed && n > 0) out.push(points[n - 1]);
  return out;
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
    if (layout.tapered) {
      if (eng.kind !== 'vector_path' || !eng.polylines?.length) {
        throw new Error('Las imágenes raster no se pueden compensar en objetos cónicos: usá logos vectoriales, texto o imágenes vectorizadas.');
      }
      const d = eng.polylines.map(pl => {
        const pts = densify(pl.points, pl.closed).map(p => warpPointForTaper(config, layout.canvasHeightMm, p.x, p.y));
        return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (pl.closed ? ' Z' : '');
      }).join(' ');
      engravePathCount++;
      if (eng.filled) {
        nodes.push(`    <path id="${xml(eng.id)}" d="${d}" fill="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" fill-rule="${eng.fillRule || 'evenodd'}" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="0.05" />`);
      } else {
        nodes.push(`    <path id="${xml(eng.id)}" d="${d}" fill="none" stroke="${LIGHTBURN_LAYERS.ENGRAVE.hexColor}" stroke-width="${roundMm(eng.strokeWidthMm || 0.3)}" stroke-linecap="round" stroke-linejoin="round" />`);
      }
      continue;
    }
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
    `  Objeto          : ${layout.tapered ? `cónico Ø ${config.objectDiameterMm} → ${config.endDiameterMm} mm (referencia ${layout.referenceDiameterMm} mm)` : `Ø ${config.objectDiameterMm} mm`} (circunferencia ${layout.circumferenceMm} mm), arco ${config.arcDeg}°`,
    `  Lienzo          : ${w} mm (eje X, largo del objeto) x ${h} mm (eje Y, giro del objeto)`,
    `  Capa 00 (#000000): GRABADO (${engravePathCount} elementos)`,
    `-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
    `  width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" version="1.1"`,
    `  data-generator="Astra Studio rotary" data-units="mm" data-rotary-diameter-mm="${layout.referenceDiameterMm}" data-rotary-tapered="${layout.tapered}" data-rotary-arc-deg="${config.arcDeg}">`,
    `  <g id="CAPA_00_GRABADO" inkscape:groupmode="layer" inkscape:label="00_GRABADO" data-layer="ENGRAVE" data-lightburn-layer="00">`,
    ...nodes,
    `  </g>`,
    `</svg>`,
  ];

  const base = `${sanitizeName(design.name)}_ROTATIVO_${layout.tapered ? 'CONICO_' : ''}D${layout.referenceDiameterMm}mm_${w}x${h}mm`;
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
    layout.tapered
      ? `Objeto cónico: Ø ${config.objectDiameterMm} mm (X=0) → Ø ${config.endDiameterMm} mm (X=${config.usefulLengthMm}). CARGAR EN LA MÁQUINA Ø ${layout.referenceDiameterMm} mm (referencia). El arte ya está pre-compensado en Y.`
      : `Diámetro del objeto: ${config.objectDiameterMm} mm`,
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

export interface RotaryGuideArtifact {
  svgContent: string;
  filename: string;
}

/**
 * SVG de guías NO productivas (color T1 naranja) para prueba de encuadre sobre un objeto de descarte:
 * marco del área, cruz central, marco del diseño y línea de costura (Y=0). Nunca va en el archivo de producción.
 */
export function exportRotaryGuideSvg(design: LabelDesign, config: RotaryConfig): RotaryGuideArtifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) throw new Error(`Rotativo inválido: ${layout.errors.join(' ')}`);
  const w = layout.canvasWidthMm, h = layout.canvasHeightMm;
  const c = LIGHTBURN_LAYERS.GUIDE.hexColor;
  const st = `fill="none" stroke="${c}" stroke-width="0.1"`;
  const dx = layout.offsetXMm, dy = layout.offsetYMm;
  const body = [
    `    <rect id="area" x="0" y="0" width="${w}" height="${h}" ${st} />`,
    `    <rect id="diseno" x="${dx}" y="${dy}" width="${design.widthMm}" height="${design.heightMm}" ${st} />`,
    `    <path id="cruz-centro" d="M ${roundMm(w / 2 - 5)} ${roundMm(h / 2)} L ${roundMm(w / 2 + 5)} ${roundMm(h / 2)} M ${roundMm(w / 2)} ${roundMm(h / 2 - 5)} L ${roundMm(w / 2)} ${roundMm(h / 2 + 5)}" ${st} />`,
    `    <path id="costura" d="M 0 0 L ${w} 0" ${st} stroke-dasharray="3 2" />`,
  ];
  const svg = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!-- ASTRA STUDIO — GUÍAS DE ALINEACIÓN ROTATIVO (NO PRODUCTIVO). Usar sólo para encuadre/prueba en un objeto de descarte. -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" version="1.1" data-units="mm">`,
    `  <g id="GUIAS_T1" data-layer="GUIDE" data-lightburn-layer="T1">`,
    ...body,
    `  </g>`,
    `</svg>`,
  ].join('\n');
  return {svgContent: svg, filename: `${sanitizeName(design.name)}_ROTATIVO_GUIAS_ALINEACION_${w}x${h}mm.svg`};
}
