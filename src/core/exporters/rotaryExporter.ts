import {compileLabelGeometry, rasterImageTransform, roundMm} from '../geometry/geometryEngine';
import {
  computeRotaryLayout,
  DEFAULT_ROTARY_LAYER_PARAMS,
  isTapered,
  RotaryConfig,
  RotaryEngraveLayerParams,
  RotaryLayout,
  warpPointForTaper,
} from '../rotary/rotaryEngine';
import {
  buildRuidaEnvelopeBoundsCommands,
  CompiledRuidaRdArtifact,
  encodeRuidaAbsCoordMm,
  encodeRuidaPowerPercent,
  encodeRuidaSpeedMmPerSec,
  scrambleRuidaByte,
} from '../workbench/ruidaCompiler';
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

function rotateLocalPointForRotary(
  x: number,
  y: number,
  origW: number,
  origH: number,
  deg: 0 | 90 | 180 | 270
): Point2D {
  switch (deg) {
    case 90:
      return { x: roundMm(origH - y), y: roundMm(x) };
    case 180:
      return { x: roundMm(origW - x), y: roundMm(origH - y) };
    case 270:
      return { x: roundMm(y), y: roundMm(origW - x) };
    default:
      return { x, y };
  }
}

/**
 * Compila el grabado de todas las copias del diseño ya ubicadas sobre el lienzo desenrollado,
 * aplicando orientación en el cilindro (0/90/180/270°) y compensación cónica Pre-Warp cuando corresponde.
 */
function collectRotaryArtwork(design: LabelDesign, config: RotaryConfig, layout: RotaryLayout): EngravedItemGeometry[] {
  const items: EngravedItemGeometry[] = [];
  const rotDeg = layout.appliedDesignRotationDeg;

  layout.placements.forEach((placement, k) => {
    const compiled = compileLabelGeometry(design, {
      offsetXMm: rotDeg === 0 ? placement.offsetXMm : 0,
      offsetYMm: rotDeg === 0 ? placement.offsetYMm : 0,
      instanceIdPrefix: layout.placements.length > 1 ? `rotativo_${k + 1}` : 'rotativo',
    });
    for (const eng of compiled.engravingItems) {
      if (layout.tapered && (eng.kind !== 'vector_path' || !eng.polylines?.length)) {
        throw new Error('Las imágenes raster no se pueden compensar en objetos cónicos: usá logos vectoriales, texto o imágenes vectorizadas.');
      }

      if (eng.kind === 'vector_path' && eng.polylines?.length) {
        if (rotDeg === 0 && !layout.tapered) {
          items.push(eng);
          continue;
        }
        const transformedPolylines = eng.polylines.map((pl) => {
          const basePts =
            rotDeg === 0
              ? pl.points
              : pl.points.map((pt) => {
                  const rp = rotateLocalPointForRotary(
                    pt.x,
                    pt.y,
                    design.widthMm,
                    design.heightMm,
                    rotDeg
                  );
                  return {
                    x: roundMm(rp.x + placement.offsetXMm),
                    y: roundMm(rp.y + placement.offsetYMm),
                  };
                });

          const finalPts = layout.tapered
            ? densify(basePts, pl.closed).map((p) =>
                warpPointForTaper(config, placement.centerYMm, p.x, p.y)
              )
            : basePts;

          return { closed: pl.closed, points: finalPts };
        });

        items.push({
          ...eng,
          polylines: transformedPolylines,
          svgPathD: toPathD(transformedPolylines),
        });
      } else if (eng.kind === 'raster_image') {
        if (rotDeg === 0) {
          items.push(eng);
        } else {
          // Para raster en cilindro recto con rotación de 90/180/270°, rotar su caja y traslación en el lienzo
          const rw = eng.widthMm ?? design.widthMm;
          const rh = eng.heightMm ?? design.heightMm;
          const cxLocal = (eng.xMm ?? 0) + rw / 2;
          const cyLocal = (eng.yMm ?? 0) + rh / 2;
          const rc = rotateLocalPointForRotary(
            cxLocal,
            cyLocal,
            design.widthMm,
            design.heightMm,
            rotDeg
          );
          const nextCx = rc.x + placement.offsetXMm;
          const nextCy = rc.y + placement.offsetYMm;
          items.push({
            ...eng,
            xMm: roundMm(nextCx - rw / 2),
            yMm: roundMm(nextCy - rh / 2),
            rotationDeg: ((eng.rotationDeg ?? 0) + rotDeg) % 360,
          });
        }
      }
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
    ...(layout.tapered ? [
      '*******************************************************************************',
      'ATENCIÓN — CONFIGURACIÓN DE OBJETO CÓNICO EN LIGHTBURN (MANDRIL SANOU):',
      '-------------------------------------------------------------------------------',
      'MÉTODO ASTRA STUDIO (ARTE PRE-COMPENSADO EN SVG):',
      `- Diámetro a ingresar en LightBurn (Object Diameter): EXACTAMENTE ${layout.referenceDiameterMm} mm (diámetro de referencia).`,
      '- ADVERTENCIA DE DOBLE COMPENSACIÓN: El archivo exportado ya incluye la compensación geométrica no lineal para el cono.',
      '  NO active la herramienta "Taper Warp" en LightBurn ni re-escale el dibujo en Y.',
      `- Nivelación física: Nivele la generatriz superior del objeto respecto a la mesa láser y enfoque a la cota Ø ${layout.referenceDiameterMm} mm.`,
      '',
      'MÉTODO LIGHTBURN DSP ALTERNATIVO (Documentación oficial LightBurn RotaryModeDSP):',
      `- Si prefiere usar la herramienta nativa Taper Warp de LightBurn, debe exportar un arte plano sin deformar,`,
      `  ingresar como Object Diameter el DIÁMETRO MAYOR del cono (Ø ${Math.max(config.objectDiameterMm, config.endDiameterMm ?? 0)} mm) y deformar en LightBurn.`,
      '- ¡ATENCIÓN! No aplique Taper Warp de LightBurn sobre este archivo pre-compensado (generaría doble deformación).',
      '*******************************************************************************',
      '',
    ] : []),
    'ANTES DE GRABAR (a cargar por el operador, la app NO los inventa):',
    '- Activar el rotativo en LightBurn (Rotary Setup), eje Y, y elegir el tipo de accesorio.',
    `- Pasos por vuelta: ${config.stepsPerRotation ?? 'PENDIENTE de medir o calibrar físicamente'}.`,
    config.rotaryType === 'roller'
      ? `- Cargar el diámetro de los rodillos${config.rollerDiameterMm ? ` (referencia: ${config.rollerDiameterMm} mm)` : ''} y verificar los pasos por vuelta.`
      : `- Cargar el diámetro del objeto: ${layout.referenceDiameterMm} mm.`,
    config.rotaryType === 'roller'
      ? '- En rodillos, la escala depende del diámetro del rodillo motriz, no del diámetro del objeto.'
      : '- En mandril, la escala depende del diámetro del objeto.',
    `- Sentido de giro documentado: ${config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}.`,
    '  * Nota: El archivo exportado conserva coordenadas CAD estándar.',
    '  * Si al probar el objeto gira en sentido opuesto al avance del dibujo, active "Invert Direction" / "Mirror Output" en LightBurn (Rotary Setup) o cambie la polaridad DIR en la Ruida.',
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
    ...layout.placements.map((p, i) => `    <rect id="diseno-${i + 1}" x="${p.offsetXMm}" y="${p.offsetYMm}" width="${layout.effectiveDesignWidthMm}" height="${layout.effectiveDesignHeightMm}" ${st} />`),
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
  if (!Number.isFinite(targetSquareMm) || targetSquareMm <= 0) {
    throw new Error('La dimensión del patrón de prueba debe ser un valor numérico positivo.');
  }

  if (!Number.isFinite(config.objectDiameterMm) || config.objectDiameterMm <= 0) {
    throw new Error('Configuración rotativa inválida para generar patrón de prueba: El diámetro del objeto debe ser mayor a 0.');
  }
  if (!Number.isFinite(config.usefulLengthMm) || config.usefulLengthMm <= 0) {
    throw new Error('Configuración rotativa inválida para generar patrón de prueba: El largo útil debe ser mayor a 0.');
  }
  if (config.usefulLengthMm > config.machineBedWidthMm) {
    throw new Error(`Configuración rotativa inválida para generar patrón de prueba: El largo útil (${config.usefulLengthMm} mm) supera el ancho de la máquina (${config.machineBedWidthMm} mm).`);
  }

  // 1. Calcular primero una dimensión de patrón que entre de forma segura en el objeto
  const minD = isTapered(config) && config.endDiameterMm !== undefined
    ? Math.min(config.objectDiameterMm, config.endDiameterMm)
    : config.objectDiameterMm;
  const circumferenceMm = Math.PI * minD;
  const arcLengthMm = circumferenceMm * (Math.min(Math.max(config.arcDeg, 1), 360) / 360);

  // El patrón no debe exceder el 75% del largo axial ni el 75% del desarrollo del arco
  const maxAllowedMm = Math.min(config.usefulLengthMm * 0.75, arcLengthMm * 0.75);
  const sq = roundMm(Math.min(targetSquareMm, maxAllowedMm), 2);

  if (sq < 5.0) {
    throw new Error(
      `Dimensiones insuficientes para generar el patrón de prueba (Largo: ${config.usefulLengthMm} mm, Circunferencia: ${roundMm(circumferenceMm, 1)} mm).`
    );
  }

  // 2. Validar posteriormente con computeRotaryLayout la geometría real calculada
  const patternDesign = { widthMm: sq, heightMm: sq };
  const layout = computeRotaryLayout(config, patternDesign);

  if (!layout.valid) {
    throw new Error(`Configuración rotativa inválida para generar patrón de prueba: ${layout.errors.join('; ')}`);
  }

  const w = layout.canvasWidthMm;
  const h = layout.canvasHeightMm;

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
    `Orientación de montaje (+Y): ${config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}`,
    ...(layout.tapered ? [
      `ATENCIÓN OBJETO CÓNICO: En LightBurn ingresar Object Diameter = ${layout.referenceDiameterMm} mm. No activar compensación cónica adicional en CAM.`
    ] : []),
    '',
    'PROCEDIMIENTO DE CALIBRACIÓN LINEAL:',
    '1. Pegue una tira de cinta de pintor (enmascarar) alrededor del objeto cilíndrico de descarte.',
    '2. Enfoque el láser en la generatriz superior del cilindro.',
    '3. Importe el archivo SVG en LightBurn (o DXF en RDWorks) a escala 1:1 en mm.',
    '4. Asigne baja potencia para marcar la cinta sin quemar el material subyacente.',
    '5. Ejecute el grabado del patrón.',
    '6. Mida la cota Y grabada según su instrumento:',
    '   a) Con CALIBRE RÍGIDO (Pie de rey): Mida la distancia recta entre los bordes en Y.',
    '      * En el asistente de Astra Studio elija "Calibre digital / Pie de rey rígido".',
    '      * El sistema compensará la cuerda circular con s = D * arcsin(c / D) para evitar distorsión.',
    '   b) Con CINTA FLEXIBLE O PAPEL ENROLLADO: Mida el arco directamente sobre la curvatura del cilindro.',
    '      * En el asistente elija "Cinta flexible / Papel enrollado (Arco sobre superficie)".',
    '7. COTA ESPERADA: ' + sq.toFixed(2) + ' mm.',
    '8. Presione "Aplicar calibración al perfil" para actualizar los pasos y guardarlos en el perfil.',
    '9. Si el objeto gira en sentido contrario al esperado, active "Invert Direction" en LightBurn Rotary Setup.',
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

export interface RotaryLbrn2Artifact {
  lbrn2Content: string;
  filename: string;
  widthMm: number;
  heightMm: number;
  shapeCount: number;
}

/**
 * Exporta el proyecto rotativo desenrollado (y pre-compensado si es cónico)
 * directamente en formato nativo LightBurn Pro 2.2 (.lbrn2) con su capa C00 configurada.
 */
export function exportRotaryToLbrn2(
  design: LabelDesign,
  config: RotaryConfig,
  layerParams: RotaryEngraveLayerParams = DEFAULT_ROTARY_LAYER_PARAMS
): RotaryLbrn2Artifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) {
    throw new Error(`Rotativo inválido: ${layout.errors.join(' ')}`);
  }

  const items = collectRotaryArtwork(design, config, layout);
  if (items.length === 0) {
    throw new Error(
      'No hay elementos de grabado visibles para exportar a LightBurn (.lbrn2).'
    );
  }

  const cutType =
    layerParams.mode === 'image'
      ? 'Image'
      : layerParams.mode === 'line'
        ? 'Cut'
        : 'Scan';

  const cutSettingLines: string[] = [
    `  <CutSetting type="${cutType}">`,
    `    <index Value="0"/>`,
    `    <name Value="C00 GRABADO ROTATIVO"/>`,
    `    <priority Value="0"/>`,
    `    <doOutput Value="1"/>`,
    `    <hide Value="0"/>`,
    `    <runBlower Value="${layerParams.airAssist ? 1 : 0}"/>`,
    `    <numPasses Value="${Math.max(1, layerParams.passes || 1)}"/>`,
  ];

  if (layerParams.speedMmPerSec !== null && layerParams.speedMmPerSec > 0) {
    cutSettingLines.push(
      `    <speed Value="${roundMm(layerParams.speedMmPerSec, 2)}"/>`
    );
  }
  if (layerParams.maxPowerPercent !== null && layerParams.maxPowerPercent > 0) {
    cutSettingLines.push(
      `    <maxPower Value="${roundMm(layerParams.maxPowerPercent, 2)}"/>`
    );
  }
  if (layerParams.minPowerPercent !== null && layerParams.minPowerPercent >= 0) {
    cutSettingLines.push(
      `    <minPower Value="${roundMm(layerParams.minPowerPercent, 2)}"/>`
    );
  } else if (
    layerParams.maxPowerPercent !== null &&
    layerParams.maxPowerPercent > 0
  ) {
    cutSettingLines.push(
      `    <minPower Value="${roundMm(layerParams.maxPowerPercent, 2)}"/>`
    );
  }

  if (layerParams.mode !== 'line') {
    cutSettingLines.push(
      `    <interval Value="${roundMm(layerParams.lineIntervalMm || 0.073, 4)}"/>`
    );
    cutSettingLines.push(
      `    <bidir Value="${layerParams.bidirectional === false ? 0 : 1}"/>`
    );
    if (layerParams.crossHatch) {
      cutSettingLines.push(`    <crossHatch Value="1"/>`);
    }
    if (layerParams.overscanPercent > 0) {
      cutSettingLines.push(`    <overscan Value="1"/>`);
      cutSettingLines.push(
        `    <overscanPercent Value="${roundMm(layerParams.overscanPercent, 2)}"/>`
      );
    }
  }
  cutSettingLines.push(`  </CutSetting>`);

  const shapesXml: string[] = [];
  let shapeCount = 0;

  for (const item of items) {
    if (item.kind === 'vector_path' && item.polylines?.length) {
      for (const pl of item.polylines) {
        if (pl.points.length < 2) continue;
        const vLines: string[] = [];
        const pLines: string[] = [];
        for (let i = 0; i < pl.points.length; i++) {
          const vx = roundMm(pl.points[i].x, 3);
          const vy = roundMm(pl.points[i].y, 3);
          vLines.push(`      <V vx="${vx}" vy="${vy}"/>`);
          if (i > 0) {
            pLines.push(`      <P T="L" p0="${i - 1}" p1="${i}"/>`);
          }
        }
        if (pl.closed && pl.points.length > 2) {
          pLines.push(`      <P T="L" p0="${pl.points.length - 1}" p1="0"/>`);
        }
        shapesXml.push(
          [
            `  <Shape Type="Path" CutIndex="0">`,
            `    <XForm>1 0 0 1 0 0</XForm>`,
            ...vLines,
            ...pLines,
            `  </Shape>`,
          ].join('\n')
        );
        shapeCount++;
      }
    } else if (item.kind === 'raster_image' && item.dataUrl) {
      const base64Match = item.dataUrl.match(
        /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/
      );
      const base64Data = base64Match ? base64Match[1] : '';
      const w = roundMm(item.widthMm ?? 10, 3);
      const h = roundMm(item.heightMm ?? 10, 3);
      const cx = roundMm((item.xMm ?? 0) + w / 2, 3);
      const cy = roundMm((item.yMm ?? 0) + h / 2, 3);
      shapesXml.push(
        [
          `  <Shape Type="Bitmap" CutIndex="0" W="${w}" H="${h}" Data="${base64Data}">`,
          `    <XForm>1 0 0 1 ${cx} ${cy}</XForm>`,
          `  </Shape>`,
        ].join('\n')
      );
      shapeCount++;
    }
  }

  const noteSummary = [
    `ROTATIVO VANK 9060 (${config.rotaryType === 'chuck' ? 'Mandril Sanou 3 Mordazas' : 'Rodillos'})`,
    `Objeto: ${
      layout.tapered
        ? `Cónico Ø ${config.objectDiameterMm} -> Ø ${config.endDiameterMm} mm (Cargar en LightBurn Object Diameter = Ø ${layout.referenceDiameterMm} mm — NO activar Taper Warp adicional)`
        : `Cilíndrico Ø ${config.objectDiameterMm} mm`
    }`,
    `Circunferencia: ${layout.circumferenceMm} mm | Lienzo desenrollado: ${layout.canvasWidthMm} x ${layout.canvasHeightMm} mm | Copias: ${layout.repeatCount}`,
    `Pasos por vuelta configurados: ${config.stepsPerRotation ?? 'Verificar en Rotary Setup'}`,
  ].join(' | ');

  const lbrn2Content = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="2.2.01" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    `  <UIPrefs>`,
    `    <Optimize_ByLayer Value="1"/>`,
    `  </UIPrefs>`,
    ...cutSettingLines,
    ...shapesXml,
    `  <Notes ShowOnLoad="1" Notes="${xml(noteSummary)}"/>`,
    `</LightBurnProject>`,
  ].join('\n');

  const base = rotaryBaseName(design, config, layout);
  return {
    lbrn2Content,
    filename: `${base}_LightBurn.lbrn2`,
    widthMm: layout.canvasWidthMm,
    heightMm: layout.canvasHeightMm,
    shapeCount,
  };
}

/**
 * Compila un trabajo rotativo vectorial (incluyendo compensación cónica Pre-Warp y rotación en el eje)
 * directamente a binario Ruida (.RD) listo para transmisión UDP a la Vank 9060 (192.168.0.195:50200)
 * o descarga en pendrive USB.
 */
export function compileRotaryToRuidaRd(
  design: LabelDesign,
  config: RotaryConfig,
  layerParams: RotaryEngraveLayerParams = DEFAULT_ROTARY_LAYER_PARAMS,
  ruidaJobName = 'ROTAT01'
): CompiledRuidaRdArtifact {
  const layout = computeRotaryLayout(config, design);
  if (!layout.valid) {
    throw new Error(`Compilación .RD rotativa bloqueada: ${layout.errors.join(' ')}`);
  }

  if (
    layerParams.speedMmPerSec === null ||
    !Number.isFinite(layerParams.speedMmPerSec) ||
    layerParams.speedMmPerSec <= 0 ||
    layerParams.maxPowerPercent === null ||
    !Number.isFinite(layerParams.maxPowerPercent) ||
    layerParams.maxPowerPercent <= 0
  ) {
    throw new Error(
      'Compilación .RD rotativa bloqueada por seguridad: configurá Velocidad (mm/s) y Potencia (%) en la pestaña "2. Velocidad y Potencia" antes de enviar a la Vank 9060.'
    );
  }

  const items = collectRotaryArtwork(design, config, layout);
  const vectorItems = items.filter(
    (it) => it.kind === 'vector_path' && it.polylines && it.polylines.length > 0
  );
  if (vectorItems.length === 0) {
    throw new Error(
      'El archivo .RD directo para rotativo requiere trazos vectoriales o texto. Vectorizá tu logo en el Paso 1 o usá "Abrir en LightBurn (.lbrn2)".'
    );
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const polylinesToEmit: { points: Point2D[]; closed: boolean }[] = [];
  for (const it of vectorItems) {
    for (const pl of it.polylines!) {
      if (pl.points.length < 2) continue;
      polylinesToEmit.push(pl);
      for (const pt of pl.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }
  }

  if (!Number.isFinite(minX) || polylinesToEmit.length === 0) {
    throw new Error('No se encontraron trayectorias válidas para compilar a .RD rotativo.');
  }

  const bounds = {
    minX: roundMm(minX, 3),
    minY: roundMm(minY, 3),
    maxX: roundMm(maxX, 3),
    maxY: roundMm(maxY, 3),
    width: roundMm(maxX - minX, 3),
    height: roundMm(maxY - minY, 3),
  };

  const raw: number[] = [];
  let commandCount = 0;
  const emit = (bytes: number[]) => {
    for (const b of bytes) raw.push(b & 0xff);
    commandCount++;
  };

  const cleanName =
    ruidaJobName
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 8) || 'ROTAT01';

  emit([0xd8, 0x00]);
  emit([
    0xe7,
    0x01,
    ...Array.from(cleanName).map((ch) => ch.charCodeAt(0) & 0x7f),
    0x00,
  ]);
  for (const cmd of buildRuidaEnvelopeBoundsCommands(bounds)) {
    emit(cmd);
  }

  emit([0xca, 0x01, layerParams.airAssist ? 0x13 : 0x12]);

  const speed = layerParams.speedMmPerSec;
  const maxP = layerParams.maxPowerPercent;
  const minP =
    layerParams.minPowerPercent !== null && layerParams.minPowerPercent >= 0
      ? Math.min(maxP, layerParams.minPowerPercent)
      : maxP;

  // Capa 0 (Grabado / Contorno Rotativo)
  emit([0xc9, 0x04, 0x00, ...encodeRuidaSpeedMmPerSec(speed)]);
  emit([0xc6, 0x31, 0x00, ...encodeRuidaPowerPercent(minP)]);
  emit([0xc6, 0x32, 0x00, ...encodeRuidaPowerPercent(maxP)]);

  emit([0xca, 0x02, 0x00]);
  emit([0xc9, 0x02, ...encodeRuidaSpeedMmPerSec(speed)]);
  emit([0xc6, 0x01, ...encodeRuidaPowerPercent(minP)]);
  emit([0xc6, 0x02, ...encodeRuidaPowerPercent(maxP)]);

  const passes = Math.max(1, Math.min(10, Math.round(layerParams.passes || 1)));
  for (let pass = 0; pass < passes; pass++) {
    for (const pl of polylinesToEmit) {
      const start = pl.points[0];
      emit([
        0x88,
        ...encodeRuidaAbsCoordMm(start.x),
        ...encodeRuidaAbsCoordMm(start.y),
      ]);
      for (let i = 1; i < pl.points.length; i++) {
        emit([
          0xa8,
          ...encodeRuidaAbsCoordMm(pl.points[i].x),
          ...encodeRuidaAbsCoordMm(pl.points[i].y),
        ]);
      }
      if (pl.closed) {
        emit([
          0xa8,
          ...encodeRuidaAbsCoordMm(start.x),
          ...encodeRuidaAbsCoordMm(start.y),
        ]);
      }
    }
  }

  // Fin de trabajo: retornar al origen inicial del rotativo antes de EOF (D7)
  emit([
    0x88,
    ...encodeRuidaAbsCoordMm(bounds.minX),
    ...encodeRuidaAbsCoordMm(bounds.minY),
  ]);
  emit([0xd7]);

  const rawUnscrambledBytes = Uint8Array.from(raw);
  const rdBytes = new Uint8Array(rawUnscrambledBytes.length);
  for (let i = 0; i < rawUnscrambledBytes.length; i++) {
    rdBytes[i] = scrambleRuidaByte(rawUnscrambledBytes[i]);
  }

  return {
    rdBytes,
    rawUnscrambledBytes,
    filenameSuggested: `${cleanName}_Rotativo_Vank9060.rd`,
    ruidaJobName: cleanName,
    totalPieces: layout.repeatCount,
    activeLayersCount: 1,
    boundingBoxMm: bounds,
    commandCount,
  };
}
