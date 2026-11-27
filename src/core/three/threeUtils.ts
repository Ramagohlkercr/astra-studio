import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { compileLabelGeometry, rasterImageTransform } from '../geometry/geometryEngine';
import { LabelDesign } from '../types';

let cachedWebGLSupport: boolean | null = null;

/**
 * Comprueba de forma segura si el entorno soporta WebGL (evita errores en jsdom / headless).
 */
export function canUseWebGL(): boolean {
  if (cachedWebGLSupport !== null) return cachedWebGLSupport;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedWebGLSupport = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('experimental-webgl');
    cachedWebGLSupport = !!gl;
  } catch {
    cachedWebGLSupport = false;
  }
  return cachedWebGLSupport;
}

/**
 * Crea un WebGLRenderer configurado para visualización CAD/CAM nítida en macOS Retina y Vite.
 */
export function createStudioRenderer(
  container: HTMLElement,
  width: number,
  height: number
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(1, width), Math.max(1, height));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  return renderer;
}

export interface StudioPostComposer {
  render: () => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
}

/**
 * Envuelve EffectComposer (postprocessing) con RenderPass + Bloom sutil en el haz láser/metales + ACES Filmic.
 * Cae limpiamente a renderer.render si el contexto WebGL no soporta algún pass avanzado.
 */
export function createStudioComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): StudioPostComposer {
  try {
    renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(renderer, {
      multisampling: Math.min(4, renderer.capabilities.maxSamples || 0),
    });
    const renderPass = new RenderPass(scene, camera);
    const bloom = new BloomEffect({
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      intensity: 0.38,
    });
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });
    const effectPass = new EffectPass(camera, bloom, toneMapping);
    composer.addPass(renderPass);
    composer.addPass(effectPass);

    return {
      render: () => composer.render(),
      setSize: (w: number, h: number) => composer.setSize(w, h),
      dispose: () => composer.dispose(),
    };
  } catch {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return {
      render: () => renderer.render(scene, camera),
      setSize: (w: number, h: number) => renderer.setSize(w, h),
      dispose: () => {},
    };
  }
}

/**
 * Crea un Environment PBR de estudio offline con RoomEnvironment para reflejos metálicos reales.
 */
export function createStudioEnvironment(
  renderer: THREE.WebGLRenderer
): { envMap: THREE.Texture; dispose: () => void } {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment();
  const renderTarget = pmrem.fromScene(roomEnv, 0.04);
  roomEnv.dispose();
  pmrem.dispose();
  return {
    envMap: renderTarget.texture,
    dispose: () => {
      renderTarget.dispose();
    },
  };
}

/**
 * Textura de resplandor radial para el punto de impacto del haz láser CO2.
 */
export function createLaserGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 255, 225, 1)');
    grad.addColorStop(0.22, 'rgba(254, 202, 202, 0.94)');
    grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.48)');
    grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Textura sutil de acero/aluminio cepillado para rugosidad PBR en cilindros y piezas torneadas.
 */
export function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) {
      const shade = 120 + ((y * 37) % 48);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

/**
 * Textura procedural de cama alveolar / cuchillas oscuras para la mesa 900x600 mm.
 */
export function createHoneycombBedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0b111b';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    const step = 16;
    for (let y = 0; y < 128; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 128; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 128);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 12);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Libera recursivamente geometrías, materiales y texturas de un árbol Object3D para evitar fugas de memoria GPU.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial & {
        map?: THREE.Texture | null;
        bumpMap?: THREE.Texture | null;
      };
      m.map?.dispose();
      m.bumpMap?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      m.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}

function hexToRgbTuple(hex: string): [number, number, number] {
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

/**
 * Transforma un canvas con arte láser en blanco/negro o RGBA (PNG raster, SVG o texto)
 * en dos mapas PBR sincronizados:
 * 1) `colorCanvas`: el grabado real con color físico de ablación / quemado sobre el material
 * 2) `bumpCanvas`: mapa de bajorrelieve para simular la profundidad física del surco láser
 */
function synthesizeLaserMapsFromCanvas(
  colorCtx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  markHex: string,
  finishKind: 'ablated_metal' | 'char_burn' | 'frosted_glass' | 'anodized_dark' = 'char_burn'
): void {
  const [mr, mg, mb] = hexToRgbTuple(markHex);
  const src = colorCtx.getImageData(0, 0, width, height);
  const bump = bumpCtx.createImageData(width, height);
  const d = src.data;
  const b = bump.data;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 16) {
      d[i + 3] = 0;
      b[i] = 160;
      b[i + 1] = 160;
      b[i + 2] = 160;
      b[i + 3] = 255;
      continue;
    }

    // Intensidad de tinta oscura (0 = blanco fondo, 1 = negro sólido grabado)
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const strength = Math.max(0, Math.min(1, (1 - lum) * (a / 255)));

    if (strength < 0.08) {
      d[i + 3] = 0;
      b[i] = 160;
      b[i + 1] = 160;
      b[i + 2] = 160;
      b[i + 3] = 255;
    } else {
      const pxIdx = i >> 2;
      const px = pxIdx % width;
      const py = (pxIdx / width) | 0;
      const microNoise =
        finishKind === 'frosted_glass'
          ? 0.8 + 0.2 * Math.abs(Math.sin(px * 12.9898 + py * 78.233) * 43758.5453 % 1)
          : 1;

      if (finishKind === 'char_burn' && strength < 0.55) {
        // Borde térmico tostado cálido alrededor del pirograbado en cuero/madera
        d[i] = Math.round(mr + (120 - mr) * 0.38);
        d[i + 1] = Math.round(mg + (66 - mg) * 0.35);
        d[i + 2] = Math.round(mb + (24 - mb) * 0.28);
      } else {
        d[i] = mr;
        d[i + 1] = mg;
        d[i + 2] = mb;
      }

      const alphaBoost = finishKind === 'frosted_glass' ? 235 * microNoise : 285;
      d[i + 3] = Math.round(Math.min(255, strength * alphaBoost));

      const depthScale = finishKind === 'char_burn' ? 148 : finishKind === 'ablated_metal' ? 125 : 105;
      const depthVal = Math.round(160 - strength * depthScale);
      b[i] = depthVal;
      b[i + 1] = depthVal;
      b[i + 2] = depthVal;
      b[i + 3] = 255;
    }
  }

  colorCtx.putImageData(src, 0, 0);
  bumpCtx.putImageData(bump, 0, 0);
}

export interface Engraved3DTextures {
  colorTexture: THREE.CanvasTexture;
  bumpTexture: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Rasteriza el SVG 1:1 mm del módulo Rotativo (incluidos logos PNG raster y vectores)
 * a texturas PBR sincronizadas de Color + Bajorrelieve Físico (`bumpMap`) sobre UV cilíndrica:
 * Eje SVG X (largo axial) -> UV +V (-X a +X del cilindro)
 * Eje SVG Y (circunferencia 0..arcDeg) -> UV +U (generatriz superior -> frente -> base)
 */
export function buildRotaryEngravedTextures(
  svgRaw: string | null,
  svgWidthMm: number,
  svgHeightMm: number,
  markHex: string,
  onLoaded?: () => void,
  finishKind: 'ablated_metal' | 'char_burn' | 'frosted_glass' | 'anodized_dark' = 'char_burn'
): Engraved3DTextures {
  const size = 2048;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d', { willReadFrequently: true });

  if (colorCtx && bumpCtx) {
    colorCtx.clearRect(0, 0, size, size);
    bumpCtx.fillStyle = 'rgb(160,160,160)';
    bumpCtx.fillRect(0, 0, size, size);
  }

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.anisotropy = 16;

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.anisotropy = 16;

  let cancelled = false;
  if (svgRaw && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      if (cancelled || !colorCtx || !bumpCtx) return;
      colorCtx.clearRect(0, 0, size, size);
      colorCtx.imageSmoothingEnabled = true;
      colorCtx.imageSmoothingQuality = 'high';

      const srcW = Math.max(1, img.naturalWidth || svgWidthMm * 8 || 512);
      const srcH = Math.max(1, img.naturalHeight || svgHeightMm * 8 || 512);

      // Rotación -90° con determinante positivo (+v = X axial, +u = Y circunferencia)
      colorCtx.save();
      colorCtx.setTransform(0, -size / srcW, size / srcH, 0, 0, size);
      colorCtx.drawImage(img, 0, 0, srcW, srcH);
      colorCtx.restore();

      synthesizeLaserMapsFromCanvas(colorCtx, bumpCtx, size, size, markHex, finishKind);
      colorTexture.needsUpdate = true;
      bumpTexture.needsUpdate = true;
      onLoaded?.();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgRaw)}`;
  }

  return {
    colorTexture,
    bumpTexture,
    dispose: () => {
      cancelled = true;
      colorTexture.dispose();
      bumpTexture.dispose();
    },
  };
}

function xmlAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compila la geometría real de grabado C00 de una etiqueta plana (SVG vector, texto o PNG raster)
 * en texturas PBR de color quemado + bajorrelieve físico para visualizar tal cual queda sobre la plancha 3D.
 */
export function buildFlatLabelEngravedTextures(
  design: LabelDesign,
  markHex: string,
  onLoaded?: () => void
): Engraved3DTextures {
  const w = Math.max(1, design.widthMm);
  const h = Math.max(1, design.heightMm);
  const compiled = compileLabelGeometry(design);

  const svgNodes: string[] = [];
  for (const eng of compiled.engravingItems) {
    if (eng.kind === 'vector_path' && eng.svgPathD) {
      if (eng.filled) {
        svgNodes.push(
          `<path d="${eng.svgPathD}" fill="#000000" fill-rule="${eng.fillRule || 'evenodd'}" stroke="#000000" stroke-width="0.06" />`
        );
      } else {
        svgNodes.push(
          `<path d="${eng.svgPathD}" fill="none" stroke="#000000" stroke-width="${eng.strokeWidthMm || 0.3}" stroke-linecap="round" stroke-linejoin="round" />`
        );
      }
    } else if (eng.kind === 'raster_image' && eng.dataUrl) {
      const rt = rasterImageTransform(eng);
      const rot = rt ? ` transform="${rt}"` : '';
      svgNodes.push(
        `<image x="${eng.xMm}" y="${eng.yMm}" width="${eng.widthMm}" height="${eng.heightMm}" preserveAspectRatio="none" href="${xmlAttr(eng.dataUrl)}"${rot} />`
      );
    }
  }

  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 10}" height="${h * 10}" viewBox="0 0 ${w} ${h}">${svgNodes.join('')}</svg>`;

  const pxSize = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = pxSize;
  colorCanvas.height = pxSize;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = pxSize;
  bumpCanvas.height = pxSize;
  const bumpCtx = bumpCanvas.getContext('2d', { willReadFrequently: true });

  if (colorCtx && bumpCtx) {
    colorCtx.clearRect(0, 0, pxSize, pxSize);
    bumpCtx.fillStyle = 'rgb(160,160,160)';
    bumpCtx.fillRect(0, 0, pxSize, pxSize);
  }

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.anisotropy = 8;

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.anisotropy = 8;

  let cancelled = false;
  if (svgNodes.length > 0 && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      if (cancelled || !colorCtx || !bumpCtx) return;
      colorCtx.clearRect(0, 0, pxSize, pxSize);
      colorCtx.drawImage(img, 0, 0, pxSize, pxSize);
      synthesizeLaserMapsFromCanvas(colorCtx, bumpCtx, pxSize, pxSize, markHex);
      colorTexture.needsUpdate = true;
      bumpTexture.needsUpdate = true;
      onLoaded?.();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelSvg)}`;
  }

  return {
    colorTexture,
    bumpTexture,
    dispose: () => {
      cancelled = true;
      colorTexture.dispose();
      bumpTexture.dispose();
    },
  };
}
