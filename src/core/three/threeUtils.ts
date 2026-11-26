import * as THREE from 'three';

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
  renderer.toneMappingExposure = 1.15;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  return renderer;
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
      const m = mat as THREE.MeshStandardMaterial;
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
    // Guías sutiles de costura superior Y=0 y borde inferior del arco
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
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

    // Rotación -90° con determinante positivo (+v = X axial, +u = Y circunferencia)
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
