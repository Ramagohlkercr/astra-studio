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
