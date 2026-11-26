---
name: vank9060-ruida-cam
description: >-
  Verified engineering rules and hardware geometry for the Vank 9060 CO2 laser
  cutter (Ruida RDC8445S controller at 192.168.0.195:50200) and Sanou 3-jaw
  rotary chuck in Astra Studio.
---

# Vank 9060 & Ruida RDC8445S CAM Skill

Use this skill when modifying rotary kinematics, Ruida `.RD` binary compilation, `.lbrn2` generation, or network UDP transmission.

## Verified Hardware & Network Defaults
- **Machine Bed**: `900 x 600 mm` CO₂ gantry, default IP `192.168.0.195`, Ruida UDP destination port `50200` (local reply socket `:40200` managed in `src-tauri/src/ruida_transport.rs`).
- **Rotary Chuck (Sanou K11 3-Jaw)**: Coupled to machine `Y` axis (`RotaryMode`, `stepsPerRotation` calibrated physically per accessory profile).

## Mandatory Safety & Geometry Invariants
1. **Never invent laser cutting/engraving parameters**: `speedMmPerSec` and `maxPowerPercent` are `null` by default until explicitly entered by the operator or loaded from an operator-saved recipe/material library. Block `.RD` compilation if either is `null`.
2. **Trigonometric Z-Focus Leveling for Cones**:
   - Given `d0` (X=0), `d1` (X=L), axial length `L`: `alpha = atan2(|d0 - d1| / 2, L)`.
   - Exact vertical lift under the smaller end to keep the top generatrix horizontal: `tailstockLiftMm = L * sin(alpha)` (never `2 * radiusDiff`).
   - Load `referenceDiameterMm = (d0 + d1) / 2` in LightBurn Rotary Setup while Astra pre-warps Y coordinates (`warpPointForTaper`) so vertical proportions stay undistorted along tapered walls.
3. **Never touch live hardware from automated tests or scripts**: UDP packets must only be sent when explicitly triggered by the operator inside the Tauri app UI.
