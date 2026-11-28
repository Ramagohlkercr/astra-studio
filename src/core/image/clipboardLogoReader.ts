/**
 * Astra Studio — Lector Universal de Portapapeles para Logos y Archivos Láser
 * Permite pegar logos copiados directamente con Cmd+V / Ctrl+V o con el botón "Pegar Logo":
 *   - Imágenes raster (PNG, JPG, WebP, BMP, capturas de pantalla, copiar imagen desde navegador/WhatsApp)
 *   - Vectores SVG (<svg> copiado como SVG/texto desde Illustrator, CorelDraw o Figma)
 *   - Fallback nativo macOS (Tauri) para portapapeles TIFF o archivos copiados en Finder (Cmd+C)
 */

import { invoke, isTauri } from '@tauri-apps/api/core';

interface NativeClipboardLogoPayload {
  found: boolean;
  mime: string;
  file_name: string;
  bytes: number[];
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function buildClipboardFilename(mime: string, rawName?: string): string {
  if (rawName && rawName.trim() && rawName.trim().toLowerCase() !== 'image.png') {
    return rawName.trim();
  }
  const stamp = new Date()
    .toTimeString()
    .slice(0, 8)
    .replace(/:/g, '');
  if (mime.includes('svg')) return `Logo_Pegado_${stamp}.svg`;
  if (mime.includes('jpeg') || mime.includes('jpg')) return `Logo_Pegado_${stamp}.jpg`;
  if (mime.includes('webp')) return `Logo_Pegado_${stamp}.webp`;
  return `Logo_Pegado_${stamp}.png`;
}

function looksLikeSvgMarkup(text: string): boolean {
  const t = text.trim();
  return /^<(?:svg|\?xml|!DOCTYPE\s+svg)/i.test(t) && /<svg\b/i.test(t);
}

/**
 * Extrae archivos de logo o trazado desde un evento `paste` (`e.clipboardData`).
 * Seguro para cualquier navegador y macOS WKWebView sin pedir permisos extra.
 */
export function extractLogoFilesFromClipboardData(
  clipboardData: DataTransfer | null | undefined
): File[] {
  if (!clipboardData) return [];
  const results: File[] = [];
  const seenKeys = new Set<string>();

  const pushUniqueFile = (file: File) => {
    const key = `${file.type}:${file.size}:${file.name}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(file);
  };

  // 1. Archivos explícitos en clipboardData.files (capturas, imágenes, archivos SVG/DXF/PNG)
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (const f of Array.from(clipboardData.files)) {
      const lower = f.name.toLowerCase();
      const isSupportedExt =
        /\.(png|jpg|jpeg|webp|bmp|gif|svg|dxf|lbrn2|lbrn|ai|rd)$/i.test(lower);
      if (f.type.startsWith('image/') || isSupportedExt) {
        const cleanFile =
          f.name && f.name !== 'image.png'
            ? f
            : new File([f], buildClipboardFilename(f.type || 'image/png', f.name), {
                type: f.type || 'image/png',
              });
        pushUniqueFile(cleanFile);
      }
    }
  }

  // 2. Ítems del portapapeles (image/* o SVG en text/plain / image/svg+xml)
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (const item of Array.from(clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blobFile = item.getAsFile();
        if (blobFile) {
          pushUniqueFile(
            new File(
              [blobFile],
              buildClipboardFilename(blobFile.type || item.type, blobFile.name),
              { type: blobFile.type || item.type }
            )
          );
        }
      }
    }

    if (results.length === 0) {
      const svgOrPlain = clipboardData.getData('image/svg+xml') || clipboardData.getData('text/plain');
      if (svgOrPlain && looksLikeSvgMarkup(svgOrPlain)) {
        pushUniqueFile(
          new File([svgOrPlain], buildClipboardFilename('image/svg+xml'), {
            type: 'image/svg+xml',
          })
        );
      }
    }
  }

  return results;
}

/**
 * Lee un logo directamente desde el portapapeles del sistema al hacer clic en "Pegar Logo":
 * 1) Intenta Clipboard Web API (`navigator.clipboard.read` / `readText`).
 * 2) Si está en app nativa Tauri macOS o el portapapeles tiene TIFF/archivo de Finder, recurre a `read_clipboard_logo`.
 */
export async function readLogoFilesFromClipboard(): Promise<File[]> {
  const out: File[] = [];

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    if (typeof navigator.clipboard.read === 'function') {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const svgType = item.types.find((t) => t === 'image/svg+xml');
          if (svgType) {
            const blob = await item.getType(svgType);
            const text = await blob.text();
            if (looksLikeSvgMarkup(text)) {
              out.push(
                new File([text], buildClipboardFilename('image/svg+xml'), {
                  type: 'image/svg+xml',
                })
              );
              continue;
            }
          }

          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            out.push(
              new File([blob], buildClipboardFilename(imgType), { type: imgType })
            );
            continue;
          }

          if (item.types.includes('text/plain')) {
            const txt = await (await item.getType('text/plain')).text();
            if (looksLikeSvgMarkup(txt)) {
              out.push(
                new File([txt], buildClipboardFilename('image/svg+xml'), {
                  type: 'image/svg+xml',
                })
              );
            }
          }
        }
      } catch {
        // Permiso/soporte restringido en WebView; continuar al fallback
      }
    }

    if (out.length === 0 && typeof navigator.clipboard.readText === 'function') {
      try {
        const txt = await navigator.clipboard.readText();
        if (txt && looksLikeSvgMarkup(txt)) {
          out.push(
            new File([txt], buildClipboardFilename('image/svg+xml'), {
              type: 'image/svg+xml',
            })
          );
        }
      } catch {
        // Continuar a Tauri nativo
      }
    }
  }

  if (out.length === 0 && isTauri()) {
    try {
      const nativeRes = await invoke<NativeClipboardLogoPayload>('read_clipboard_logo');
      if (nativeRes.found && nativeRes.bytes.length > 0) {
        const u8 = new Uint8Array(nativeRes.bytes);
        out.push(
          new File([u8], buildClipboardFilename(nativeRes.mime, nativeRes.file_name), {
            type: nativeRes.mime || 'image/png',
          })
        );
      }
    } catch {
      // Silenciar si no había nada legible
    }
  }

  return out;
}
