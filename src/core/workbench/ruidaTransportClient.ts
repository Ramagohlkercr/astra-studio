import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildRuidaFileUploadHeaderBytes,
  buildRuidaUdpPackets,
  isValidIpv4Address,
  RuidaProbeResponse,
  RuidaUploadProgress,
  RuidaUploadResponse,
  sanitizeRuidaJobName,
  verifyRuidaUdpPacketChecksums,
} from './ruidaCompiler';

export interface RuidaMachineStatus {
  reachable: boolean;
  is_running: boolean;
  is_paused: boolean;
  is_framing: boolean;
  state_bits: number;
  raw_reply_hex?: string | null;
  transport_mode?: string | null;
  latency_ms?: number | null;
}

export interface RuidaControllerFile {
  index: number;
  name: string;
}

export interface RuidaFilesListResponse {
  reachable: boolean;
  files: RuidaControllerFile[];
}

export interface RuidaMotionParamsResponse {
  calibrated: boolean;
  idle_speed_mm_s: number | null;
  idle_accel_mm_s2: number | null;
  max_speed_x_mm_s: number | null;
  max_speed_y_mm_s: number | null;
  cut_accel_x_mm_s2: number | null;
  cut_accel_y_mm_s2: number | null;
  scan_accel_x_mm_s2: number | null;
  scan_accel_y_mm_s2: number | null;
  speed_factor: number | null;
}

/**
 * Consulta en tiempo real (solo lectura) los flags de ejecución de la Ruida RDC8445S
 * (`running`, `paused`, `framing`) para disparar cronómetro y alerta automática de fin.
 */
export async function queryVankRuidaMachineStatus(params: {
  ip: string;
  port: number;
}): Promise<RuidaMachineStatus> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp) || !isTauri()) {
    return {
      reachable: false,
      is_running: false,
      is_paused: false,
      is_framing: false,
      state_bits: 0,
    };
  }
  try {
    return await invoke<RuidaMachineStatus>('query_ruida_machine_status', {
      ip: cleanIp,
      port: params.port,
    });
  } catch {
    return {
      reachable: false,
      is_running: false,
      is_paused: false,
      is_framing: false,
      state_bits: 0,
    };
  }
}

/** Lee los parámetros reales de aceleración/velocidad de la controladora Ruida para calibración automática 1:1 de tiempo. */
export async function queryVankRuidaMotionParams(params: {
  ip: string;
  port: number;
}): Promise<RuidaMotionParamsResponse> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp) || !isTauri()) {
    return {
      calibrated: false,
      idle_speed_mm_s: null,
      idle_accel_mm_s2: null,
      max_speed_x_mm_s: null,
      max_speed_y_mm_s: null,
      cut_accel_x_mm_s2: null,
      cut_accel_y_mm_s2: null,
      scan_accel_x_mm_s2: null,
      scan_accel_y_mm_s2: null,
      speed_factor: null,
    };
  }
  try {
    return await invoke<RuidaMotionParamsResponse>('query_ruida_motion_params', {
      ip: cleanIp,
      port: params.port,
    });
  } catch {
    return {
      calibrated: false,
      idle_speed_mm_s: null,
      idle_accel_mm_s2: null,
      max_speed_x_mm_s: null,
      max_speed_y_mm_s: null,
      cut_accel_x_mm_s2: null,
      cut_accel_y_mm_s2: null,
      scan_accel_x_mm_s2: null,
      scan_accel_y_mm_s2: null,
      speed_factor: null,
    };
  }
}

/** Lista los archivos almacenados actualmente en memoria de la Vank 9060. */
export async function listVankRuidaFiles(params: {
  ip: string;
  port: number;
}): Promise<RuidaFilesListResponse> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp) || !isTauri()) {
    return { reachable: false, files: [] };
  }
  try {
    return await invoke<RuidaFilesListResponse>('list_ruida_files', {
      ip: cleanIp,
      port: params.port,
    });
  } catch {
    return { reachable: false, files: [] };
  }
}

/**
 * Ejecuta un diagnóstico de red y handshake Ruida seguro (solo lectura, sin mover ni disparar láser)
 * hacia la controladora Vank 9060 (`ip:port`). En navegador web nunca simula falso estado online.
 */
export async function probeVankRuidaConnection(params: {
  ip: string;
  port: number;
  preparedSummary?: string;
}): Promise<RuidaProbeResponse> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp)) {
    return {
      reachable: false,
      ping_ok: false,
      udp_handshake_ok: false,
      ip: cleanIp,
      port: params.port,
      local_port_40200_free: false,
      message: `Dirección IP inválida: "${cleanIp}". Usá formato IPv4 válido (ej. 192.168.0.195).`,
    };
  }

  if (!Number.isInteger(params.port) || params.port <= 0 || params.port > 65535) {
    return {
      reachable: false,
      ping_ok: false,
      udp_handshake_ok: false,
      ip: cleanIp,
      port: params.port,
      local_port_40200_free: false,
      message: `Puerto UDP inválido (${params.port}). Estándar Ruida RDC8445S: 50200.`,
    };
  }

  if (!isTauri()) {
    const suffix = params.preparedSummary ? ` ${params.preparedSummary}` : '';
    return {
      reachable: false,
      ping_ok: false,
      udp_handshake_ok: false,
      ip: cleanIp,
      port: params.port,
      local_port_40200_free: false,
      message: `Configuración válida para Vank 9060 (${cleanIp}:${params.port}).${suffix} Para prueba real TCP/UDP y envío directo a la controladora Ruida usá la app nativa Astra Studio (.app).`,
    };
  }

  return invoke<RuidaProbeResponse>('probe_ruida_connection', {
    ip: cleanIp,
    port: params.port,
  });
}

/**
 * Audita checksums 16-bit de todos los datagramas y transmite un archivo compilado (.RD) a la Vank 9060
 * escuchando progreso paquete a paquete (`ruida_upload_progress`).
 */
export async function uploadRdBytesToVankRuida(params: {
  ip: string;
  port: number;
  rdBytes: Uint8Array;
  jobName?: string;
  onProgress?: (progress: RuidaUploadProgress) => void;
}): Promise<RuidaUploadResponse> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp)) {
    throw new Error(
      `Dirección IP inválida: "${cleanIp}". Corregí la IP de la Vank 9060 (ej. 192.168.0.195).`
    );
  }
  if (!Number.isInteger(params.port) || params.port <= 0 || params.port > 65535) {
    throw new Error(`Puerto UDP inválido (${params.port}). Estándar Ruida: 50200.`);
  }

  const headerPackets = params.jobName
    ? buildRuidaUdpPackets(buildRuidaFileUploadHeaderBytes(sanitizeRuidaJobName(params.jobName)))
    : [];
  const packets = [...headerPackets, ...buildRuidaUdpPackets(params.rdBytes)];
  if (!verifyRuidaUdpPacketChecksums(packets)) {
    throw new Error(
      'Error interno de integridad: los paquetes UDP Ruida generados no pasaron la verificación de checksum 16-bit.'
    );
  }

  if (!isTauri()) {
    throw new Error(
      'El envío directo por red UDP requiere la app nativa Astra Studio macOS (.app). Podés descargar el archivo .RD (USB) o abrirlo en LightBurn (.lbrn2).'
    );
  }

  let unlisten: UnlistenFn | null = null;
  if (params.onProgress) {
    unlisten = await listen<RuidaUploadProgress>('ruida_upload_progress', (event) => {
      if (event.payload) {
        params.onProgress?.(event.payload);
      }
    });
  }

  try {
    const packetArrays = packets.map((pkt) => Array.from(pkt));
    return await invoke<RuidaUploadResponse>('upload_rd_to_ruida', {
      ip: cleanIp,
      port: params.port,
      packets: packetArrays,
    });
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}

export type RuidaPanelAction = 'stop' | 'pause' | 'reset';

export interface RuidaPanelActionResponse {
  ok: boolean;
  reachable: boolean;
  message: string;
}

export type SmartRelayPreset =
  | 'none'
  | 'shelly_gen2'
  | 'shelly_gen1'
  | 'tasmota'
  | 'custom_http';

export interface MachinePowerRelayConfig {
  relayPreset: SmartRelayPreset;
  relayHostOrUrl: string;
  authHeader: string;
  autoPowerOffOnFinish: boolean;
  cooldownSeconds: number;
}

export const DEFAULT_MACHINE_POWER_RELAY_CONFIG: MachinePowerRelayConfig = {
  relayPreset: 'shelly_gen2',
  relayHostOrUrl: '',
  authHeader: '',
  autoPowerOffOnFinish: false,
  cooldownSeconds: 120,
};

const POWER_RELAY_STORAGE_KEY = 'astra_vank9060_power_relay_v1';

export function loadMachinePowerRelayConfig(): MachinePowerRelayConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_MACHINE_POWER_RELAY_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(POWER_RELAY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MACHINE_POWER_RELAY_CONFIG };
    const parsed = JSON.parse(raw) as Partial<MachinePowerRelayConfig>;
    return {
      ...DEFAULT_MACHINE_POWER_RELAY_CONFIG,
      ...parsed,
      cooldownSeconds: Math.max(15, Math.min(900, Number(parsed.cooldownSeconds ?? 120) || 120)),
    };
  } catch {
    return { ...DEFAULT_MACHINE_POWER_RELAY_CONFIG };
  }
}

export function saveMachinePowerRelayConfig(cfg: MachinePowerRelayConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(POWER_RELAY_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignorar error de cuota
  }
}

export function buildSmartRelayPowerCommand(
  cfg: MachinePowerRelayConfig,
  targetState: 'off' | 'on'
): { url: string; method: 'GET' | 'POST'; bodyJson?: string; authHeader?: string } | null {
  if (cfg.relayPreset === 'none') return null;
  const raw = cfg.relayHostOrUrl.trim();
  if (!raw) return null;

  const baseUrl = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : `http://${raw}`;

  if (cfg.relayPreset === 'custom_http') {
    return {
      url: baseUrl,
      method: targetState === 'off' ? 'POST' : 'GET',
      ...(targetState === 'off' ? { bodyJson: '{"power":"off"}' } : {}),
      ...(cfg.authHeader.trim() ? { authHeader: cfg.authHeader.trim() } : {}),
    };
  }

  // Quitar path si usuario pegó una URL completa en presets estándar
  const originOnly = baseUrl.replace(/^(https?:\/\/[^/]+).*$/i, '$1');
  if (cfg.relayPreset === 'shelly_gen2') {
    return {
      url: `${originOnly}/rpc/Switch.Set?id=0&on=${targetState === 'on' ? 'true' : 'false'}`,
      method: 'GET',
      ...(cfg.authHeader.trim() ? { authHeader: cfg.authHeader.trim() } : {}),
    };
  }
  if (cfg.relayPreset === 'shelly_gen1') {
    return {
      url: `${originOnly}/relay/0?turn=${targetState}`,
      method: 'GET',
      ...(cfg.authHeader.trim() ? { authHeader: cfg.authHeader.trim() } : {}),
    };
  }
  // Sonoff / Tasmota
  return {
    url: `${originOnly}/cm?cmnd=${encodeURIComponent(
      targetState === 'on' ? 'Power On' : 'Power Off'
    )}`,
    method: 'GET',
    ...(cfg.authHeader.trim() ? { authHeader: cfg.authHeader.trim() } : {}),
  };
}

export interface SmartRelayHttpResponse {
  ok: boolean;
  status_code: number | null;
  body_preview: string;
  message: string;
}

export async function sendVankRuidaPanelAction(params: {
  ip: string;
  port: number;
  action: RuidaPanelAction;
}): Promise<RuidaPanelActionResponse> {
  const cleanIp = params.ip.trim();
  if (!isValidIpv4Address(cleanIp)) {
    return { ok: false, reachable: false, message: `IP inválida: "${cleanIp}".` };
  }
  if (!isTauri()) {
    return {
      ok: false,
      reachable: false,
      message: 'Comandos remotos a Ruida disponibles en la app nativa Astra Studio (.app).',
    };
  }
  try {
    return await invoke<RuidaPanelActionResponse>('send_ruida_panel_action', {
      ip: cleanIp,
      port: params.port,
      action: params.action,
    });
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerSmartRelayPower(
  cfg: MachinePowerRelayConfig,
  targetState: 'off' | 'on'
): Promise<SmartRelayHttpResponse> {
  const cmd = buildSmartRelayPowerCommand(cfg, targetState);
  if (!cmd) {
    return {
      ok: false,
      status_code: null,
      body_preview: '',
      message:
        'Relé eléctrico 220V no configurado aún. Ingresá la IP del relé Wi-Fi (ej. Shelly Plus 1 + contactor 25A) para cortar alimentación.',
    };
  }
  if (!isTauri()) {
    return {
      ok: false,
      status_code: null,
      body_preview: '',
      message: 'El disparo local HTTP al relé 220V se ejecuta desde la app nativa Astra Studio (.app).',
    };
  }
  try {
    return await invoke<SmartRelayHttpResponse>('trigger_smart_relay_http', {
      url: cmd.url,
      method: cmd.method,
      bodyJson: cmd.bodyJson ?? null,
      authHeader: cmd.authHeader ?? null,
    });
  } catch (err) {
    return {
      ok: false,
      status_code: null,
      body_preview: '',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
