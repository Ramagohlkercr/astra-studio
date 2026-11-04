export const LIGHTBURN_PROFILES = {
  balanced: {name: 'Equilibrado', interval: 0.1},
  fast: {name: 'Rápido', interval: 0.15},
  detail: {name: 'Detalle fino', interval: 0.08},
} as const;
export type LightburnProfile = keyof typeof LIGHTBURN_PROFILES;
export function lightburnGuide(profile: LightburnProfile): string {
  const p = LIGHTBURN_PROFILES[profile];
  return `ASTRA STUDIO — AJUSTES PARA LIGHTBURN\nPerfil inicial: ${p.name}\nIntervalo de líneas: ${p.interval.toFixed(3)} mm\nDPI: ${(25.4 / p.interval).toFixed(1)}\n\nAplicar manualmente en Cuts / Layers > capa de grabado:\n- Logo de imagen blanco y negro: Image / Threshold. Pass-Through desactivado para usar este intervalo.\n- Logo vectorial: Fill, con el mismo intervalo.\n- Grabado bidireccional activado; ángulo 0°; una pasada; sin Cross-Hatch.\n- Grabar antes de cortar. Agujeros y contorno: Line, sin aplicarles estos DPI.\n- Conservar escala 1:1 y revisar Preview.\n\nLos SVG conservan la imagen original y NO configuran automáticamente LightBurn. Los DPI de la imagen de origen no son los DPI de barrido.\nVelocidad y potencia: pendientes de calibración con el tubo y material reales. No tomar los valores existentes de LightBurn como parámetros validados.\nComparar una muestra a 0.15, 0.10 y 0.08 mm; elegir el intervalo más amplio que conserve el detalle necesario. Más DPI no garantizan más calidad.\nLos tiempos reales dependen de velocidad, aceleración, recorridos y material.\n\nDocumentación: https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/ImageMode/\n`;
}
