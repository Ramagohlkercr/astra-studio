export interface LogoOutputFile { name: string; content: string }
export function logoNameError(name: string): string | null {
  if (!name.trim()) return 'Escribí el nombre del logo o archivo.';
  if (new TextEncoder().encode(name.trim()).length > 80) return 'El nombre es demasiado largo. Usá uno más corto.';
  if (/^[.]|[.]$|[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name.trim())) return 'No uses barras, puntos al inicio o al final ni caracteres especiales de archivo.';
  return null;
}
// Browser fallback: one ZIP preserves the same folder tree without filesystem permissions.
export function logoFolderZip(name: string, files: LogoOutputFile[]): Uint8Array {
  const encoder = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const crc32 = (bytes: Uint8Array) => { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; };
  for (const file of files) {
    const path=encoder.encode(`ASTRA LOGOS/${name}/${name}_${file.name}`), data=encoder.encode(file.content), crc=crc32(data);
    const local=new Uint8Array(30+path.length), v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);local.set(path,30);
    const entry=new Uint8Array(46+path.length), c=new DataView(entry.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);entry.set(path,46);
    parts.push(local,data);central.push(entry);offset+=local.length+data.length;
  }
  const centralSize=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+22);let cursor=0;for(const part of [...parts,...central,end]){result.set(part,cursor);cursor+=part.length;}return result;
}
