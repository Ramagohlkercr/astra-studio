use std::{
    fs,
    io::{self, ErrorKind, Read, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpStream, UdpSocket},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use serde::Serialize;
use tauri::{Emitter, Manager};

const RUIDA_ACK_OK: u8 = 0xCC;
const RUIDA_ACK_ALT: u8 = 0xC6;
const RUIDA_NAK_CHECKSUM: u8 = 0xCF;
const RUIDA_NAK_ALT: u8 = 0x46;
const RUIDA_MAGIC: u8 = 0x88;
const RUIDA_MAGIC_ALT: u8 = 0x11;
const MAX_RETRIES_PER_PACKET: usize = 4;
const PACKET_READ_TIMEOUT_MS: u64 = 1500;
const PROBE_UDP_TIMEOUT_MS: u64 = 750;
const TCP_CONNECT_TIMEOUT_MS: u64 = 1500;
const PROBE_TCP_READ_TIMEOUT_MS: u64 = 1200;

#[derive(Serialize, Clone)]
pub struct RuidaUploadProgress {
    pub current_packet: usize,
    pub total_packets: usize,
    pub percent: u8,
    pub bytes_sent: usize,
    pub total_bytes: usize,
    pub retries: usize,
}

#[derive(Serialize)]
pub struct RuidaUploadResponse {
    pub success: bool,
    pub packets_sent: usize,
    pub bytes_sent: usize,
    pub retries: usize,
    pub elapsed_ms: u64,
    pub used_local_port_40200: bool,
    pub transport_mode: String,
    pub remote_endpoint: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct OpenLightBurnResponse {
    pub saved_path: String,
    pub launched_lightburn: bool,
    pub message: String,
}

#[derive(Serialize)]
pub struct RuidaProbeResponse {
    pub reachable: bool,
    pub ping_ok: bool,
    pub udp_handshake_ok: bool,
    pub transport_mode: Option<String>,
    pub controller_reply_hex: Option<String>,
    pub latency_ms: Option<u64>,
    pub ip: String,
    pub port: u16,
    pub local_port_40200_free: bool,
    pub message: String,
}

fn parse_ipv4(ip_str: &str) -> Result<Ipv4Addr, String> {
    ip_str
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| format!("Dirección IPv4 inválida: '{ip_str}'. Ejemplo válido: 192.168.0.195"))
}

fn scramble_ruida_byte(raw: u8, magic: u8) -> u8 {
    let swapped = (raw & 0x7e) | ((raw >> 7) & 0x01) | ((raw & 0x01) << 7);
    let xored = swapped ^ magic;
    xored.wrapping_add(1)
}

fn build_checksum_udp_packet(scrambled_payload: &[u8]) -> Vec<u8> {
    let checksum: u16 = scrambled_payload
        .iter()
        .fold(0u16, |acc, &b| acc.wrapping_add(b as u16));
    let mut pkt = Vec::with_capacity(scrambled_payload.len() + 2);
    pkt.extend_from_slice(&checksum.to_be_bytes());
    pkt.extend_from_slice(scrambled_payload);
    pkt
}

/// Construye un paquete de consulta de solo lectura Ruida con `magic` configurable
/// sin comandos de movimiento ni disparo láser.
fn build_safe_ruida_probe_packet_with(raw_query: &[u8], magic: u8) -> Vec<u8> {
    let scrambled: Vec<u8> = raw_query
        .iter()
        .map(|&b| scramble_ruida_byte(b, magic))
        .collect();
    build_checksum_udp_packet(&scrambled)
}

#[cfg(test)]
fn build_safe_ruida_probe_packet() -> Vec<u8> {
    build_safe_ruida_probe_packet_with(&[0xDAu8, 0x00, 0x05, 0x7E], RUIDA_MAGIC)
}

fn bind_ruida_socket() -> Result<(UdpSocket, bool), String> {
    match UdpSocket::bind("0.0.0.0:40200") {
        Ok(sock) => Ok((sock, true)),
        Err(_) => {
            let sock = UdpSocket::bind("0.0.0.0:0")
                .map_err(|e| format!("No se pudo abrir el socket UDP local: {e}"))?;
            Ok((sock, false))
        }
    }
}

fn drain_stale_datagrams(socket: &UdpSocket) {
    let _ = socket.set_nonblocking(true);
    let mut junk = [0u8; 256];
    while socket.recv_from(&mut junk).is_ok() {}
    let _ = socket.set_nonblocking(false);
}

fn recv_from_expected_ip(
    socket: &UdpSocket,
    expected_ip: Ipv4Addr,
    buf: &mut [u8],
    deadline: Duration,
) -> Result<(usize, SocketAddr), String> {
    let start = Instant::now();
    loop {
        let elapsed = start.elapsed();
        if elapsed >= deadline {
            return Err("Timeout esperando respuesta UDP de la controladora Ruida.".into());
        }
        let remaining = deadline.saturating_sub(elapsed);
        let _ = socket.set_read_timeout(Some(remaining.max(Duration::from_millis(50))));
        match socket.recv_from(buf) {
            Ok((n, src)) => {
                if n > 0 && src.ip() == std::net::IpAddr::V4(expected_ip) {
                    return Ok((n, src));
                }
            }
            Err(e) => return Err(format!("{e}")),
        }
    }
}

fn extract_verified_payload(pkt: &[u8], idx: usize) -> Result<&[u8], String> {
    if pkt.len() < 3 {
        return Err(format!("Paquete #{} demasiado corto.", idx + 1));
    }
    let expected_checksum = u16::from_be_bytes([pkt[0], pkt[1]]);
    let payload = &pkt[2..];
    let actual_checksum: u16 = payload
        .iter()
        .fold(0u16, |acc, &b| acc.wrapping_add(b as u16));
    if expected_checksum != actual_checksum {
        return Err(format!(
            "Checksum Ruida inválido en paquete #{} (esperado 0x{expected_checksum:04X}, real 0x{actual_checksum:04X}).",
            idx + 1
        ));
    }
    Ok(payload)
}

fn try_connect_ruida_tcp(
    target_ip: Ipv4Addr,
    port: u16,
    timeout_ms: u64,
) -> Result<TcpStream, io::Error> {
    let addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));
    let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms))?;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_write_timeout(Some(Duration::from_millis(2000)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(PACKET_READ_TIMEOUT_MS)));
    Ok(stream)
}

fn is_ruida_ack(b: u8) -> bool {
    b == RUIDA_ACK_OK || b == RUIDA_ACK_ALT
}

fn is_ruida_nak(b: u8) -> bool {
    b == RUIDA_NAK_CHECKSUM || b == RUIDA_NAK_ALT
}

fn is_macos_permission_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("permitted")
        || lower.contains("eperm")
        || lower.contains("eacces")
        || lower.contains("os error 1")
}

fn format_hex_preview(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(12)
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_safe_tcp_probe_payload(raw_query: &[u8], magic: u8) -> Vec<u8> {
    raw_query
        .iter()
        .map(|&b| scramble_ruida_byte(b, magic))
        .collect()
}

/// Envía paquetes Ruida sobre TCP (`RDC8445S / LightBurn TCP_PK`, puerto 50200):
/// valida el checksum de entrada, quita los 2 bytes UDP del encabezado checksum
/// y transmite la carga ofuscada pura por TCP esperando ACK 0xC6/0xCC por chunk.
fn upload_packets_tcp_internal<F>(
    target_ip: Ipv4Addr,
    port: u16,
    packets: &[Vec<u8>],
    stream: &mut TcpStream,
    mut on_progress: F,
) -> Result<RuidaUploadResponse, String>
where
    F: FnMut(RuidaUploadProgress),
{
    if port == 0 {
        return Err("El puerto TCP/UDP de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }
    if packets.is_empty() {
        return Err("No hay paquetes Ruida para enviar.".into());
    }

    let remote_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));
    let _ = stream.set_nodelay(true);
    stream
        .set_write_timeout(Some(Duration::from_millis(2000)))
        .map_err(|e| format!("Error al configurar timeout de escritura TCP: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(PACKET_READ_TIMEOUT_MS)))
        .map_err(|e| format!("Error al configurar timeout de lectura TCP: {e}"))?;

    let total_packets = packets.len();
    let payloads: Vec<&[u8]> = packets
        .iter()
        .enumerate()
        .map(|(i, p)| extract_verified_payload(p, i))
        .collect::<Result<Vec<_>, _>>()?;
    let total_bytes: usize = payloads.iter().map(|p| p.len()).sum();

    let mut packets_sent = 0usize;
    let mut bytes_sent = 0usize;
    let mut retries = 0usize;
    let mut ack_buf = [0u8; 32];
    let started = Instant::now();

    for (idx, payload) in payloads.iter().enumerate() {
        let mut packet_accepted = false;
        let mut last_err = String::new();

        for attempt in 0..MAX_RETRIES_PER_PACKET {
            if attempt > 0 {
                retries += 1;
                thread::sleep(Duration::from_millis(30));
            }

            if let Err(e) = stream.write_all(payload).and_then(|_| stream.flush()) {
                last_err = format!(
                    "Error de red TCP al enviar paquete #{} a {}: {e}",
                    idx + 1,
                    remote_addr
                );
                if matches!(
                    e.kind(),
                    ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted
                ) {
                    if let Ok(new_stream) = try_connect_ruida_tcp(target_ip, port, TCP_CONNECT_TIMEOUT_MS) {
                        *stream = new_stream;
                    }
                }
                continue;
            }

            match stream.read(&mut ack_buf) {
                Ok(n) if n > 0 => {
                    let ack = ack_buf[0];
                    if is_ruida_ack(ack) {
                        packet_accepted = true;
                        break;
                    }
                    if is_ruida_nak(ack) {
                        last_err = format!(
                            "La controladora Ruida devolvió NAK 0x{:02X} en el paquete #{} (error de trama o memoria llena).",
                            ack,
                            idx + 1
                        );
                        continue;
                    }
                    last_err = format!(
                        "Respuesta TCP inesperada 0x{:02X} de Ruida en paquete #{}.",
                        ack,
                        idx + 1
                    );
                }
                Ok(_) => {
                    last_err = format!(
                        "La Vank 9060 cerró el socket TCP sin confirmar paquete #{}.",
                        idx + 1
                    );
                }
                Err(e) => {
                    last_err = format!(
                        "Sin respuesta TCP de la Vank 9060 en {} (paquete #{}, intento {}/{}): {}",
                        remote_addr,
                        idx + 1,
                        attempt + 1,
                        MAX_RETRIES_PER_PACKET,
                        e
                    );
                }
            }
        }

        if !packet_accepted {
            return Err(format!(
                "{last_err} Verificá que la máquina esté encendida, con permiso 'Red local' activo en macOS y LightBurn cerrado."
            ));
        }

        packets_sent += 1;
        bytes_sent += payload.len();
        let percent = ((packets_sent * 100) / total_packets).min(100) as u8;
        on_progress(RuidaUploadProgress {
            current_packet: packets_sent,
            total_packets,
            percent,
            bytes_sent,
            total_bytes,
            retries,
        });
    }

    let _ = stream.shutdown(Shutdown::Both);
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let retry_note = if retries > 0 {
        format!(" · {retries} reintento(s) recuperado(s)")
    } else {
        String::new()
    };

    Ok(RuidaUploadResponse {
        success: true,
        packets_sent,
        bytes_sent,
        retries,
        elapsed_ms,
        used_local_port_40200: false,
        transport_mode: "TCP (RDC8445S)".into(),
        remote_endpoint: remote_addr.to_string(),
        message: format!(
            "✓ Trabajo cargado en la Vank 9060 por TCP RDC8445S ({packets_sent} paquetes, {bytes_sent} bytes en {elapsed_ms} ms{retry_note}). Verificá el encuadre (FRAME) antes de darle Start."
        ),
    })
}

fn upload_packets_internal<F>(
    target_ip: Ipv4Addr,
    port: u16,
    packets: &[Vec<u8>],
    socket: &UdpSocket,
    used_local_port_40200: bool,
    mut on_progress: F,
) -> Result<RuidaUploadResponse, String>
where
    F: FnMut(RuidaUploadProgress),
{
    if port == 0 {
        return Err("El puerto UDP de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }
    if packets.is_empty() {
        return Err("No hay paquetes Ruida para enviar.".into());
    }

    let remote_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));
    socket
        .set_write_timeout(Some(Duration::from_millis(2000)))
        .map_err(|e| format!("Error al configurar timeout de escritura UDP: {e}"))?;

    drain_stale_datagrams(socket);

    let total_packets = packets.len();
    let total_bytes: usize = packets.iter().map(|p| p.len()).sum();
    let mut packets_sent = 0usize;
    let mut bytes_sent = 0usize;
    let mut retries = 0usize;
    let mut ack_buf = [0u8; 32];
    let started = Instant::now();

    for (idx, pkt) in packets.iter().enumerate() {
        if pkt.len() < 3 {
            return Err(format!("Paquete #{} demasiado corto.", idx + 1));
        }

        let mut packet_accepted = false;
        let mut last_err = String::new();

        for attempt in 0..MAX_RETRIES_PER_PACKET {
            if attempt > 0 {
                retries += 1;
                thread::sleep(Duration::from_millis(25));
            }

            if let Err(e) = socket.send_to(pkt, remote_addr) {
                last_err = format!(
                    "Error de red al enviar paquete #{} a {}: {e}",
                    idx + 1,
                    remote_addr
                );
                continue;
            }

            match recv_from_expected_ip(
                socket,
                target_ip,
                &mut ack_buf,
                Duration::from_millis(PACKET_READ_TIMEOUT_MS),
            ) {
                Ok((n, _)) if n > 0 => {
                    let ack = ack_buf[0];
                    if ack == RUIDA_ACK_OK || ack == RUIDA_ACK_ALT {
                        packet_accepted = true;
                        break;
                    }
                    if ack == RUIDA_NAK_CHECKSUM || ack == RUIDA_NAK_ALT {
                        last_err = format!(
                            "La controladora Ruida devolvió NAK 0x{:02X} en el paquete #{} (error de checksum o memoria llena).",
                            ack,
                            idx + 1
                        );
                        continue;
                    }
                    // Otro código de respuesta válido pero no estándar: avisar como error tras reintentar
                    last_err = format!(
                        "Respuesta inesperada 0x{:02X} de Ruida en paquete #{}.",
                        ack,
                        idx + 1
                    );
                }
                Ok(_) => {
                    last_err = format!("Respuesta vacía en paquete #{}.", idx + 1);
                }
                Err(e) => {
                    last_err = format!(
                        "Sin respuesta de la Vank 9060 en {} (paquete #{}, intento {}/{}): {}",
                        remote_addr,
                        idx + 1,
                        attempt + 1,
                        MAX_RETRIES_PER_PACKET,
                        e
                    );
                }
            }
        }

        if !packet_accepted {
            return Err(format!(
                "{last_err} Verificá que la máquina esté encendida, en la misma red LAN/Wi-Fi y con el puerto 40200 libre (cerrá LightBurn si está abierto)."
            ));
        }

        packets_sent += 1;
        bytes_sent += pkt.len();
        let percent = ((packets_sent * 100) / total_packets).min(100) as u8;
        on_progress(RuidaUploadProgress {
            current_packet: packets_sent,
            total_packets,
            percent,
            bytes_sent,
            total_bytes,
            retries,
        });
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let retry_note = if retries > 0 {
        format!(" · {retries} reintento(s) recuperado(s)")
    } else {
        String::new()
    };

    Ok(RuidaUploadResponse {
        success: true,
        packets_sent,
        bytes_sent,
        retries,
        elapsed_ms,
        used_local_port_40200,
        transport_mode: "UDP (50200↔40200)".into(),
        remote_endpoint: remote_addr.to_string(),
        message: format!(
            "✓ Trabajo cargado en memoria de la Vank 9060 ({packets_sent} paquetes, {bytes_sent} bytes en {elapsed_ms} ms{retry_note}). Verificá el encuadre (FRAME) antes de darle Start."
        ),
    })
}

struct TcpProbeOutcome {
    tcp_connected: bool,
    handshake_ok: bool,
    reply_hex: Option<String>,
    latency_ms: Option<u64>,
    os_error: Option<String>,
}

fn probe_tcp_handshake_internal(target_ip: Ipv4Addr, port: u16) -> TcpProbeOutcome {
    let connect_started = Instant::now();
    let mut stream = match try_connect_ruida_tcp(target_ip, port, TCP_CONNECT_TIMEOUT_MS) {
        Ok(s) => s,
        Err(e) => {
            return TcpProbeOutcome {
                tcp_connected: false,
                handshake_ok: false,
                reply_hex: None,
                latency_ms: None,
                os_error: Some(format!("{e}")),
            };
        }
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(PROBE_TCP_READ_TIMEOUT_MS)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1000)));

    let queries: [(&[u8], u8); 5] = [
        (&[0xDA, 0x00, 0x05, 0x7E], RUIDA_MAGIC),
        (&[0xDA, 0x00, 0x04, 0x01], RUIDA_MAGIC),
        (&[0xDA, 0x00, 0x04, 0x05], RUIDA_MAGIC),
        (&[0xCE], RUIDA_MAGIC),
        (&[0xDA, 0x00, 0x05, 0x7E], RUIDA_MAGIC_ALT),
    ];

    let mut buf = [0u8; 64];
    let mut last_error: Option<String> = None;

    for (raw_query, magic) in queries {
        let payload = build_safe_tcp_probe_payload(raw_query, magic);
        let started = Instant::now();
        if let Err(e) = stream.write_all(&payload).and_then(|_| stream.flush()) {
            last_error = Some(format!("{e}"));
            if matches!(
                e.kind(),
                ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted
            ) {
                if let Ok(reconnected) = try_connect_ruida_tcp(target_ip, port, TCP_CONNECT_TIMEOUT_MS) {
                    stream = reconnected;
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(PROBE_TCP_READ_TIMEOUT_MS)));
                }
            }
            continue;
        }

        match stream.read(&mut buf) {
            Ok(n) if n > 0 => {
                let latency_ms = started
                    .elapsed()
                    .as_millis()
                    .max(connect_started.elapsed().as_millis().min(1)) as u64;
                // Si llegó solo el ACK 0xC6, damos una breve ventana para capturar los bytes DA 01 siguientes si vinieron aparte
                let mut total_n = n;
                if total_n == 1 && total_n < buf.len() {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(60)));
                    if let Ok(extra) = stream.read(&mut buf[total_n..]) {
                        total_n += extra;
                    }
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(PROBE_TCP_READ_TIMEOUT_MS)));
                }

                // Ignorar NAK puro si no hubo ACK, probar siguiente consulta
                if total_n == 1 && is_ruida_nak(buf[0]) {
                    last_error = Some(format!("Controladora devolvió NAK 0x{:02X}", buf[0]));
                    continue;
                }

                let _ = stream.shutdown(Shutdown::Both);
                return TcpProbeOutcome {
                    tcp_connected: true,
                    handshake_ok: true,
                    reply_hex: Some(format_hex_preview(&buf[..total_n])),
                    latency_ms: Some(latency_ms),
                    os_error: None,
                };
            }
            Ok(_) => {
                last_error = Some("Socket TCP cerrado por la controladora sin respuesta.".into());
            }
            Err(e) => {
                last_error = Some(format!("{e}"));
            }
        }
    }

    let _ = stream.shutdown(Shutdown::Both);
    TcpProbeOutcome {
        tcp_connected: true,
        handshake_ok: false,
        reply_hex: None,
        latency_ms: Some(connect_started.elapsed().as_millis() as u64),
        os_error: last_error,
    }
}

fn probe_udp_handshake_internal(
    target_ip: Ipv4Addr,
    port: u16,
    socket: &UdpSocket,
) -> (bool, Option<String>, Option<u64>, Option<String>) {
    let remote_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(500)));

    // Consultas seguras de solo lectura (DA 00 ...): estado IO, ID de placa, archivos guardados y magic alterno
    let queries: [([u8; 4], u8); 4] = [
        ([0xDA, 0x00, 0x05, 0x7E], RUIDA_MAGIC),
        ([0xDA, 0x00, 0x04, 0x01], RUIDA_MAGIC),
        ([0xDA, 0x00, 0x04, 0x05], RUIDA_MAGIC),
        ([0xDA, 0x00, 0x05, 0x7E], RUIDA_MAGIC_ALT),
    ];

    let mut buf = [0u8; 64];
    let mut last_os_error: Option<String> = None;

    for (raw_query, magic) in queries {
        let query = build_safe_ruida_probe_packet_with(&raw_query, magic);
        drain_stale_datagrams(socket);
        let started = Instant::now();
        if let Err(e) = socket.send_to(&query, remote_addr) {
            last_os_error = Some(format!("{e}"));
            continue;
        }

        match recv_from_expected_ip(
            socket,
            target_ip,
            &mut buf,
            Duration::from_millis(PROBE_UDP_TIMEOUT_MS),
        ) {
            Ok((n, _)) if n > 0 => {
                let latency_ms = started.elapsed().as_millis() as u64;
                return (true, Some(format_hex_preview(&buf[..n])), Some(latency_ms), None);
            }
            Ok(_) => {}
            Err(e) => {
                last_os_error = Some(e);
            }
        }
    }

    (false, None, None, last_os_error)
}

/// Envía paquetes Ruida pre-compilados y auditados a la controladora Vank 9060 (`192.168.0.195:50200`).
/// Autodetecta TCP Packet (`RDC8445S` / LightBurn `TCP_PK`, quitando los 2 bytes de checksum UDP)
/// o UDP clásico (`50200↔40200`), verificando ACK real (0xC6 / 0xCC) por paquete con reintentos.
#[tauri::command]
pub async fn upload_rd_to_ruida(
    app: tauri::AppHandle,
    ip: String,
    port: u16,
    packets: Vec<Vec<u8>>,
) -> Result<RuidaUploadResponse, String> {
    let target_ip = parse_ipv4(&ip)?;
    if port == 0 {
        return Err("El puerto de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Intentar primero TCP Packet (RDC8445S / Vank 9060 escucha TCP en puerto 50200)
        match try_connect_ruida_tcp(target_ip, port, TCP_CONNECT_TIMEOUT_MS) {
            Ok(mut stream) => {
                return upload_packets_tcp_internal(target_ip, port, &packets, &mut stream, |prog| {
                    let _ = app.emit("ruida_upload_progress", &prog);
                });
            }
            Err(e) => {
                let err_str = format!("{e}");
                if is_macos_permission_error(&err_str) {
                    return Err(format!(
                        "macOS bloqueó el acceso de red local hacia {target_ip}:{port}. Habilitá 'Astra Studio' en Ajustes del Sistema → Privacidad y seguridad → Red local."
                    ));
                }
            }
        }

        // 2. Fallback automático a Ruida UDP clásico (RDC6445G/S: 50200↔40200)
        let (socket, used_40200) = bind_ruida_socket()?;
        upload_packets_internal(target_ip, port, &packets, &socket, used_40200, |prog| {
            let _ = app.emit("ruida_upload_progress", &prog);
        })
    })
    .await
    .map_err(|e| format!("Fallo interno de hilo al transmitir a Ruida: {e}"))?
}

/// Guarda el archivo .lbrn2 en Escritorio/Astra grabados logo/<carpeta> y lo abre en LightBurn en macOS.
#[tauri::command]
pub fn open_lbrn2_in_lightburn(
    app: tauri::AppHandle,
    folder_name: String,
    filename: String,
    lbrn2_content: String,
) -> Result<OpenLightBurnResponse, String> {
    let clean_folder = folder_name.trim();
    if clean_folder.is_empty()
        || clean_folder.contains('/')
        || clean_folder.contains('\\')
        || clean_folder.contains("..")
    {
        return Err("Nombre de carpeta inválido.".into());
    }
    let clean_file = filename.trim();
    if clean_file.is_empty()
        || clean_file.contains('/')
        || clean_file.contains('\\')
        || !clean_file.to_lowercase().ends_with(".lbrn2")
    {
        return Err("El archivo debe tener extensión .lbrn2.".into());
    }

    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|e| format!("No se encontró el Escritorio: {e}"))?;
    let target_dir = desktop.join("Astra grabados logo").join(clean_folder);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("No se pudo crear la carpeta en el Escritorio: {e}"))?;

    let file_path = target_dir.join(clean_file);
    fs::write(&file_path, lbrn2_content.as_bytes())
        .map_err(|e| format!("No se pudo escribir el archivo .lbrn2: {e}"))?;

    let path_str = file_path.to_string_lossy().into_owned();

    // En macOS intentamos abrir con LightBurn.app o con el manejador predeterminado del sistema
    let launched = Command::new("open")
        .args(["-a", "LightBurn", &path_str])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        || Command::new("open")
            .arg(&path_str)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    let message = if launched {
        format!("Proyecto guardado en {path_str} y enviado a LightBurn.")
    } else {
        format!("Proyecto guardado en {path_str}. Abrilo desde LightBurn.")
    };

    Ok(OpenLightBurnResponse {
        saved_path: path_str,
        launched_lightburn: launched,
        message,
    })
}

/// Verifica conectividad real hacia la Vank 9060:
/// 1) Prueba handshake TCP Packet (`RDC8445S` puerto 50200),
/// 2) Si TCP no está abierto, prueba UDP clásico (`50200↔40200`),
/// 3) Ejecuta ping ICMP diagnóstico sin mover motores ni disparar láser.
#[tauri::command]
pub async fn probe_ruida_connection(ip: String, port: u16) -> Result<RuidaProbeResponse, String> {
    let target_ip = parse_ipv4(&ip)?;
    if port == 0 {
        return Err("El puerto de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let ip_str = target_ip.to_string();

        // 1. Probar TCP Packet (RDC8445S / LightBurn TCP_PK)
        let tcp_res = probe_tcp_handshake_internal(target_ip, port);

        if tcp_res.handshake_ok {
            let local_port_40200_free = UdpSocket::bind("0.0.0.0:40200").is_ok();
            let reply_note = tcp_res
                .reply_hex
                .as_deref()
                .map(|h| format!(" (resp: {h})"))
                .unwrap_or_default();
            return Ok(RuidaProbeResponse {
                reachable: true,
                ping_ok: true,
                udp_handshake_ok: true,
                transport_mode: Some("TCP (RDC8445S)".into()),
                controller_reply_hex: tcp_res.reply_hex,
                latency_ms: tcp_res.latency_ms,
                ip: ip_str.clone(),
                port,
                local_port_40200_free,
                message: format!(
                    "✓ Vank 9060 online ({ip_str}:{port} · TCP RDC8445S) · Handshake Ruida OK en {} ms{reply_note}.",
                    tcp_res.latency_ms.unwrap_or(0)
                ),
            });
        }

        // 2. Fallback UDP clásico (50200↔40200) para controladoras RDC6445G/S
        let (socket, local_port_40200_free) = bind_ruida_socket()?;
        let (udp_handshake_ok, controller_reply_hex, latency_ms, udp_error) = if tcp_res.tcp_connected {
            (false, None, tcp_res.latency_ms, tcp_res.os_error.clone())
        } else {
            probe_udp_handshake_internal(target_ip, port, &socket)
        };
        drop(socket);

        let ping_ok = Command::new("ping")
            .args(["-c", "1", "-W", "900", &ip_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        let reachable = udp_handshake_ok || tcp_res.tcp_connected || ping_ok;
        let transport_mode = if udp_handshake_ok {
            Some("UDP (50200↔40200)".into())
        } else if tcp_res.tcp_connected {
            Some("TCP (50200 abierto)".into())
        } else {
            None
        };

        let port_note = if local_port_40200_free {
            "Puerto UDP local 40200 libre."
        } else {
            "Puerto local 40200 ocupado por LightBurn (cerrá LightBurn para envío directo)."
        };

        let combined_err = tcp_res
            .os_error
            .as_deref()
            .or(udp_error.as_deref())
            .unwrap_or("");
        let macos_perm_hint = is_macos_permission_error(combined_err);

        let message = if udp_handshake_ok {
            format!(
                "✓ Vank 9060 online ({}:{} · UDP 50200↔40200) · Handshake Ruida OK en {} ms. {}",
                ip_str,
                port,
                latency_ms.unwrap_or(0),
                port_note
            )
        } else if macos_perm_hint {
            format!(
                "macOS bloqueó el socket de red local hacia {}:{} (Privacidad → Red local). Habilitá 'Astra Studio' en Ajustes del Sistema → Privacidad y seguridad → Red local.",
                ip_str, port
            )
        } else if tcp_res.tcp_connected {
            format!(
                "Puerto TCP {}:{} abierto (RDC8445S), pero la controladora no devolvió ACK a la consulta Ruida. Si LightBurn está conectado a la máquina, cerralo y volvé a probar.",
                ip_str, port
            )
        } else if ping_ok {
            format!(
                "Red IP alcanzable ({}:{}), pero no respondió por TCP ni UDP en {}. Verificá que 'Astra Studio' tenga permiso en Ajustes → Privacidad → Red local, que la Vank esté encendida y LightBurn cerrado. {}",
                ip_str, port, port, port_note
            )
        } else {
            format!(
                "Sin respuesta desde {}:{}. Verificá alimentación de la Vank 9060 y red Wi-Fi / cable LAN. {}",
                ip_str, port, port_note
            )
        };

        Ok(RuidaProbeResponse {
            reachable,
            ping_ok,
            udp_handshake_ok,
            transport_mode,
            controller_reply_hex,
            latency_ms,
            ip: ip_str,
            port,
            local_port_40200_free,
            message,
        })
    })
    .await
    .map_err(|e| format!("Error interno al probar conexión con Vank 9060: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn validates_ipv4_addresses() {
        assert!(parse_ipv4("192.168.0.195").is_ok());
        assert!(parse_ipv4(" 10.0.0.50 ").is_ok());
        assert!(parse_ipv4("999.999.1.1").is_err());
        assert!(parse_ipv4("no-es-ip").is_err());
    }

    #[test]
    fn probe_packet_has_valid_16bit_checksum_and_only_read_query() {
        let pkt = build_safe_ruida_probe_packet();
        assert_eq!(pkt.len(), 6);
        let expected_sum: u16 = pkt[2..].iter().fold(0u16, |a, &b| a.wrapping_add(b as u16));
        let header_sum = u16::from_be_bytes([pkt[0], pkt[1]]);
        assert_eq!(header_sum, expected_sum);
    }

    #[test]
    fn retries_on_cf_nak_and_succeeds_with_cc_ack_over_loopback() {
        let mock_ctrl = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mock_port = mock_ctrl.local_addr().unwrap().port();
        mock_ctrl
            .set_read_timeout(Some(Duration::from_millis(2000)))
            .unwrap();

        let attempts_seen = Arc::new(AtomicUsize::new(0));
        let attempts_clone = Arc::clone(&attempts_seen);

        let handle = thread::spawn(move || {
            let mut buf = [0u8; 2048];
            // Paquete 1: primer intento -> 0xCF (checksum fail), segundo intento -> 0xCC (ACK OK)
            for req_idx in 0..3 {
                if let Ok((_n, src)) = mock_ctrl.recv_from(&mut buf) {
                    let count = attempts_clone.fetch_add(1, Ordering::SeqCst);
                    let reply = if req_idx == 0 && count == 0 {
                        RUIDA_NAK_CHECKSUM
                    } else {
                        RUIDA_ACK_OK
                    };
                    let _ = mock_ctrl.send_to(&[reply], src);
                }
            }
        });

        let host_sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let packets = vec![
            build_checksum_udp_packet(&[0x11, 0x22, 0x33]),
            build_checksum_udp_packet(&[0x44, 0x55, 0x66]),
        ];

        let mut progress_steps = Vec::new();
        let res = upload_packets_internal(
            Ipv4Addr::LOCALHOST,
            mock_port,
            &packets,
            &host_sock,
            true,
            |p| progress_steps.push(p.percent),
        )
        .unwrap();

        handle.join().unwrap();
        assert!(res.success);
        assert_eq!(res.packets_sent, 2);
        assert_eq!(res.retries, 1);
        assert_eq!(attempts_seen.load(Ordering::SeqCst), 3);
        assert_eq!(progress_steps, vec![50, 100]);
    }

    #[test]
    fn aborts_when_controller_keeps_returning_cf_nak() {
        let mock_ctrl = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mock_port = mock_ctrl.local_addr().unwrap().port();
        mock_ctrl
            .set_read_timeout(Some(Duration::from_millis(1500)))
            .unwrap();

        let handle = thread::spawn(move || {
            let mut buf = [0u8; 512];
            for _ in 0..MAX_RETRIES_PER_PACKET {
                if let Ok((_n, src)) = mock_ctrl.recv_from(&mut buf) {
                    let _ = mock_ctrl.send_to(&[RUIDA_NAK_CHECKSUM], src);
                }
            }
        });

        let host_sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let packets = vec![build_checksum_udp_packet(&[0x11, 0x22, 0x33])];

        let err = upload_packets_internal(
            Ipv4Addr::LOCALHOST,
            mock_port,
            &packets,
            &host_sock,
            true,
            |_| {},
        )
        .err()
        .unwrap();

        handle.join().unwrap();
        assert!(err.contains("NAK 0xCF"));
    }

    #[test]
    fn probe_handshake_succeeds_against_local_mock_ruida_controller() {
        let mock_ctrl = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mock_port = mock_ctrl.local_addr().unwrap().port();
        mock_ctrl
            .set_read_timeout(Some(Duration::from_millis(1000)))
            .unwrap();

        let handle = thread::spawn(move || {
            let mut buf = [0u8; 256];
            if let Ok((n, src)) = mock_ctrl.recv_from(&mut buf) {
                if n >= 6 {
                    let _ = mock_ctrl.send_to(&[RUIDA_ACK_OK, 0xDA, 0x01, 0x05], src);
                }
            }
        });

        let host_sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let (ok, hex, latency, _err) =
            probe_udp_handshake_internal(Ipv4Addr::LOCALHOST, mock_port, &host_sock);
        handle.join().unwrap();
        assert!(ok);
        assert_eq!(hex.as_deref(), Some("CC DA 01 05"));
        assert!(latency.is_some());
    }

    #[test]
    fn tcp_packet_upload_strips_checksum_retries_on_nak_and_tracks_progress() {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mock_port = listener.local_addr().unwrap().port();
        let received_payloads = Arc::new(std::sync::Mutex::new(Vec::<Vec<u8>>::new()));
        let payloads_clone = Arc::clone(&received_payloads);

        let handle = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            conn.set_read_timeout(Some(Duration::from_millis(2000))).unwrap();
            let mut buf = [0u8; 256];
            for req_idx in 0..3 {
                if let Ok(n) = conn.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    payloads_clone.lock().unwrap().push(buf[..n].to_vec());
                    let reply = if req_idx == 0 {
                        RUIDA_NAK_ALT
                    } else {
                        RUIDA_ACK_ALT
                    };
                    let _ = conn.write_all(&[reply]);
                    let _ = conn.flush();
                }
            }
        });

        let mut stream = try_connect_ruida_tcp(Ipv4Addr::LOCALHOST, mock_port, 1500).unwrap();
        let packets = vec![
            build_checksum_udp_packet(&[0x11, 0x22, 0x33]),
            build_checksum_udp_packet(&[0x44, 0x55, 0x66]),
        ];
        let mut progress_steps = Vec::new();

        let res = upload_packets_tcp_internal(
            Ipv4Addr::LOCALHOST,
            mock_port,
            &packets,
            &mut stream,
            |p| progress_steps.push(p.percent),
        )
        .unwrap();

        handle.join().unwrap();
        assert!(res.success);
        assert_eq!(res.transport_mode, "TCP (RDC8445S)");
        assert_eq!(res.packets_sent, 2);
        assert_eq!(res.bytes_sent, 6);
        assert_eq!(res.retries, 1);
        assert_eq!(progress_steps, vec![50, 100]);

        let seen = received_payloads.lock().unwrap();
        assert_eq!(
            *seen,
            vec![
                vec![0x11, 0x22, 0x33],
                vec![0x11, 0x22, 0x33],
                vec![0x44, 0x55, 0x66],
            ]
        );
    }

    #[test]
    fn tcp_probe_handshake_succeeds_against_mock_rdc8445s_controller() {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mock_port = listener.local_addr().unwrap().port();
        let observed_len = Arc::new(AtomicUsize::new(0));
        let len_clone = Arc::clone(&observed_len);

        let handle = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            conn.set_read_timeout(Some(Duration::from_millis(1500))).unwrap();
            let mut buf = [0u8; 64];
            if let Ok(n) = conn.read(&mut buf) {
                len_clone.store(n, Ordering::SeqCst);
                let _ = conn.write_all(&[RUIDA_ACK_ALT, 0xDA, 0x01, 0x05]);
                let _ = conn.flush();
            }
        });

        let outcome = probe_tcp_handshake_internal(Ipv4Addr::LOCALHOST, mock_port);
        handle.join().unwrap();
        assert!(outcome.tcp_connected);
        assert!(outcome.handshake_ok);
        assert_eq!(observed_len.load(Ordering::SeqCst), 4);
        assert_eq!(outcome.reply_hex.as_deref(), Some("C6 DA 01 05"));
        assert!(outcome.latency_ms.is_some());
    }
}
