import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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
  renderer.toneMappingExposure = 1.22;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  return renderer;
}

/**
 * Crea un Environment PBR de estudio offline con RoomEnvironment para reflejos metálicos reales
 * (mandril Sanou, acero inoxidable, pórtico de aluminio Vank 9060).
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
    grad.addColorStop(0, 'rgba(255, 255, 220, 1)');
    grad.addColorStop(0.22, 'rgba(254, 202, 202, 0.92)');
    grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.45)');
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
      const m = mat as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      m.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}

/**
 * Rasteriza un SVG 1:1 mm del módulo Rotativo en un CanvasTexture transparente rotado para UV cilíndrica:
 * Eje SVG X (largo axial) -> UV +V (-X a +X del cilindro)
 * Eje SVG Y (circunferencia 0..arcDeg) -> UV +U (generatriz superior hacia cara frontal)
 */
export function buildRotaryWrappedCanvasTexture(
  svgRaw: string | null,
  svgWidthMm: number,
  svgHeightMm: number,
  onLoaded?: () => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  if (!svgRaw || typeof Image === 'undefined') {
    return texture;
  }

  let cancelled = false;
  const img = new Image();
  img.onload = () => {
    if (cancelled || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const srcW = Math.max(1, img.naturalWidth || svgWidthMm * 8 || 512);
    const srcH = Math.max(1, img.naturalHeight || svgHeightMm * 8 || 512);

    ctx.save();
    ctx.setTransform(0, -h / srcW, w / srcH, 0, 0, h);
    ctx.drawImage(img, 0, 0, srcW, srcH);
    ctx.restore();

    texture.needsUpdate = true;
    onLoaded?.();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgRaw)}`;

  const origDispose = texture.dispose.bind(texture);
  texture.dispose = () => {
    cancelled = true;
    origDispose();
  };

  return texture;
}
