import {compileLabelGeometry, rasterImageTransform, roundMm} from '../geometry/geometryEngine';
import {computeRotaryLayout, RotaryConfig, RotaryLayout, warpPointForTaper} from '../rotary/rotaryEngine';
import {EngravedItemGeometry, LabelDesign, LIGHTBURN_LAYERS, Point2D} from '../types';

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

function toPathD(polylines: {points: Point2D[]; closed: boolean}[]): string {
  return polylines.map(pl => pl.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (pl.closed ? ' Z' : '')).join(' ');
}

/**
 * Compila el grabado de todas las copias del diseño ya ubicadas sobre el lienzo desenrollado,
 * aplicando la compensación cónica cuando corresponde.
 */
function collectRotaryArtwork(design: LabelDesign, config: RotaryConfig, layout: RotaryLayout): EngravedItemGeometry[] {
  const items: EngravedItemGeometry[] = [];
  layout.placements.forEach((placement, k) => {
    const compiled = compileLabelGeometry(design, {
      offsetXMm: placement.offsetXMm,
      offsetYMm: placement.offsetYMm,
      instanceIdPrefix: layout.placements.length > 1 ? `rotativo_${k + 1}` : 'rotativo',
    });
    for (const eng of compiled.engravingItems) {
      if (!layout.tapered) { items.push(eng); continue; }
      if (eng.kind !== 'vector_path' || !eng.polylines?.length) {
        throw new Error('Las imágenes raster no se pueden compensar en objetos cónicos: usá logos vectoriales, texto o imágenes vectorizadas.');
      }
      const polylines = eng.polylines.map(pl => ({
        closed: pl.closed,
        points: densify(pl.points, pl.closed).map(p => warpPointForTaper(config, placement.centerYMm, p.x, p.y)),
      }));
      items.push({...eng, polylines, svgPathD: toPathD(polylines)});
    }
  });
  return items;
}

/**
 * SVG 1:1 mm sólo de grabado (capa 00) con el arte desenrollado sobre el objeto cilíndrico.
 * Lanza error si la configuración o el diseño no son válidos.
 */
export function exportRotarySvg(design: LabelDesign, config: RotaryConfig): RotaryExportArtifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) throw new Error(`Rotativo inválido: ${layout.errors.join(' ')}`);

  const nodes: string[] = [];
  let engravePathCount = 0;
  for (const eng of collectRotaryArtwork(design, config, layout)) {
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
      const rt = rasterImageTransform(eng);
      const rot = rt ? ` transform="${rt}"` : '';
      nodes.push(`    <image id="${xml(eng.id)}" x="${eng.xMm}" y="${eng.yMm}" width="${eng.widthMm}" height="${eng.heightMm}" preserveAspectRatio="none" href="${xml(eng.dataUrl)}"${rot} />`);
    }
  }

  if (engravePathCount === 0) {
    throw new Error('No hay elementos de grabado visibles para exportar. Asegúrese de que el diseño contenga texto o gráficos activos.');
  }

  const w = layout.canvasWidthMm;
  const h = layout.canvasHeightMm;
  const lines = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!--`,
    `  ASTRA STUDIO — ARCHIVO ROTATIVO (ESCALA REAL 1:1 EN MM, SÓLO GRABADO)`,
    `  Máquina destino : Vank 9060 CO2 + accesorio rotativo (${config.rotaryType === 'roller' ? 'rodillos' : 'mandril'})`,
    `  Sentido de giro : ${config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}`,
    `  Objeto          : ${layout.tapered ? `cónico Ø ${config.objectDiameterMm} → ${config.endDiameterMm} mm (referencia ${layout.referenceDiameterMm} mm)` : `Ø ${config.objectDiameterMm} mm`} (circunferencia ${layout.circumferenceMm} mm), arco ${config.arcDeg}°`,
    `  Copias          : ${layout.repeatCount}`,
    `  Lienzo          : ${w} mm (eje X, largo del objeto) x ${h} mm (eje Y, giro del objeto)`,
    `  Capa 00 (#000000): GRABADO (${engravePathCount} elementos)`,
    `-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
    `  width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" version="1.1"`,
    `  data-generator="Astra Studio rotary" data-units="mm" data-rotary-diameter-mm="${layout.referenceDiameterMm}" data-rotary-tapered="${layout.tapered}" data-rotary-arc-deg="${config.arcDeg}" data-rotary-copies="${layout.repeatCount}" data-rotary-direction="${config.rotationDirection || 'normal'}">`,
    `  <g id="CAPA_00_GRABADO" inkscape:groupmode="layer" inkscape:label="00_GRABADO" data-layer="ENGRAVE" data-lightburn-layer="00">`,
    ...nodes,
    `  </g>`,
    `</svg>`,
  ];

  const base = rotaryBaseName(design, config, layout);
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

function rotaryBaseName(design: LabelDesign, config: RotaryConfig, layout: RotaryLayout): string {
  return `${sanitizeName(design.name)}_ROTATIVO_${layout.tapered ? 'CONICO_' : ''}D${layout.referenceDiameterMm}mm_${layout.canvasWidthMm}x${layout.canvasHeightMm}mm`;
}

export interface RotaryDxfArtifact {
  dxfContent: string;
  filename: string;
  polylineCount: number;
}

/** DXF R12 (AC1009) sólo de grabado para RDWorks. No admite imágenes raster. */
export function exportRotaryDxf(design: LabelDesign, config: RotaryConfig): RotaryDxfArtifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) throw new Error(`Rotativo inválido: ${layout.errors.join(' ')}`);
  const items = collectRotaryArtwork(design, config, layout);
  if (items.some(i => i.kind === 'raster_image' || !i.polylines?.length)) {
    throw new Error('DXF R12 no admite grabado raster. Exportá SVG o vectorizá el logo antes de exportar DXF.');
  }
  const w = layout.canvasWidthMm, h = layout.canvasHeightMm;
  const out: string[] = [];
  const pair = (code: number, value: string | number) => { out.push(String(code), String(value)); };
  const L = LIGHTBURN_LAYERS.ENGRAVE;
  pair(0, 'SECTION'); pair(2, 'HEADER');
  pair(9, '$ACADVER'); pair(1, 'AC1009');
  pair(9, '$INSUNITS'); pair(70, 4);
  pair(9, '$MEASUREMENT'); pair(70, 1);
  pair(9, '$EXTMIN'); pair(10, 0); pair(20, 0); pair(30, 0);
  pair(9, '$EXTMAX'); pair(10, w); pair(20, h); pair(30, 0);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'TABLES');
  pair(0, 'TABLE'); pair(2, 'LTYPE'); pair(70, 1);
  pair(0, 'LTYPE'); pair(2, 'CONTINUOUS'); pair(70, 0); pair(3, 'Solid line'); pair(72, 65); pair(73, 0); pair(40, 0);
  pair(0, 'ENDTAB');
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, 1);
  pair(0, 'LAYER'); pair(2, L.name); pair(70, 0); pair(62, L.dxfColorIndex); pair(6, 'CONTINUOUS');
  pair(0, 'ENDTAB'); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  let polylineCount = 0;
  for (const item of items) {
    for (const pl of item.polylines ?? []) {
      const pts = pl.points.map(p => ({x: roundMm(p.x, 4), y: roundMm(p.y, 4)})).filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
      if (pts.length < 2) continue;
      if (pl.closed && pts.length >= 3) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 0.0001) pts.push({x: a.x, y: a.y});
      }
      polylineCount++;
      pair(0, 'POLYLINE'); pair(8, L.name); pair(62, L.dxfColorIndex); pair(66, 1);
      pair(10, 0); pair(20, 0); pair(30, 0); pair(70, pl.closed ? 1 : 0);
      for (const pt of pts) { pair(0, 'VERTEX'); pair(8, L.name); pair(10, pt.x); pair(20, roundMm(h - pt.y, 4)); pair(30, 0); }
      pair(0, 'SEQEND'); pair(8, L.name);
    }
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF');

  if (polylineCount === 0) {
    throw new Error('No hay trazados vectoriales de grabado para exportar en DXF rotativo.');
  }

  return {dxfContent: out.join('\n') + '\n', filename: `${rotaryBaseName(design, config, layout)}_RDWORKS.dxf`, polylineCount};
}

export function buildRotaryInstructions(design: LabelDesign, config: RotaryConfig, layout = computeRotaryLayout(config, design)): string {
  const rows = [
    'ASTRA STUDIO — INSTRUCCIONES DE ROTATIVO (Vank 9060 / Ruida RDC8445S)',
    '',
    `Diseño: ${design.name} (${design.widthMm} mm a lo largo del eje x ${design.heightMm} mm alrededor del objeto)`,
    `Tipo de rotativo: ${config.rotaryType === 'roller' ? 'rodillos' : 'mandril'}`,
    `Sentido de giro: ${config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}`,
    ...(config.accessoryProfileId ? [`Perfil de accesorio: ${config.accessoryProfileId}`] : []),
    layout.tapered
      ? `Objeto cónico: Ø ${config.objectDiameterMm} mm (X=0) → Ø ${config.endDiameterMm} mm (X=${config.usefulLengthMm}). CARGAR EN LA MÁQUINA: ${config.rotaryType === 'chuck' ? `Ø ${layout.referenceDiameterMm} mm del objeto (referencia)` : 'diámetro medido del rodillo motriz; el diámetro de referencia del dibujo no reemplaza al del rodillo'}. El arte ya está pre-compensado en Y.`
      : `Diámetro del objeto: ${config.objectDiameterMm} mm`,
    `Circunferencia: ${layout.circumferenceMm} mm`,
    `Arco a grabar: ${config.arcDeg}° (${layout.arcLengthMm} mm)`,
    `Diseño ocupa: ${layout.designArcDeg}° de la circunferencia${layout.repeatCount > 1 ? ` x ${layout.repeatCount} copias (separación entre centros ${layout.copyPitchMm} mm)` : ''}`,
    ...(config.axisOffsetMm || config.angularOffsetDeg ? [`Desplazamiento: ${config.axisOffsetMm ?? 0} mm axial, ${config.angularOffsetDeg ?? 0}° de giro`] : []),
    `Lienzo del archivo: ${layout.canvasWidthMm} x ${layout.canvasHeightMm} mm`,
    '',
    'ANTES DE GRABAR (a cargar por el operador, la app NO los inventa):',
    '- Activar el rotativo en LightBurn (Rotary Setup), eje Y, y elegir el tipo de accesorio.',
    `- Pasos por vuelta: ${config.stepsPerRotation ?? 'PENDIENTE de medir o confirmar con el fabricante'}.`,
    config.rotaryType === 'roller'
      ? `- Cargar el diámetro de los rodillos${config.rollerDiameterMm ? ` (referencia: ${config.rollerDiameterMm} mm)` : ''} y verificar los pasos por vuelta.`
      : `- Cargar el diámetro del objeto: ${layout.referenceDiameterMm} mm.`,
    config.rotaryType === 'roller' ? '- En rodillos, la escala depende del diámetro del rodillo motriz, no del diámetro del objeto.' : '- En mandril, la escala depende del diámetro del objeto.',
    `- Sentido de giro: verificar que el texto avance en sentido ${config.rotationDirection === 'inverted' ? 'invertido' : 'normal'}. Si gira al revés, invertir la dirección del eje en Rotary Setup.`,
    '- Test de LightBurn: debe completar una vuelta del rodillo MOTRIZ o del MANDRIL y regresar. En rodillos no se mide la vuelta del objeto.',
    '- Estos valores son una ficha de configuración: Astra no configura ni mueve la máquina.',
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
  const body = [
    `    <rect id="area" x="0" y="0" width="${w}" height="${h}" ${st} />`,
    ...layout.placements.map((p, i) => `    <rect id="diseno-${i + 1}" x="${p.offsetXMm}" y="${p.offsetYMm}" width="${design.widthMm}" height="${design.heightMm}" ${st} />`),
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

export interface RotaryPatternArtifact {
  svgContent: string;
  instructionsText: string;
  filename: string;
  instructionsFilename: string;
  targetSquareMm: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Genera un patrón SVG de prueba y calibración con dimensiones métricas conocidas (cuadrado patrón,
 * retícula métrica, marcas cada 10 mm y flecha de sentido de giro +Y) para verificar escala con calibre.
 */
export function exportRotaryTestPatternSvg(
  config: RotaryConfig,
  targetSquareMm = 50
): RotaryPatternArtifact {
  const dummyDesign = { widthMm: targetSquareMm, heightMm: targetSquareMm };
  const layout = computeRotaryLayout(config, dummyDesign);
  const w = layout.canvasWidthMm;
  const h = layout.canvasHeightMm;

  const sq = roundMm(Math.min(targetSquareMm, Math.min(w * 0.75, h * 0.75)), 2);
  const cx = roundMm(w / 2, 2);
  const cy = roundMm(h / 2, 2);
  const minX = roundMm(cx - sq / 2, 2);
  const maxX = roundMm(cx + sq / 2, 2);
  const minY = roundMm(cy - sq / 2, 2);
  const maxY = roundMm(cy + sq / 2, 2);

  const black = LIGHTBURN_LAYERS.ENGRAVE.hexColor;
  const guideColor = LIGHTBURN_LAYERS.GUIDE.hexColor;

  const tickLines: string[] = [];
  for (let x = minX; x <= maxX + 0.01; x += 10) {
    const rx = roundMm(x, 2);
    tickLines.push(`<line x1="${rx}" y1="${maxY}" x2="${rx}" y2="${maxY + 2}" stroke="${black}" stroke-width="0.15" />`);
  }
  for (let y = minY; y <= maxY + 0.01; y += 10) {
    const ry = roundMm(y, 2);
    tickLines.push(`<line x1="${maxX}" y1="${ry}" x2="${maxX + 2}" y2="${ry}" stroke="${black}" stroke-width="0.15" />`);
  }

  const dirY = config.rotationDirection === 'inverted' ? -1 : 1;
  const arrowY2 = dirY === 1 ? cy + 18 : cy + 6;
  const arrowHead = dirY === 1
    ? `${cx - 2} ${cy + 15} L ${cx} ${cy + 18} L ${cx + 2} ${cy + 15}`
    : `${cx - 2} ${cy + 9} L ${cx} ${cy + 6} L ${cx + 2} ${cy + 9}`;

  const nodes = [
    `    <!-- Cuadrado patrón de calibración métrica ${sq} x ${sq} mm -->`,
    `    <rect id="cuadrado_calibracion_${sq}mm" x="${minX}" y="${minY}" width="${sq}" height="${sq}" fill="none" stroke="${black}" stroke-width="0.2" />`,
    `    <line id="cruz_h" x1="${minX}" y1="${cy}" x2="${maxX}" y2="${cy}" stroke="${black}" stroke-width="0.1" stroke-dasharray="1 0.5" />`,
    `    <line id="cruz_v" x1="${cx}" y1="${minY}" x2="${cx}" y2="${maxY}" stroke="${black}" stroke-width="0.1" stroke-dasharray="1 0.5" />`,
    ...tickLines.map(t => `    ${t}`),
    `    <!-- Flecha de Sentido de Giro (+Y) -->`,
    `    <line id="flecha_eje_y" x1="${cx}" y1="${cy + 6}" x2="${cx}" y2="${arrowY2}" stroke="${black}" stroke-width="0.25" />`,
    `    <path id="punta_flecha_y" d="M ${arrowHead}" fill="none" stroke="${black}" stroke-width="0.25" />`,
    `    <!-- Textos de referencia grabados -->`,
    `    <text x="${cx}" y="${roundMm(minY - 2.5, 2)}" text-anchor="middle" font-family="monospace" font-size="2.6" font-weight="bold" fill="${black}">COTA X (AXIAL): ${sq.toFixed(2)} mm</text>`,
    `    <text x="${cx}" y="${roundMm(cy - 3, 2)}" text-anchor="middle" font-family="monospace" font-size="2.6" font-weight="bold" fill="${black}">COTA Y (GIRO): ${sq.toFixed(2)} mm</text>`,
    `    <text x="${cx}" y="${roundMm(cy + 3, 2)}" text-anchor="middle" font-family="monospace" font-size="2.0" fill="${black}">MEDIR Y CON CALIBRE</text>`,
    `    <text x="${cx}" y="${roundMm(maxY + 6, 2)}" text-anchor="middle" font-family="monospace" font-size="2.2" font-weight="bold" fill="${black}">SENTIDO GIRO: ${config.rotationDirection === 'inverted' ? 'INVERTIDO' : 'NORMAL (+Y)'}</text>`,
    `    <text x="${cx}" y="${roundMm(maxY + 10, 2)}" text-anchor="middle" font-family="monospace" font-size="1.8" fill="${black}">Ø OBJ: ${config.objectDiameterMm} mm | CIRC: ${layout.circumferenceMm} mm | Vank 9060</text>`,
  ];

  const guideNodes = [
    `    <rect id="marco_lienzo" x="0" y="0" width="${w}" height="${h}" fill="none" stroke="${guideColor}" stroke-width="0.1" stroke-dasharray="2 1" />`,
    `    <line id="linea_costura" x1="0" y1="0" x2="${w}" y2="0" stroke="${guideColor}" stroke-width="0.15" stroke-dasharray="3 2" />`,
  ];

  const svgContent = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<!--`,
    `  ASTRA STUDIO — PATRÓN DE CALIBRACIÓN ROTATIVO (ESCALA REAL 1:1 EN MM)`,
    `  Cota esperada en Y (giro): ${sq.toFixed(2)} mm | Cota esperada en X (axial): ${sq.toFixed(2)} mm`,
    `  Instrucción: Grabe en cinta o material de prueba, mida con calibre la cota Y y cargue el valor en el asistente.`,
    `-->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" version="1.1" data-units="mm">`,
    `  <g id="CAPA_00_GRABADO" data-layer="ENGRAVE" data-lightburn-layer="00">`,
    ...nodes,
    `  </g>`,
    `  <g id="GUIAS_T1" data-layer="GUIDE" data-lightburn-layer="T1">`,
    ...guideNodes,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  const baseName = `PATRON_CALIBRACION_ROTATIVO_${config.rotaryType.toUpperCase()}_${sq}mm_D${config.objectDiameterMm}mm`;

  const instructionsText = [
    'ASTRA STUDIO — GUÍA DE CALIBRACIÓN DEL ROTATIVO (Vank 9060 / Ruida RDC8445S)',
    '=========================================================================',
    '',
    `Tipo de accesorio: ${config.rotaryType === 'roller' ? 'Rodillos (Roller)' : 'Mandril (Chuck)'}`,
    `Diámetro del objeto probado: ${config.objectDiameterMm} mm`,
    `Circunferencia calculada: ${layout.circumferenceMm} mm`,
    `Cota de prueba cuadrada: ${sq.toFixed(2)} mm x ${sq.toFixed(2)} mm`,
    `Sentido de giro configurado: ${config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}`,
    '',
    'PROCEDIMIENTO DE CALIBRACIÓN CON CALIBRE:',
    '1. Pegue una tira de cinta de pintor (enmascarar) alrededor del objeto cilíndrico de descarte.',
    '2. Enfoque el láser en el punto más alto del cilindro.',
    '3. Importe el archivo SVG en LightBurn (o DXF en RDWorks) a escala 1:1.',
    '4. Asigne baja potencia para marcar la cinta sin quemar el material subyacente.',
    '5. Ejecute el grabado del patrón.',
    '6. Con calibre digital, mida la distancia entre las líneas paralelas en el eje Y (giro del objeto).',
    '7. COTA ESPERADA: ' + sq.toFixed(2) + ' mm.',
    '8. Si la cota medida difiere de ' + sq.toFixed(2) + ' mm:',
    '   - Abra el Asistente de Calibración en Astra Studio (pestaña Calibración con Calibre).',
    '   - Ingrese el valor medido real (ej. 48.6 mm o 51.2 mm).',
    '   - El software calculará los pasos corregidos por vuelta sin cálculos manuales.',
    '   - Ingrese el nuevo valor en la ventana Rotary Setup de LightBurn o Ruida.',
    '9. Verifique que la flecha grabada coincida con el sentido de giro real del objeto.',
  ].join('\n') + '\n';

  return {
    svgContent,
    instructionsText,
    filename: `${baseName}.svg`,
    instructionsFilename: `${baseName}_INSTRUCCIONES.txt`,
    targetSquareMm: sq,
    widthMm: w,
    heightMm: h,
  };
}
