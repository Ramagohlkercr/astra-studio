import * as THREE from 'three';

export interface ProceduralPbrTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function makeRepeatTex(canvas: HTMLCanvasElement, repeatX: number, repeatY: number, isColor: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Grano celular de cuero vacuno / ecocuero con poros naturales y costuras sutiles (Mates / Planchas Ecocuero).
 */
export function createLeatherPbrTextures(
  baseHex = '#6e3f1d',
  withSeams = true,
  repeat: [number, number] = [3, 2]
): ProceduralPbrTextures {
  const size = 256;
  const cCanvas = document.createElement('canvas');
  const bCanvas = document.createElement('canvas');
  const rCanvas = document.createElement('canvas');
  cCanvas.width = bCanvas.width = rCanvas.width = size;
  cCanvas.height = bCanvas.height = rCanvas.height = size;

  const cCtx = cCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rCtx = rCanvas.getContext('2d');
  if (!cCtx || !bCtx || !rCtx) {
    const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
    const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
    const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
    return { map, bumpMap, roughnessMap, dispose: () => { map.dispose(); bumpMap.dispose(); roughnessMap.dispose(); } };
  }

  const [br, bg, bb] = parseHexRgb(baseHex);
  const cImg = cCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  // Grilla de celdas pseudoaleatorias para grano natural de cuero
  const cells = 18;
  const pts: Array<[number, number]> = [];
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const seed = Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453;
      const fx = seed - Math.floor(seed);
      const seed2 = Math.sin(gx * 269.5 + gy * 183.3) * 43758.5453;
      const fy = seed2 - Math.floor(seed2);
      pts.push([((gx + 0.15 + fx * 0.7) / cells) * size, ((gy + 0.15 + fy * 0.7) / cells) * size]);
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx0 = Math.floor((x / size) * cells);
      const gy0 = Math.floor((y / size) * cells);
      let d1 = 9999;
      let d2 = 9999;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = (gx0 + ox + cells) % cells;
          const cy = (gy0 + oy + cells) % cells;
          const pt = pts[cy * cells + cx];
          let dx = Math.abs(pt[0] - x);
          let dy = Math.abs(pt[1] - y);
          if (dx > size * 0.5) dx = size - dx;
          if (dy > size * 0.5) dy = size - dy;
          const dist = Math.hypot(dx, dy);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }
      const edge = Math.min(1, Math.max(0, (d2 - d1) / 3.2));
      const bump = 85 + edge * 140;
      const shade = 0.78 + edge * 0.28;
      const idx = (y * size + x) * 4;

      cImg.data[idx] = clampByte(br * shade);
      cImg.data[idx + 1] = clampByte(bg * shade);
      cImg.data[idx + 2] = clampByte(bb * shade);
      cImg.data[idx + 3] = 255;

      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = clampByte(bump);
      bImg.data[idx + 3] = 255;

      const rough = clampByte(205 - edge * 45);
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = rough;
      rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  if (withSeams) {
    // Costura tradicional de cuero artesanal (línea de puntos en borde lateral)
    cCtx.strokeStyle = 'rgba(245, 222, 179, 0.55)';
    cCtx.lineWidth = 2;
    cCtx.setLineDash([7, 5]);
    cCtx.beginPath();
    cCtx.moveTo(14, 0);
    cCtx.lineTo(14, size);
    cCtx.stroke();

    bCtx.strokeStyle = '#ffffff';
    bCtx.lineWidth = 2.2;
    bCtx.setLineDash([7, 5]);
    bCtx.beginPath();
    bCtx.moveTo(14, 0);
    bCtx.lineTo(14, size);
    bCtx.stroke();
  }

  const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
  const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
  const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Pintura martillada / powder-coat tipo Stanley Hammertone (Termos y Tumblers térmicos).
 */
export function createHammeredCoatPbrTextures(
  baseHex = '#1e4631',
  repeat: [number, number] = [4, 3]
): ProceduralPbrTextures {
  const size = 256;
  const cCanvas = document.createElement('canvas');
  const bCanvas = document.createElement('canvas');
  const rCanvas = document.createElement('canvas');
  cCanvas.width = bCanvas.width = rCanvas.width = size;
  cCanvas.height = bCanvas.height = rCanvas.height = size;

  const cCtx = cCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rCtx = rCanvas.getContext('2d');
  if (!cCtx || !bCtx || !rCtx) {
    const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
    const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
    const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
    return { map, bumpMap, roughnessMap, dispose: () => { map.dispose(); bumpMap.dispose(); roughnessMap.dispose(); } };
  }

  const [br, bg, bb] = parseHexRgb(baseHex);
  const cImg = cCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Patrón martillado multi-frecuencia suave
      const n1 = Math.sin(x * 0.24) * Math.cos(y * 0.24);
      const n2 = Math.sin((x + y) * 0.37) * Math.cos((x - y) * 0.31);
      const n3 = Math.sin(x * 0.85 + y * 0.62) * 0.35;
      const hammer = Math.max(0, Math.min(1, 0.5 + (n1 + n2 + n3) * 0.24));
      const shade = 0.84 + hammer * 0.3;
      const idx = (y * size + x) * 4;

      cImg.data[idx] = clampByte(br * shade);
      cImg.data[idx + 1] = clampByte(bg * shade);
      cImg.data[idx + 2] = clampByte(bb * shade);
      cImg.data[idx + 3] = 255;

      const bv = clampByte(95 + hammer * 130);
      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bv;
      bImg.data[idx + 3] = 255;

      const rv = clampByte(150 - hammer * 55);
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
  const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
  const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Vetas naturales de madera (Algarrobo / MDF / Cuadros / Mates de madera).
 */
export function createWoodPbrTextures(
  baseHex = '#8f5b32',
  repeat: [number, number] = [2, 2]
): ProceduralPbrTextures {
  const size = 256;
  const cCanvas = document.createElement('canvas');
  const bCanvas = document.createElement('canvas');
  const rCanvas = document.createElement('canvas');
  cCanvas.width = bCanvas.width = rCanvas.width = size;
  cCanvas.height = bCanvas.height = rCanvas.height = size;

  const cCtx = cCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rCtx = rCanvas.getContext('2d');
  if (!cCtx || !bCtx || !rCtx) {
    const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
    const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
    const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
    return { map, bumpMap, roughnessMap, dispose: () => { map.dispose(); bumpMap.dispose(); roughnessMap.dispose(); } };
  }

  const [br, bg, bb] = parseHexRgb(baseHex);
  const cImg = cCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = Math.sin(x * 0.045) * 14 + Math.sin(x * 0.11 + y * 0.02) * 5;
      const ring = Math.sin((y + warp) * 0.28) * 0.5 + 0.5;
      const fine = Math.sin(y * 1.4 + x * 0.1) * 0.12;
      const tone = Math.max(0, Math.min(1, ring * 0.85 + fine));
      const shade = 0.72 + tone * 0.38;
      const idx = (y * size + x) * 4;

      cImg.data[idx] = clampByte(br * shade);
      cImg.data[idx + 1] = clampByte(bg * shade);
      cImg.data[idx + 2] = clampByte(bb * shade);
      cImg.data[idx + 3] = 255;

      const bv = clampByte(100 + tone * 110);
      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bv;
      bImg.data[idx + 3] = 255;

      const rv = clampByte(215 - tone * 45);
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = makeRepeatTex(cCanvas, repeat[0], repeat[1], true);
  const bumpMap = makeRepeatTex(bCanvas, repeat[0], repeat[1], false);
  const roughnessMap = makeRepeatTex(rCanvas, repeat[0], repeat[1], false);
  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Patrón cincelado/repujado de alpaca para virolas de Mates argentinos.
 */
export function createChiseledVirolaBumpTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return makeRepeatTex(canvas, 6, 1, false);
  ctx.fillStyle = '#909090';
  ctx.fillRect(0, 0, size, 64);

  // Motivo geométrico repujado repetido alrededor de la virola
  for (let x = 0; x < size; x += 16) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, 8);
    ctx.lineTo(x + 14, 32);
    ctx.lineTo(x + 8, 56);
    ctx.lineTo(x + 2, 32);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = '#303030';
    ctx.beginPath();
    ctx.arc(x + 8, 32, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = makeRepeatTex(canvas, 6, 1, false);
  return tex;
}
