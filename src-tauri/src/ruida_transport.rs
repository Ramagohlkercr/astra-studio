use std::{
    fs,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket},
    process::Command,
    time::Duration,
};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct RuidaUploadResponse {
    pub success: bool,
    pub packets_sent: usize,
    pub bytes_sent: usize,
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

/// Envía paquetes UDP Ruida pre-compilados y con checksum a la controladora Ruida RDC8445S (puerto 50200).
/// Espera confirmación ACK (0xC6 o su byte ofuscado 0x4E) por cada paquete con timeout de 2.5 segundos.
#[tauri::command]
pub fn upload_rd_to_ruida(
    ip: String,
    port: u16,
    packets: Vec<Vec<u8>>,
) -> Result<RuidaUploadResponse, String> {
    let target_ip = parse_ipv4(&ip)?;
    if port == 0 {
        return Err("El puerto UDP de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }
    if packets.is_empty() {
        return Err("No hay paquetes Ruida para enviar.".into());
    }

    let remote_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));

    // Intentar enlazar al puerto local 40200 (estándar Ruida PC) o puerto efímero si está ocupado por LightBurn
    let socket = UdpSocket::bind("0.0.0.0:40200")
        .or_else(|_| UdpSocket::bind("0.0.0.0:0"))
        .map_err(|e| format!("No se pudo abrir el socket UDP local: {e}"))?;

    socket
        .set_read_timeout(Some(Duration::from_millis(2500)))
        .map_err(|e| format!("Error al configurar timeout de lectura UDP: {e}"))?;
    socket
        .set_write_timeout(Some(Duration::from_millis(2500)))
        .map_err(|e| format!("Error al configurar timeout de escritura UDP: {e}"))?;

    let mut packets_sent = 0usize;
    let mut bytes_sent = 0usize;
    let mut ack_buf = [0u8; 16];

    for (idx, pkt) in packets.iter().enumerate() {
        if pkt.len() < 3 {
            return Err(format!("Paquete #{} demasiado corto.", idx + 1));
        }

        socket.send_to(pkt, remote_addr).map_err(|e| {
            format!(
                "Error de red al enviar paquete #{} a {}: {e}",
                idx + 1,
                remote_addr
            )
        })?;

        match socket.recv_from(&mut ack_buf) {
            Ok((n, _src)) if n > 0 => {
                let ack = ack_buf[0];
                // 0xC6 = ACK directo Ruida; 0x46 = NAK/Error de checksum
                if ack == 0x46 {
                    return Err(format!(
                        "La controladora Ruida rechazó el paquete #{} (NAK 0x46: error de checksum o memoria llena).",
                        idx + 1
                    ));
                }
            }
            Ok(_) => {
                return Err(format!(
                    "Respuesta vacía de la controladora Ruida en paquete #{}.",
                    idx + 1
                ));
            }
            Err(e) => {
                return Err(format!(
                    "Sin respuesta de la Vank 9060 en {} (paquete #{}): {}. Verificá que la máquina esté encendida, conectada a la misma red y con la IP configurada.",
                    remote_addr,
                    idx + 1,
                    e
                ));
            }
        }

        packets_sent += 1;
        bytes_sent += pkt.len();
    }

    Ok(RuidaUploadResponse {
        success: true,
        packets_sent,
        bytes_sent,
        remote_endpoint: remote_addr.to_string(),
        message: format!(
            "Trabajo cargado en memoria de la Vank 9060 ({} paquetes, {} bytes enviados a {}). Verificá el encuadre (Frame) en el panel de la máquina.",
            packets_sent, bytes_sent, remote_addr
        ),
    })
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

/// Verifica conectividad de red hacia la IP de la Vank 9060 (192.168.0.195) y disponibilidad del socket UDP local 40200,
/// sin enviar ningún paquete de movimiento ni comando láser a la controladora Ruida.
#[tauri::command]
pub fn probe_ruida_connection(ip: String, port: u16) -> Result<RuidaProbeResponse, String> {
    let target_ip = parse_ipv4(&ip)?;
    if port == 0 {
        return Err("El puerto UDP de la Ruida debe ser mayor a 0 (estándar: 50200).".into());
    }

    let local_port_40200_free = UdpSocket::bind("0.0.0.0:40200").is_ok();

    let ip_str = target_ip.to_string();
    let ping_ok = Command::new("ping")
        .args(["-c", "1", "-W", "1000", &ip_str])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let port_note = if local_port_40200_free {
        "Puerto UDP local 40200 libre para envío directo."
    } else {
        "El puerto local 40200 está siendo usado por LightBurn (podés enviar directo con 'Abrir en LightBurn (.lbrn2)' o cerrar LightBurn para envío directo UDP)."
    };

    let message = if ping_ok {
        format!(
            "✓ Vank 9060 detectada en red ({}:{}). {}",
            ip_str, port, port_note
        )
    } else {
        format!(
            "No hubo respuesta de ping desde {}:{}. Verificá que la Vank 9060 esté encendida y conectada a la misma red Wi-Fi / LAN. {}",
            ip_str, port, port_note
        )
    };

    Ok(RuidaProbeResponse {
        reachable: ping_ok,
        ip: ip_str,
        port,
        local_port_40200_free,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ipv4_addresses() {
        assert!(parse_ipv4("192.168.1.100").is_ok());
        assert!(parse_ipv4("10.0.0.50").is_ok());
        assert!(parse_ipv4("999.999.1.1").is_err());
        assert!(parse_ipv4("no-es-ip").is_err());
    }
}
