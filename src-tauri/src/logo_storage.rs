use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Deserialize)]
pub struct LogoFile { name: String, content: String }
#[derive(Serialize)]
pub struct SavedLogoFiles { folder: String, files: Vec<String> }

fn valid_component(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && value == value.trim()
        && !value.starts_with('.') && !value.ends_with('.')
        && !value.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
}
fn ensure_directory(path: &Path) -> Result<(), String> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if info.is_dir() && !info.file_type().is_symlink() { Ok(()) }
            else { Err("La carpeta de destino no es una carpeta segura.".into()) }
        }
        Err(e) => Err(format!("No se pudo crear la carpeta: {e}")),
    }
}
fn save_at(documents: &Path, logo_name: &str, files: Vec<LogoFile>) -> Result<SavedLogoFiles, String> {
    if !valid_component(logo_name, 80) { return Err("Usá un nombre de hasta 80 bytes, sin barras ni caracteres especiales de archivo.".into()); }
    if files.is_empty() || files.len() > 20 { return Err("Cantidad de archivos no válida.".into()); }
    let mut names = std::collections::HashSet::new();
    for file in &files {
        if !names.insert(file.name.to_lowercase()) { return Err("Los nombres de archivo deben ser distintos.".into()); }
        if !valid_component(&file.name, 120) || ![".svg", ".dxf", ".txt", ".json"].iter().any(|ext| file.name.to_lowercase().ends_with(ext)) {
            return Err("Nombre o formato de archivo no válido.".into());
        }
    }
    let root = documents.join("ASTRA LOGOS"); ensure_directory(&root)?;
    let folder = root.join(logo_name); ensure_directory(&folder)?;
    // Reserve every filename with create_new; concurrent saves cannot overwrite each other.
    for version in 1..10000 {
        let suffix = if version == 1 { String::new() } else { format!("_{version}") };
        let mut reserved: Vec<(PathBuf, std::fs::File)> = Vec::new();
        let mut collision = false;
        for file in &files {
            let (stem, ext) = file.name.rsplit_once('.').ok_or("Formato no válido")?;
            let path = folder.join(format!("{logo_name}_{stem}{suffix}.{ext}"));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(handle) => reserved.push((path, handle)),
                Err(e) => {
                    for (path, _) in &reserved { let _ = fs::remove_file(path); }
                    if e.kind() == std::io::ErrorKind::AlreadyExists { collision = true; break; }
                    return Err(format!("No se pudo guardar: {e}"));
                }
            }
        }
        if collision { continue; }
        for (index, (_, handle)) in reserved.iter_mut().enumerate() {
            if let Err(e) = handle.write_all(files[index].content.as_bytes()).and_then(|_| handle.sync_all()) {
                for (path, _) in &reserved { let _ = fs::remove_file(path); }
                return Err(format!("No se completó el guardado: {e}"));
            }
        }
        return Ok(SavedLogoFiles { folder: folder.to_string_lossy().into_owned(), files: reserved.iter().map(|(p, _)| p.to_string_lossy().into_owned()).collect() });
    }
    Err("Demasiadas versiones para ese nombre.".into())
}

#[tauri::command]
pub fn save_logo_files(app: tauri::AppHandle, logo_name: String, files: Vec<LogoFile>) -> Result<SavedLogoFiles, String> {
    let documents = app.path().document_dir().map_err(|e| format!("No se encontró Documentos: {e}"))?;
    save_at(&documents, &logo_name, files)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pair() -> Vec<LogoFile> { vec![LogoFile{name:"Grabado.svg".into(),content:"engrave".into()},LogoFile{name:"Corte.svg".into(),content:"cut".into()}] }
    #[test]
    fn saves_pair_and_preserves_previous_versions() {
        let temp = std::env::temp_dir().join(format!("astra-storage-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&temp).unwrap();
        let first=save_at(&temp,"Clara Tejidos",pair()).unwrap();
        let second=save_at(&temp,"Clara Tejidos",pair()).unwrap();
        assert_eq!(first.files.len(),2); assert_eq!(first.folder,second.folder);
        assert_ne!(first.files,second.files);
        assert_eq!(fs::read_to_string(&first.files[0]).unwrap(),"engrave");
        assert_eq!(fs::read_to_string(&second.files[1]).unwrap(),"cut");
        assert!(save_at(&temp,"../escape",pair()).is_err());
        assert!(!temp.join("escape").exists());
        fs::remove_dir_all(temp).unwrap();
    }
    #[test]
    fn rejects_unsafe_names() {
        for name in ["", "..", "../x", "a/b", "a\\b", ".hidden", " a", "a:", "a\n"] { assert!(!valid_component(name,80)); }
        assert!(valid_component("Colibrí de Clara",80));
    }
}
