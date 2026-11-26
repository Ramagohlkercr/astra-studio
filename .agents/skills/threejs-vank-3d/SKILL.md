---
name: threejs-vank-3d
description: >-
  Architectural standards and best practices for Three.js WebGL 3D CAD/CAM
  visualization in Astra Studio (Vank 9060 900x600mm gantry & Sanou rotary
  chuck simulators in React 18, Vite, and Tauri macOS WKWebView).
---

# Three.js CAD/CAM 3D Visualization Skill — Astra Studio

Use this skill whenever extending, refactoring, or debugging 3D viewports in Astra Studio (`Rotary3DViewport.tsx`, `Workbench3DViewport.tsx`, `src/core/three/threeUtils.ts`).

## Core Coordinate System (`1 world unit = 1 mm`)
- Keep geometry strictly in **real millimeters** so physical dimensions (`Ø 90 -> 65 mm`, `900 x 600 mm` bed) map 1:1 without hidden arbitrary scale multipliers.
- **Rotary Axis Convention**:
  - Cylinder/Cone axial direction runs along world `+X` (`left = X=0` at chuck jaws, `right = X=L` at tailstock).
  - Laser head fires downward (`-Y` world axis) onto the top generatrix at constant Z focus (`Y_world = yFocus`).
  - For tapered cones, rotate the spindle group around `+Z` by `alphaRad = atan2(|r0 - r1|, len)` (positive if `dEnd < dStart` so the narrower right end tilts up and the top surface wall remains flat at `Y_world = yFocus`).
- **Flat Bed Convention (Vank 9060)**:
  - Bed spans `X: [0..900] mm` (width), `Z: [0..600] mm` (front-to-back depth), centered around origin `(x - 450, 0, z - 300)` for natural `OrbitControls` rotation.

## React 18 + Tauri WKWebView Lifecycle Rules
1. **Never throw in headless/jsdom environments**: Always guard WebGL initialization via `canUseWebGL()` from `src/core/three/threeUtils.ts`. Return a clean declarative fallback in tests or environments without WebGL.
2. **Strict GPU Disposal**: On cleanup (`useEffect` teardown) or when rebuilding meshes/textures, always call `disposeObject3D(group)`, `controls.dispose()`, and `renderer.dispose()` to avoid WebKit GPU context loss during rapid preset/slider changes.
3. **Lightweight Live Updates**: Update spindle rotation (`rotaryGroup.rotation.x`) and laser head position in lightweight `useEffect` / `requestAnimationFrame` loops without recreating `WebGLRenderer`, lights, or heavy geometries when only angles or progress change.
4. **High-DPI CanvasTexture for SVG Unwrapped Artwork**:
   - Rasterize 1:1 mm SVG (`exportRotarySvg`) onto an offscreen canvas with `image.src = data:image/svg+xml;charset=utf-8,...` and map it onto a thin concentric cylinder shell (`r + 0.15 mm`) aligned with `thetaStart` and `thetaLength = (arcDeg * Math.PI) / 180` so the top seam `Y = 0°` stays accurate as the chuck spins.
