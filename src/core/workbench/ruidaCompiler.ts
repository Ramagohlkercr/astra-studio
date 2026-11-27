/**
 * Astra Studio — Compilador Binario Ruida (.RD) y Empaquetador UDP (RDC8445S / RDC644XG)
 * Convierte trayectorias validadas en comandos binarios nativos Ruida con codificación de 7 bits
 * en micrómetros, modulación de potencia de 14 bits y ofuscación estándar (magic 0x88).
 *
 * REGLA DE SEGURIDAD INDUSTRIAL:
 * Este compilador NUNCA inventa velocidades ni potencias. Si alguna capa activa carece de
 * velocidad (mm/s) o potencia (%) explícitamente ingresadas por el operador, o si existe
 * cualquier error geométrico en la mesa 900x600 mm, aborta la compilación.
 */

import { roundMm } from '../geometry/geometryEngine';
import {
  buildRasterMaskCacheKey,
  getCachedRasterScanlineMask,
  rasterizePolylinesToHorizontalRuns,
  RasterScanlineMask,
} from './rasterScanlines';
import {
  sortInstancesInTravelOrder,
  validateWorkbenchState,
} from './workbenchEngine';
import {
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
} from './workbenchTypes';

/** Valida direcciones IPv4 de la red local (ej. 192.168.0.195). */
export function isValidIpv4Address(ip: string): boolean {
  const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  return ipv4Regex.test(ip.trim());
}

export interface RuidaUploadProgress {
  current_packet: number;
  total_packets: number;
  percent: number;
  bytes_sent: number;
  total_bytes: number;
  retries: number;
}

export interface RuidaUploadResponse {
  success: boolean;
  packets_sent: number;
  bytes_sent: number;
  retries?: number;
  elapsed_ms?: number;
  used_local_port_40200?: boolean;
  transport_mode?: string;
  remote_endpoint: string;
  message: string;
}

export interface RuidaProbeResponse {
  reachable: boolean;
  ping_ok?: boolean;
  udp_handshake_ok?: boolean;
  transport_mode?: string | null;
  controller_reply_hex?: string | null;
  latency_ms?: number | null;
  ip: string;
  port: number;
  local_port_40200_free: boolean;
  message: string;
}

/**
 * Codifica una coordenada o velocidad absoluta en micrómetros (1 mm = 1000 µm)
 * en 5 bytes de 7 bits cada uno (35 bits con signo, Big-Endian) usando aritmética exacta >32 bits.
 */
export function encodeRuidaAbsCoordMm(mm: number): number[] {
  let um = Math.round(mm * 1000);
  if (um < 0) {
    // Complemento a dos en 35 bits (2^35 = 34359738368)
    um = 0x800000000 + um;
  }
  const b0 = Math.floor(um / 0x10000000) & 0x7f;
  const b1 = Math.floor(um / 0x200000) & 0x7f;
  const b2 = Math.floor(um / 0x4000) & 0x7f;
  const b3 = Math.floor(um / 0x80) & 0x7f;
  const b4 = Math.floor(um) & 0x7f;
  return [b0, b1, b2, b3, b4];
}

/**
 * Decodifica 5 bytes de 7 bits de Ruida a milímetros.
 */
export function decodeRuidaAbsCoordMm(bytes: number[]): number {
  if (bytes.length < 5) throw new Error('Se requieren 5 bytes para coordenada absoluta Ruida.');
  let um =
    (bytes[0] & 0x7f) * 0x10000000 +
    (bytes[1] & 0x7f) * 0x200000 +
    (bytes[2] & 0x7f) * 0x4000 +
    (bytes[3] & 0x7f) * 0x80 +
    (bytes[4] & 0x7f);
  if (um >= 0x400000000) {
    um -= 0x800000000;
  }
  return roundMm(um / 1000, 3);
}

/**
 * Codifica una velocidad en mm/s a µm/s en 5 bytes de 7 bits.
 */
export function encodeRuidaSpeedMmPerSec(speedMmPerSec: number): number[] {
  const safeSpeed = Math.max(0.1, Math.min(2000, speedMmPerSec));
  return encodeRuidaAbsCoordMm(safeSpeed);
}

/**
 * Codifica un porcentaje de potencia láser (0..100%) en 2 bytes de 7 bits (14 bits: 100% = 16383 = 0x3FFF).
 */
export function encodeRuidaPowerPercent(percent: number): number[] {
  const clamped = Math.max(0, Math.min(100, percent));
  const raw = Math.round(clamped * 163.83) & 0x3fff;
  return [(raw >>> 7) & 0x7f, raw & 0x7f];
}

/**
 * Decodifica 2 bytes de 7 bits de potencia Ruida a porcentaje (0..100%).
 */
export function decodeRuidaPowerPercent(bytes: number[]): number {
  const raw = ((bytes[0] & 0x7f) << 7) | (bytes[1] & 0x7f);
  return roundMm((raw / 16383) * 100, 2);
}

/**
 * Ofusca (scramble) un byte crudo de comando Ruida según el algoritmo estándar de controladoras RDC644X / RDC8445S:
 * 1. Intercambiar bit 0 y bit 7
 * 2. XOR con magic (0x88)
 * 3. Sumar 1 módulo 256
 */
export function scrambleRuidaByte(rawByte: number, magic = 0x88): number {
  const b = rawByte & 0xff;
  const swapped = (b & 0x7e) | ((b >>> 7) & 0x01) | ((b & 0x01) << 7);
  const xored = (swapped ^ magic) & 0xff;
  return (xored + 1) & 0xff;
}

/**
 * Desofusca (unscramble) un byte Ruida ofuscado para auditoría o verificación.
 */
export function unscrambleRuidaByte(scrambledByte: number, magic = 0x88): number {
  const b = (scrambledByte - 1 + 256) & 0xff;
  const xored = (b ^ magic) & 0xff;
  return (xored & 0x7e) | ((xored >>> 7) & 0x01) | ((xored & 0x01) << 7);
}

/**
 * Empaqueta un buffer Ruida ofuscado en datagramas UDP listos para el puerto 50200,
 * anteponiendo a cada paquete el checksum Big-Endian de 16 bits (suma de todos los bytes ofuscados del paquete).
 */
export function buildRuidaUdpPackets(
  scrambledBytes: Uint8Array,
  maxPayloadBytes = 1400
): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < scrambledBytes.length; offset += maxPayloadBytes) {
    const slice = scrambledBytes.subarray(
      offset,
      Math.min(scrambledBytes.length, offset + maxPayloadBytes)
    );
    let checksum = 0;
    for (let i = 0; i < slice.length; i++) {
      checksum = (checksum + slice[i]) & 0xffff;
    }
    const packet = new Uint8Array(slice.length + 2);
    packet[0] = (checksum >>> 8) & 0xff;
    packet[1] = checksum & 0xff;
    packet.set(slice, 2);
    packets.push(packet);
  }
  return packets;
}

/**
 * Audita que todos los datagramas UDP Ruida tengan longitud válida y checksum Big-Endian de 16 bits íntegro.
 */
export function verifyRuidaUdpPacketChecksums(packets: Uint8Array[]): boolean {
  if (packets.length === 0) return false;
  for (const pkt of packets) {
    if (pkt.length < 3 || pkt.length > 1472) return false;
    let sum = 0;
    for (let i = 2; i < pkt.length; i++) {
      sum = (sum + pkt[i]) & 0xffff;
    }
    const header = ((pkt[0] & 0xff) << 8) | (pkt[1] & 0xff);
    if (header !== sum) return false;
  }
  return true;
}

/** Normaliza un nombre de archivo compatible con pantalla Ruida (ASCII mayúsculas, máx. 8 chars). */
export function sanitizeRuidaJobName(rawName?: string, fallback = 'ASTRA01'): string {
  const cleanFallback =
    fallback
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 8) || 'ASTRA01';
  if (!rawName) return cleanFallback;
  const cleaned = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 8);
  return cleaned || cleanFallback;
}

/** Construye los bytes crudos del preámbulo de carga con nombre (`E8 02` + `E7 01 <NOMBRE> 00`) usado por LightBurn antes de transmitir un archivo `.RD`. */
export function buildRuidaFileUploadHeaderBytes(jobName: string, magic = 0x88): Uint8Array {
  const cleanName = sanitizeRuidaJobName(jobName);
  const nameBytes = Array.from(cleanName).map((ch) => ch.charCodeAt(0) & 0x7f);
  const raw = [0xe8, 0x02, 0xe7, 0x01, ...nameBytes, 0x00];
  const scrambled = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    scrambled[i] = scrambleRuidaByte(raw[i], magic);
  }
  return scrambled;
}

/** Codifica un entero sin signo de hasta 35 bits en 5 bytes de 7 bits Big-Endian (checksum/métrica Ruida). */
export function encodeRuidaUnsigned35(value: number): number[] {
  const v = Math.max(0, Math.floor(value));
  const b0 = Math.floor(v / 0x10000000) & 0x7f;
  const b1 = Math.floor(v / 0x200000) & 0x7f;
  const b2 = Math.floor(v / 0x4000) & 0x7f;
  const b3 = Math.floor(v / 0x80) & 0x7f;
  const b4 = v & 0x7f;
  return [b0, b1, b2, b3, b4];
}

/**
 * Emite las etiquetas de envolvente Ruida estándar (`E7 06`, `E7 38`, `E7 03`/`E7 07`, `E7 50`/`E7 51`, `E7 04`, `E7 05`)
 * idénticas a LightBurn `OutputRDBoundsInfo` para `FRAME` y verificación de límites sin Boundary Error.
 */
export function buildRuidaEnvelopeBoundsCommands(
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  },
  options?: { isRotary?: boolean }
): number[][] {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  const maxY = Math.max(bounds.minY, bounds.maxY);
  const zero5 = [0, 0, 0, 0, 0];
  return [
    [0xe7, 0x06, ...zero5, ...zero5],
    [0xe7, 0x38, options?.isRotary ? 0x01 : 0x00],
    [0xe7, 0x03, ...encodeRuidaAbsCoordMm(minX), ...encodeRuidaAbsCoordMm(minY)],
    [0xe7, 0x07, ...encodeRuidaAbsCoordMm(maxX), ...encodeRuidaAbsCoordMm(maxY)],
    [0xe7, 0x50, ...encodeRuidaAbsCoordMm(minX), ...encodeRuidaAbsCoordMm(minY)],
    [0xe7, 0x51, ...encodeRuidaAbsCoordMm(maxX), ...encodeRuidaAbsCoordMm(maxY)],
    [0xe7, 0x04, 0x00, 0x01, 0x00, 0x01, ...zero5, ...zero5],
    [0xe7, 0x05, 0x00],
  ];
}

/**
 * Emite el encabezado estándar Ruida RDC8445S (`OutputRDHeader` LightBurn):
 * selector de modo de origen (`D8 10` / `D8 11` / `D8 12`), flags `F0 F1 02 00`, `E7 3B 41`, `D8 00` y nombre `E7 01`.
 */
export function buildRuidaProgramHeaderCommands(params: {
  startFromMode: 'absolute_coords' | 'user_origin' | 'current_position';
  jobName: string;
  isRotary?: boolean;
}): number[][] {
  const refByte =
    params.startFromMode === 'absolute_coords'
      ? 0x10
      : params.startFromMode === 'current_position'
        ? 0x12
        : 0x11;
  const cmds: number[][] = [[0xd8, refByte]];
  if (params.startFromMode === 'absolute_coords') {
    cmds.push([0xe6, 0x01]);
  }
  cmds.push([0xf0]);
  cmds.push([0xf1, 0x02, 0x00]);
  if (params.isRotary) {
    cmds.push([0xf1, 0x04, 0x00]);
  }
  cmds.push([0xe7, 0x3b, 0x41]);
  cmds.push([0xd8, 0x00]);

  const cleanJobName = sanitizeRuidaJobName(params.jobName);
  const nameBytes = Array.from(cleanJobName).map((ch) => ch.charCodeAt(0) & 0x7f);
  cmds.push([0xe7, 0x01, ...nameBytes, 0x00]);
  return cmds;
}

/**
 * Emite el pie estándar Ruida (`OutputFooter` LightBurn):
 * `E7 00` (fin de bloque), métrica `DA 01 06 20`, checksum de archivo `E5 05` y `D7` (EOF).
 */
export function appendRuidaProgramFooter(
  raw: number[],
  emit: (bytes: number[]) => void,
  cutDistanceScaled = 0
): void {
  emit([0xe7, 0x00]);
  const metric = encodeRuidaUnsigned35(cutDistanceScaled);
  emit([0xda, 0x01, 0x06, 0x20, ...metric, ...metric]);
  let byteSum = 0;
  for (let i = 0; i < raw.length; i++) {
    byteSum = (byteSum + (raw[i] & 0xff)) >>> 0;
  }
  const fileSum = (byteSum + 0xd7) >>> 0;
  emit([0xe5, 0x05, ...encodeRuidaUnsigned35(fileSum)]);
  emit([0xd7]);
}

export interface CompiledRuidaRdArtifact {
  /** Bytes ofuscados listos para guardar como archivo .rd (U-Disk USB o envío UDP) */
  rdBytes: Uint8Array;
  /** Bytes crudos sin ofuscar para inspección técnica y pruebas */
  rawUnscrambledBytes: Uint8Array;
  filenameSuggested: string;
  ruidaJobName: string;
  totalPieces: number;
  activeLayersCount: number;
  boundingBoxMm: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  commandCount: number;
}

/** Codifica un desplazamiento relativo en micrómetros ([-8000..+8000] µm) en 2 bytes de 7 bits (complemento a dos 14-bit). */
export function encodeRuidaRelUm(deltaUm: number): number[] {
  const clamped = Math.max(-8191, Math.min(8191, Math.round(deltaUm)));
  const encoded = clamped < 0 ? (0x4000 + clamped) & 0x3fff : clamped & 0x3fff;
  return [(encoded >>> 7) & 0x7f, encoded & 0x7f];
}

/**
 * Compila la mesa de trabajo completa en un archivo binario Ruida (.rd) verificado.
 */
export function compileWorkbenchToRuidaRd(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  rasterMasks?: Map<string, RasterScanlineMask>
): CompiledRuidaRdArtifact {
  const report = validateWorkbenchState(jobs, config);

  if (!report.isValidForExport) {
    const errMsg =
      report.issues.find((i) => i.severity === 'error')?.message ||
      'Geometría inválida en la mesa de trabajo.';
    throw new Error(`Compilación Ruida (.rd) bloqueada: ${errMsg}`);
  }

  if (!report.isValidForMachineSend || !report.occupiedBoundsMm) {
    const unconfMsg =
      report.issues.find((i) => i.code === 'LAYER_PARAMS_UNCONFIGURED')?.message ||
      'Todas las capas activas deben tener velocidad (mm/s) y potencia (%) validadas por el operador.';
    throw new Error(`Compilación Ruida (.rd) bloqueada por seguridad: ${unconfMsg}`);
  }

  const bounds = report.occupiedBoundsMm;
  const origin = report.jobOriginPointMm;
  // Vank 9060 / Ruida RDC8445S hace Home físico en Superior Derecha (0, 0), aumentando +X hacia la IZQUIERDA y +Y hacia el FRENTE.
  // Por eso en modo relativo al origen (Superior Derecha) X_ruida = origin.x - bedX (todo el trabajo hacia la izquierda es >= 0, sin chocar con límite < 0),
  // y en coordenadas absolutas X_ruida = bedWidthMm - bedX dentro de [0..900].
  const useRelativeOrigin = config.startFromMode !== 'absolute_coords';
  const toRuidaX = (bedX: number) =>
    roundMm(useRelativeOrigin ? origin.x - bedX : config.machineBedWidthMm - bedX, 3);
  const toRuidaY = (bedY: number) =>
    roundMm(useRelativeOrigin ? bedY - origin.y : bedY, 3);

  const rx1 = toRuidaX(bounds.minX);
  const rx2 = toRuidaX(bounds.maxX);
  const ry1 = toRuidaY(bounds.minY);
  const ry2 = toRuidaY(bounds.maxY);

  const emittedBounds = {
    minX: Math.min(rx1, rx2),
    minY: Math.min(ry1, ry2),
    maxX: Math.max(rx1, rx2),
    maxY: Math.max(ry1, ry2),
  };

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const sortedLayers = [...config.layers]
    .filter((l) => l.outputEnabled)
    .sort((a, b) => a.priority - b.priority);

  const raw: number[] = [];
  let commandCount = 0;

  const emit = (bytes: number[]) => {
    for (const b of bytes) raw.push(b & 0xff);
    commandCount++;
  };

  // 1. Cabecera estándar LightBurn RDC8445S (`D8 11` User Origin / `F0 F1` / `E7 3B 41` / `D8 00` / `E7 01`) + límites
  const cleanJobName = sanitizeRuidaJobName(config.ruidaJobName, 'ASTRA01');
  for (const cmd of buildRuidaProgramHeaderCommands({
    startFromMode: config.startFromMode,
    jobName: cleanJobName,
    isRotary: false,
  })) {
    emit(cmd);
  }

  for (const cmd of buildRuidaEnvelopeBoundsCommands(emittedBounds, { isRotary: false })) {
    emit(cmd);
  }

  // Asistencia de aire (Soplador general si alguna capa lo requiere)
  const anyAirAssist = sortedLayers.some((l) => l.airAssist);
  emit([0xca, 0x01, anyAirAssist ? 0x13 : 0x12]);

  const getLayerWorkModeByte = (layer: WorkbenchLayerConfig): number => {
    if (layer.mode === 'line') return 0x00;
    return layer.bidirectional === false ? 0x01 : 0x02;
  };

  // 2. Cabeceras de parámetros por capa activa (`OutputCutBankInfo` compatible RDC8445S hwType 0x13, 1 tubo)
  for (const layer of sortedLayers) {
    const lIdx = layer.cutIndex & 0x7f;
    const speed = layer.speedMmPerSec!;
    const maxP = layer.maxPowerPercent!;
    const minP =
      layer.minPowerPercent !== null && layer.minPowerPercent >= 0
        ? Math.min(maxP, layer.minPowerPercent)
        : maxP;
    const workMode = getLayerWorkModeByte(layer);

    // C9 04 <layer> <speed 5B>: Layer Speed
    emit([0xc9, 0x04, lIdx, ...encodeRuidaSpeedMmPerSec(speed)]);
    // C6 31/32 <layer> <power 2B>: Tube 1 Min/Max Power
    emit([0xc6, 0x31, lIdx, ...encodeRuidaPowerPercent(minP)]);
    emit([0xc6, 0x32, lIdx, ...encodeRuidaPowerPercent(maxP)]);
    // CA 41 <layer> <mode>: 0=Cut/Line, 1=Unidir Scan, 2=Bidir Scan (válido en RDC8445S hwType 0x13)
    emit([0xca, 0x41, lIdx, workMode]);
  }

  // 3. Emisión de trayectorias por orden de prioridad de capa
  const emitLayerPreamble = (layer: WorkbenchLayerConfig) => {
    const lIdx = layer.cutIndex & 0x7f;
    const speed = layer.speedMmPerSec!;
    const maxP = layer.maxPowerPercent!;
    const minP =
      layer.minPowerPercent !== null && layer.minPowerPercent >= 0
        ? Math.min(maxP, layer.minPowerPercent)
        : maxP;
    const workMode = getLayerWorkModeByte(layer);

    if (workMode !== 0x00) {
      // CA 01 05: Habilitar modo escaneo ráster (`EmitInlineCutSetting`)
      emit([0xca, 0x01, 0x05]);
    }
    // CA 01 <mode>: 0x00 Corte, 0x01 Scan Unidir, 0x02 Scan Bidir
    emit([0xca, 0x01, workMode]);
    // CA 02 <layer>: Select active layer
    emit([0xca, 0x02, lIdx]);
    // CA 01: Air assist toggle por capa
    emit([0xca, 0x01, layer.airAssist ? 0x13 : 0x12]);
    // C9 02 <speed 5B>: Active cut speed
    emit([0xc9, 0x02, ...encodeRuidaSpeedMmPerSec(speed)]);
    // C6 01/02: Tube 1 Active Min/Max power
    emit([0xc6, 0x01, ...encodeRuidaPowerPercent(minP)]);
    emit([0xc6, 0x02, ...encodeRuidaPowerPercent(maxP)]);
  };

  let curUmX = 0;
  let curUmY = 0;
  let hasCursor = false;

  const emitMoveAbs = (xMm: number, yMm: number) => {
    const rx = toRuidaX(xMm);
    const ry = toRuidaY(yMm);
    const tx = Math.round(rx * 1000);
    const ty = Math.round(ry * 1000);
    const dx = tx - curUmX;
    const dy = ty - curUmY;
    if (hasCursor && dx === 0 && dy === 0) return;
    if (hasCursor && dy === 0 && Math.abs(dx) < 8000) {
      // 8A <dx 2B>: Move Rel X (3 bytes en vez de 11, idéntico a LightBurn EmitMoveOrCut)
      emit([0x8a, ...encodeRuidaRelUm(dx)]);
    } else {
      // 88 <X 5B> <Y 5B>: Move Absolute (Rapid G0 Laser Off)
      emit([
        0x88,
        ...encodeRuidaAbsCoordMm(rx),
        ...encodeRuidaAbsCoordMm(ry),
      ]);
    }
    curUmX = tx;
    curUmY = ty;
    hasCursor = true;
  };

  const emitCutAbs = (xMm: number, yMm: number) => {
    const rx = toRuidaX(xMm);
    const ry = toRuidaY(yMm);
    const tx = Math.round(rx * 1000);
    const ty = Math.round(ry * 1000);
    const dx = tx - curUmX;
    const dy = ty - curUmY;
    if (hasCursor && dy === 0 && dx !== 0 && Math.abs(dx) < 8000) {
      // AA <dx 2B>: Cut Rel X (3 bytes en vez de 11 para trazos horizontales)
      emit([0xaa, ...encodeRuidaRelUm(dx)]);
    } else {
      // A8 <X 5B> <Y 5B>: Cut Absolute (G1 Laser On)
      emit([
        0xa8,
        ...encodeRuidaAbsCoordMm(rx),
        ...encodeRuidaAbsCoordMm(ry),
      ]);
    }
    curUmX = tx;
    curUmY = ty;
    hasCursor = true;
  };

  const emittedLayerCutIndices = new Set<number>();
  const executionMode = config.executionSequenceMode ?? 'sequential_per_job';
  const travelOrder = config.travelOrder ?? 'zigzag_rows';

  const emitJobLayerInRuida = (
    job: WorkbenchJobItem,
    layer: WorkbenchLayerConfig
  ) => {
    const passes = Math.max(1, layer.passes);
    const orderedInstances = sortInstancesInTravelOrder(job.instances, travelOrder);
    let emittedPreamble = false;

    const ensurePreamble = () => {
      if (!emittedPreamble) {
        emitLayerPreamble(layer);
        hasCursor = false;
        emittedPreamble = true;
        emittedLayerCutIndices.add(layer.cutIndex);
      }
    };

    if (layer.role === 'ENGRAVE') {
      for (const inst of orderedInstances) {
        if (inst.engraveItems.length === 0) continue;
        ensurePreamble();

        for (let pass = 0; pass < passes; pass++) {
          const isScanLayer = layer.mode !== 'line';
          const bidir = layer.bidirectional !== false;

          for (const eng of inst.engraveItems) {
            if (eng.kind === 'vector_path' && eng.polylines && eng.polylines.length > 0) {
              if (isScanLayer) {
                const absPolylines = eng.polylines.map((pl) => ({
                  closed: pl.closed,
                  points: pl.points.map((pt) => ({
                    x: roundMm(job.xMm + pt.x),
                    y: roundMm(job.yMm + pt.y),
                  })),
                }));
                const bb = eng.boundingBox;
                const fillRows = rasterizePolylinesToHorizontalRuns(
                  absPolylines,
                  roundMm(job.xMm + bb.minX),
                  roundMm(job.xMm + bb.maxX),
                  roundMm(job.yMm + bb.minY),
                  roundMm(job.yMm + bb.maxY),
                  Math.max(0.025, layer.lineIntervalMm || 0.08)
                );
                if (fillRows.length > 0) {
                  for (let row = 0; row < fillRows.length; row++) {
                    const { yMm, runsMm } = fillRows[row];
                    const forward = !bidir || row % 2 === 0;
                    if (forward) {
                      for (let r = 0; r < runsMm.length; r++) {
                        const [x0, x1] = runsMm[r];
                        emitMoveAbs(x0, yMm);
                        emitCutAbs(x1, yMm);
                      }
                    } else {
                      for (let r = runsMm.length - 1; r >= 0; r--) {
                        const [x0, x1] = runsMm[r];
                        emitMoveAbs(x1, yMm);
                        emitCutAbs(x0, yMm);
                      }
                    }
                  }
                  continue;
                }
              }

              for (const poly of eng.polylines) {
                if (poly.points.length < 2) continue;
                const p0 = poly.points[0];
                emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
                for (let i = 1; i < poly.points.length; i++) {
                  const pt = poly.points[i];
                  emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
                }
                if (poly.closed && poly.points.length > 2) {
                  emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
                }
              }
            } else {
              // Grabado raster real píxel a píxel de alta resolución en X (<= 0.02 mm)
              const bb = eng.boundingBox;
              const minX = roundMm(job.xMm + bb.minX);
              const maxX = roundMm(job.xMm + bb.maxX);
              const minY = roundMm(job.yMm + bb.minY);
              const maxY = roundMm(job.yMm + bb.maxY);
              const effInterval = Math.max(0.025, layer.lineIntervalMm || 0.08);
              const ditherMode = layer.imageDitherMode ?? 'threshold';

              let mask: RasterScanlineMask | undefined;
              if (eng.kind === 'raster_image' && eng.dataUrl) {
                const key = buildRasterMaskCacheKey({
                  dataUrl: eng.dataUrl,
                  bboxWidthMm: Math.max(0.5, bb.width || eng.widthMm || 10),
                  bboxHeightMm: Math.max(0.5, bb.height || eng.heightMm || 10),
                  rotationDeg: eng.rotationDeg ?? 0,
                  mirrored: !!eng.mirrored,
                  lineIntervalMm: effInterval,
                  ditherMode,
                });
                mask = rasterMasks?.get(key) ?? getCachedRasterScanlineMask(key);
              }

              if (mask && mask.rowRuns.length > 0) {
                const spanX = Math.max(0.01, maxX - minX);
                const spanY = Math.max(0.01, maxY - minY);
                for (let row = 0; row < mask.rowRuns.length; row++) {
                  const runs = mask.rowRuns[row];
                  if (runs.length === 0) continue;
                  const y = roundMm(minY + ((row + 0.5) / mask.rows) * spanY, 3);
                  const forward = !bidir || row % 2 === 0;
                  if (forward) {
                    for (let r = 0; r < runs.length; r++) {
                      const [u0, u1] = runs[r];
                      const x0 = roundMm(minX + u0 * spanX, 3);
                      const x1 = roundMm(minX + u1 * spanX, 3);
                      if (x1 - x0 < 0.012) continue;
                      emitMoveAbs(x0, y);
                      emitCutAbs(x1, y);
                    }
                  } else {
                    for (let r = runs.length - 1; r >= 0; r--) {
                      const [u0, u1] = runs[r];
                      const x0 = roundMm(minX + u0 * spanX, 3);
                      const x1 = roundMm(minX + u1 * spanX, 3);
                      if (x1 - x0 < 0.012) continue;
                      emitMoveAbs(x1, y);
                      emitCutAbs(x0, y);
                    }
                  }
                }
              } else {
                // Fallback seguro si no hay canvas DOM (tests headless): marcar solo contorno de encuadre sin bloque negro sólido
                emitMoveAbs(minX, minY);
                emitCutAbs(maxX, minY);
                emitCutAbs(maxX, maxY);
                emitCutAbs(minX, maxY);
                emitCutAbs(minX, minY);
              }
            }
          }
        }
      }
    } else if (layer.role === 'HOLES') {
      for (const inst of orderedInstances) {
        for (const hole of inst.holeContours) {
          if (hole.points.length < 2) continue;
          ensurePreamble();
          for (let pass = 0; pass < passes; pass++) {
            const p0 = hole.points[0];
            emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
            for (let i = 1; i < hole.points.length; i++) {
              const pt = hole.points[i];
              emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
            }
            emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
          }
        }
      }
    } else if (layer.role === 'CUT') {
      for (const inst of orderedInstances) {
        const contour = inst.cutContour;
        if (!contour || contour.points.length < 2) continue;
        ensurePreamble();
        for (let pass = 0; pass < passes; pass++) {
          const p0 = contour.points[0];
          emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
          for (let i = 1; i < contour.points.length; i++) {
            const pt = contour.points[i];
            emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
          }
          emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
        }
      }
    }
  };

  if (executionMode === 'sequential_per_job') {
    // Ejecutar Trabajo #1 completo (C00 Grabado -> C01 Agujeros -> C02 Corte), y recién al terminar seguir con #2, #3...
    for (const job of visibleJobs) {
      for (const layer of sortedLayers) {
        emitJobLayerInRuida(job, layer);
      }
    }
  } else {
    for (const layer of sortedLayers) {
      for (const job of visibleJobs) {
        emitJobLayerInRuida(job, layer);
      }
    }
  }

  const activeLayersCount = emittedLayerCutIndices.size;

  // Retornar cabezal al origen del trabajo y cerrar trama Ruida (`E7 00`, `DA 01 06 20`, `E5 05`, `D7`)
  emitMoveAbs(origin.x, origin.y);
  appendRuidaProgramFooter(raw, emit, 0);

  const rawUnscrambledBytes = new Uint8Array(raw);
  const rdBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    rdBytes[i] = scrambleRuidaByte(raw[i]);
  }

  return {
    rdBytes,
    rawUnscrambledBytes,
    filenameSuggested: `${cleanJobName}_Vank9060.rd`,
    ruidaJobName: cleanJobName,
    totalPieces: report.totalPieces,
    activeLayersCount,
    boundingBoxMm: bounds,
    commandCount,
  };
}
