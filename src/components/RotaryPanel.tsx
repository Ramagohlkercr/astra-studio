import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeRotaryLayout,
  correctedRotarySteps,
  RotaryConfig,
  RotaryType,
} from '../core/rotary/rotaryEngine';
import {
  RotaryAccessoryProfile,
  RotaryDirection,
  loadRotaryAccessoryProfiles,
  saveRotaryAccessoryProfile,
  deleteRotaryAccessoryProfile,
  computeLinearCalibratedSteps,
  loadRotaryCalibrationHistory,
  addRotaryCalibrationRecord,
  RotaryCalibrationRecord,
} from '../core/rotary/rotaryProfiles';
import {
  exportRotarySvg,
  exportRotaryGuideSvg,
  exportRotaryDxf,
  exportRotaryTestPatternSvg,
} from '../core/exporters/rotaryExporter';
import { LogoOutputFile } from '../core/exporters/logoFolder';
import { LabelDesign } from '../core/types';

interface Props {
  design: LabelDesign;
  config: RotaryConfig;
  onConfigChange: (config: RotaryConfig) => void;
  onSave: (files: LogoOutputFile[]) => void;
  onClose: () => void;
}

/** Medidas orientativas: medí siempre el objeto real antes de producir. */
export const ROTARY_PRESETS: { id: string; label: string; patch: Partial<RotaryConfig> }[] = [
  { id: 'vaso', label: 'Vaso recto Ø 75', patch: { objectDiameterMm: 75, endDiameterMm: undefined, usefulLengthMm: 90 } },
  { id: 'botella', label: 'Botella de vino Ø 75', patch: { objectDiameterMm: 75, endDiameterMm: undefined, usefulLengthMm: 140 } },
  { id: 'lata', label: 'Lata 330 ml Ø 66', patch: { objectDiameterMm: 66, endDiameterMm: undefined, usefulLengthMm: 90 } },
  { id: 'termo', label: 'Termo Ø 73', patch: { objectDiameterMm: 73, endDiameterMm: undefined, usefulLengthMm: 150 } },
  { id: 'tumbler', label: 'Tumbler cónico Ø 90 → 65', patch: { objectDiameterMm: 90, endDiameterMm: 65, usefulLengthMm: 120 } },
];

export function RotaryPanel({ design, config, onConfigChange, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const setConfig = (update: (c: RotaryConfig) => RotaryConfig) => onConfigChange(update(config));

  // Perfiles de hardware persistentes
  const [profiles, setProfiles] = useState<RotaryAccessoryProfile[]>(() => loadRotaryAccessoryProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    () => config.accessoryProfileId || profiles[0]?.id || 'vank-roller-standard'
  );
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [isAddingProfile, setIsAddingProfile] = useState<boolean>(false);

  // Asistente de calibración
  const [calibMethod, setCalibMethod] = useState<'angular' | 'linear'>('angular');
  const [measuredDegrees, setMeasuredDegrees] = useState<number>(360);
  const [expectedLinearMm, setExpectedLinearMm] = useState<number>(50);
  const [measuredLinearMm, setMeasuredLinearMm] = useState<number>(50);
  const [calibHistory, setCalibHistory] = useState<RotaryCalibrationRecord[]>(() => loadRotaryCalibrationHistory());

  const angularCorrection = correctedRotarySteps(config.stepsPerRotation ?? 0, measuredDegrees);
  const linearCorrection = computeLinearCalibratedSteps(config.stepsPerRotation ?? 0, expectedLinearMm, measuredLinearMm);

  const [withDxf, setWithDxf] = useState(false);
  const [withGuides, setWithGuides] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  // Verificar si hay elementos de grabado visibles
  const hasVisibleEngraving = useMemo(() => {
    return Array.isArray(design.elements) && design.elements.some((el) => el.visible);
  }, [design.elements]);

  const layout = useMemo(() => computeRotaryLayout(config, design), [config, design]);

  const previewResult = useMemo(() => {
    if (!layout.valid || !hasVisibleEngraving) return { url: null, error: null };
    try {
      return {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exportRotarySvg(design, config).svgContent)}`,
        error: null,
      };
    } catch (e) {
      return { url: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [layout.valid, hasVisibleEngraving, design, config]);

  const preview = previewResult.url;
  const rasterOnly = design.elements.some(
    (el) => el.visible && el.type === 'logo_raster' && (el.processing.mode !== 'vector' || !el.vectorizedPathsNormalized.length)
  );
  useEffect(() => {
    if (rasterOnly) setWithDxf(false);
  }, [rasterOnly]);

  const num = (key: 'objectDiameterMm' | 'usefulLengthMm' | 'arcDeg' | 'repeatCount' | 'axisOffsetMm' | 'angularOffsetDeg') =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setConfig((c) => ({ ...c, [key]: e.target.value === '' ? NaN : Number(e.target.value) }));
  const val = (v: number | undefined, fallback: number | string = '') => (v === undefined || Number.isNaN(v) ? fallback : v);

  // Seleccionar perfil de accesorio
  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) {
      setConfig((c) => ({
        ...c,
        accessoryProfileId: p.id,
        rotaryType: p.type,
        rollerDiameterMm: p.rollerDiameterMm ?? c.rollerDiameterMm,
        stepsPerRotation: p.stepsPerRotation,
        rotationDirection: p.rotationDirection,
      }));
    }
  };

  // Guardar perfil nuevo o actualizado
  const handleSaveProfile = () => {
    if (!newProfileName.trim()) return;
    const newProf: RotaryAccessoryProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      type: config.rotaryType,
      rollerDiameterMm: config.rotaryType === 'roller' ? (config.rollerDiameterMm ?? 50.0) : undefined,
      stepsPerRotation: config.stepsPerRotation ?? 3200,
      rotationDirection: config.rotationDirection || 'normal',
      isBuiltIn: false,
    };
    const updated = saveRotaryAccessoryProfile(newProf);
    setProfiles(updated);
    setSelectedProfileId(newProf.id);
    setConfig((c) => ({ ...c, accessoryProfileId: newProf.id }));
    setNewProfileName('');
    setIsAddingProfile(false);
  };

  // Eliminar perfil personalizado
  const handleDeleteProfile = (id: string) => {
    const updated = deleteRotaryAccessoryProfile(id);
    setProfiles(updated);
    if (selectedProfileId === id) {
      handleSelectProfile(updated[0]?.id || 'vank-roller-standard');
    }
  };

  // Aplicar calibración angular
  const handleApplyAngularCalib = () => {
    if (angularCorrection === null) return;
    const oldSteps = config.stepsPerRotation ?? 3200;
    setConfig((c) => ({ ...c, stepsPerRotation: angularCorrection }));
    const record = addRotaryCalibrationRecord({
      accessoryId: config.accessoryProfileId,
      accessoryName: profiles.find((p) => p.id === config.accessoryProfileId)?.name,
      method: 'angular_360',
      initialSteps: oldSteps,
      expectedValue: 360,
      measuredValue: measuredDegrees,
      computedSteps: angularCorrection,
      operatorNotes: `Prueba 360°: medidos ${measuredDegrees}°`,
    });
    setCalibHistory((h) => [record, ...h]);
    setMeasuredDegrees(360);
  };

  // Aplicar calibración lineal con calibre
  const handleApplyLinearCalib = () => {
    if (linearCorrection === null) return;
    const oldSteps = config.stepsPerRotation ?? 3200;
    setConfig((c) => ({ ...c, stepsPerRotation: linearCorrection }));
    const record = addRotaryCalibrationRecord({
      accessoryId: config.accessoryProfileId,
      accessoryName: profiles.find((p) => p.id === config.accessoryProfileId)?.name,
      method: 'linear_caliper',
      initialSteps: oldSteps,
      expectedValue: expectedLinearMm,
      measuredValue: measuredLinearMm,
      computedSteps: linearCorrection,
      operatorNotes: `Calibre: esperado ${expectedLinearMm} mm vs medido ${measuredLinearMm} mm`,
    });
    setCalibHistory((h) => [record, ...h]);
    setMeasuredLinearMm(expectedLinearMm);
  };

  // Guardar archivo del diseño
  const save = () => {
    if (!hasVisibleEngraving) {
      setSaveError('El diseño no contiene elementos de grabado visibles para exportar.');
      return;
    }
    const files: LogoOutputFile[] = [];
    try {
      const art = exportRotarySvg(design, config);
      files.push({ name: art.svgFilename, content: art.svgContent }, { name: art.instructionsFilename, content: art.instructionsText });
      if (withDxf) {
        const d = exportRotaryDxf(design, config);
        files.push({ name: d.filename, content: d.dxfContent });
      }
      if (withGuides) {
        const g = exportRotaryGuideSvg(design, config);
        files.push({ name: g.filename, content: g.svgContent });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaveError(null);
    onSave(files);
  };

  // Guardar patrón de prueba
  const handleSaveTestPattern = () => {
    try {
      const pat = exportRotaryTestPatternSvg(config, 50);
      onSave([
        { name: pat.filename, content: pat.svgContent },
        { name: pat.instructionsFilename, content: pat.instructionsText },
      ]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const field = 'w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white';
  const maxW = 440,
    maxH = 220;
  const scale = layout.valid ? Math.min(maxW / layout.canvasWidthMm, maxH / layout.canvasHeightMm) : 1;

  const activeProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <dialog ref={dialog} className="studio-orders-dialog" aria-labelledby="rotary-title" onCancel={onClose}>
      <div className="p-6 space-y-4 max-w-2xl max-h-[85vh] overflow-y-auto bg-[#11161f] text-slate-200 border border-slate-800 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 id="rotary-title" className="font-bold text-white text-base flex items-center gap-2">
              <span>Accesorio Rotativo — Vank 9060 CO₂</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Desenrolla el diseño de grabado sobre objetos cilíndricos o cónicos con control de escala 1:1 mm.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded text-[11px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
            Ruida RDC8445S
          </span>
        </div>

        {/* 1. SELECCIÓN DE PERFIL DE ACCESORIO */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Perfil de Accesorio Rotativo (Hardware):</span>
            <button
              type="button"
              onClick={() => setIsAddingProfile((v) => !v)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              {isAddingProfile ? 'Cancelar nuevo' : '+ Guardar nuevo accesorio'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              aria-label="Perfil de accesorio"
              className={field}
              value={selectedProfileId}
              onChange={(e) => handleSelectProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type === 'roller' ? 'Rodillos' : 'Mandril'})
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between text-xs text-slate-400 px-2 py-1 bg-slate-950 rounded border border-slate-800">
              <span>Tipo: <strong className="text-white">{config.rotaryType === 'roller' ? 'Rodillos' : 'Mandril'}</strong></span>
              <span>Giro: <strong className="text-white">{config.rotationDirection === 'inverted' ? 'Invertido' : 'Normal (+Y)'}</strong></span>
              {!activeProfile?.isBuiltIn && activeProfile && (
                <button
                  type="button"
                  onClick={() => handleDeleteProfile(activeProfile.id)}
                  className="text-red-400 hover:text-red-300 ml-2"
                  title="Eliminar perfil personalizado"
                >
                  Borrar
                </button>
              )}
            </div>
          </div>

          {/* Formulario para guardar nuevo perfil */}
          {isAddingProfile && (
            <div className="p-3 bg-slate-950 rounded border border-cyan-500/40 space-y-2 mt-2">
              <span className="text-xs font-semibold text-cyan-300 block">Guardar configuración actual como nuevo accesorio:</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nombre del accesorio (ej. Mandril K11 80mm)"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 px-2.5 py-1 rounded text-xs text-white"
                />
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded transition-colors"
                >
                  Guardar Perfil
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2. GEOMETRÍA DEL OBJETO */}
        <div className="space-y-2.5">
          <label className="block text-xs font-semibold text-slate-300">
            <span>Plantillas de objetos de taller (medidas orientativas):</span>
            <select
              aria-label="Preset de objeto"
              className={`${field} mt-1`}
              value=""
              onChange={(e) => {
                const p = ROTARY_PRESETS.find((x) => x.id === e.target.value);
                if (p) setConfig((c) => ({ ...c, ...p.patch }));
              }}
            >
              <option value="">Elegir objeto de referencia…</option>
              {ROTARY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400">Tipo de sujeción:</span>
              <select
                className={field}
                value={config.rotaryType}
                onChange={(e) => setConfig((c) => ({ ...c, rotaryType: e.target.value as RotaryType }))}
              >
                <option value="roller">Rodillos (Roller)</option>
                <option value="chuck">Mandril (Chuck)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Largo útil axial (mm):</span>
              <input
                className={field}
                type="number"
                min={1}
                max={900}
                step="0.5"
                value={val(config.usefulLengthMm)}
                onChange={num('usefulLengthMm')}
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Diámetro inicial X=0 (mm):</span>
              <input
                className={field}
                type="number"
                min={5}
                max={300}
                step="0.1"
                value={val(config.objectDiameterMm)}
                onChange={num('objectDiameterMm')}
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Diámetro final X=largo (mm):</span>
              <input
                className={field}
                type="number"
                min={5}
                max={300}
                step="0.1"
                placeholder="Igual al inicial = recto"
                value={val(config.endDiameterMm)}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    endDiameterMm: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Arco a grabar (°):</span>
              <input
                className={field}
                type="number"
                min={1}
                max={360}
                step="1"
                value={val(config.arcDeg)}
                onChange={num('arcDeg')}
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Copias alrededor (1..36):</span>
              <input
                className={field}
                type="number"
                min={1}
                max={36}
                step="1"
                value={val(config.repeatCount, 1)}
                onChange={num('repeatCount')}
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Desplazamiento axial X (mm):</span>
              <input
                className={field}
                type="number"
                step="0.5"
                value={val(config.axisOffsetMm, 0)}
                onChange={num('axisOffsetMm')}
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400">Giro del diseño Y (°):</span>
              <input
                className={field}
                type="number"
                step="1"
                value={val(config.angularOffsetDeg, 0)}
                onChange={num('angularOffsetDeg')}
              />
            </label>
          </div>
        </div>

        {/* 3. ASISTENTE DE CALIBRACIÓN Y SENTIDO DE GIRO */}
        <details className="border border-slate-800 bg-slate-900/50 rounded-lg p-3 space-y-3">
          <summary className="cursor-pointer text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center justify-between">
            <span>Asistente de Calibración, Pasos por Vuelta y Sentido de Giro</span>
            <span className="text-[10px] text-slate-400">Pasos actuales: {config.stepsPerRotation ?? 'Sin definir'}</span>
          </summary>

          <div className="space-y-3 pt-2 text-xs">
            {/* Parámetros del hardware actual */}
            <div className="grid grid-cols-2 gap-3">
              {config.rotaryType === 'roller' && (
                <label className="space-y-1">
                  <span className="text-slate-400">Diámetro del rodillo motriz (mm):</span>
                  <input
                    aria-label="Diámetro del rodillo motriz (mm)"
                    className={field}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={val(config.rollerDiameterMm)}
                    placeholder="Medir con calibre"
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        rollerDiameterMm: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                  />
                </label>
              )}

              <label className="space-y-1">
                <span className="text-slate-400">Pasos por vuelta (steps/rotation):</span>
                <input
                  aria-label="Pasos por vuelta"
                  className={field}
                  type="number"
                  min="0.001"
                  step="1"
                  value={val(config.stepsPerRotation)}
                  placeholder="Valor del driver o calibrado"
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      stepsPerRotation: e.target.value === '' ? undefined : Number(e.target.value),
                    }))
                  }
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-400">Sentido de avance del eje Y:</span>
                <select
                  aria-label="Sentido de giro"
                  className={field}
                  value={config.rotationDirection || 'normal'}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      rotationDirection: e.target.value as RotaryDirection,
                    }))
                  }
                >
                  <option value="normal">Normal (+Y avance horario)</option>
                  <option value="inverted">Invertido (dirección invertida)</option>
                </select>
              </label>
            </div>

            {/* Pestañas de método de calibración */}
            <div className="border-t border-slate-800 pt-2 space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCalibMethod('angular')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold ${
                    calibMethod === 'angular'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Método 1: Prueba de Giro 360° (Test)
                </button>
                <button
                  type="button"
                  onClick={() => setCalibMethod('linear')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold ${
                    calibMethod === 'linear'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Método 2: Calibración con Calibre
                </button>
              </div>

              {calibMethod === 'angular' ? (
                <div className="space-y-2 bg-slate-950 p-2.5 rounded border border-slate-800">
                  <p className="text-[11px] text-slate-400">
                    Ejecute el botón <em>Test</em> de LightBurn o comande una vuelta de 360° en la Ruida. Si no regresó exactamente
                    al punto inicial, ingrese los grados reales observados:
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="flex-1">
                      <span className="text-[11px] text-slate-400 block mb-0.5">Giro real observado (°):</span>
                      <input
                        aria-label="Giro medido en Test (grados)"
                        className={field}
                        type="number"
                        min="1"
                        max="720"
                        step="0.5"
                        value={Number.isFinite(measuredDegrees) ? measuredDegrees : ''}
                        onChange={(e) => setMeasuredDegrees(e.target.valueAsNumber)}
                      />
                    </label>
                    <div className="pt-4">
                      <button
                        type="button"
                        disabled={angularCorrection === null}
                        onClick={handleApplyAngularCalib}
                        className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded disabled:opacity-40 text-xs transition-colors"
                      >
                        Aplicar {angularCorrection ? `${angularCorrection} pasos` : ''}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 bg-slate-950 p-2.5 rounded border border-slate-800">
                  <p className="text-[11px] text-slate-400">
                    Grabe el patrón de prueba sobre cinta. Mida con calibre digital el cuadrado de prueba en el eje Y (giro):
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="text-[11px] text-slate-400 block mb-0.5">Cota esperada (mm):</span>
                      <input
                        className={field}
                        type="number"
                        min="5"
                        max="300"
                        step="0.5"
                        value={expectedLinearMm}
                        onChange={(e) => setExpectedLinearMm(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <span className="text-[11px] text-slate-400 block mb-0.5">Cota medida con calibre (mm):</span>
                      <input
                        className={field}
                        type="number"
                        min="1"
                        max="300"
                        step="0.05"
                        value={measuredLinearMm}
                        onChange={(e) => setMeasuredLinearMm(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-[11px] text-cyan-300">
                      Pasos corregidos propuestos: <strong>{linearCorrection ?? '—'}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={linearCorrection === null}
                      onClick={handleApplyLinearCalib}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded disabled:opacity-40 text-xs transition-colors"
                    >
                      Aplicar en accesorio
                    </button>
                  </div>
                </div>
              )}

              {/* Botón para generar patrón de calibración */}
              <div className="pt-2 flex justify-between items-center">
                <span className="text-[11px] text-slate-400">¿Necesita un archivo de prueba con cotas conocidas?</span>
                <button
                  type="button"
                  onClick={handleSaveTestPattern}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-xs font-semibold"
                >
                  Generar Patrón SVG de Calibración
                </button>
              </div>

              {/* Historial de calibraciones */}
              {calibHistory.length > 0 && (
                <div className="pt-2 border-t border-slate-800 text-[11px]">
                  <span className="text-slate-400 block mb-1 font-semibold">Últimas calibraciones registradas:</span>
                  <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-400">
                    {calibHistory.slice(0, 4).map((r) => (
                      <div key={r.id} className="flex justify-between bg-slate-950/60 px-2 py-1 rounded">
                        <span>{r.method === 'angular_360' ? 'Prueba 360°' : 'Calibre lineal'}</span>
                        <span>{r.operatorNotes}</span>
                        <span className="text-cyan-400 font-bold">{r.computedSteps} pasos</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </details>

        {/* 4. INFORMACIÓN TÉCNICA DEL LIENZO */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
          {layout.tapered && (
            <p className="text-amber-300">
              Objeto cónico: diámetro de referencia del dibujo <b>{layout.referenceDiameterMm} mm</b>.{' '}
              {config.rotaryType === 'chuck'
                ? 'Usá esa referencia para el mandril y verificá una muestra.'
                : 'En LightBurn, el diámetro que calibra la escala es el del rodillo motriz.'}
            </p>
          )}
          <p>
            Circunferencia calculada: <b>{layout.circumferenceMm} mm</b> · Lienzo desenrollado:{' '}
            <b>
              {layout.canvasWidthMm} × {layout.canvasHeightMm} mm
            </b>
          </p>
          <p>
            Diseño: {design.widthMm} × {design.heightMm} mm ({layout.designArcDeg}° de la vuelta)
            {layout.repeatCount > 1 ? ` × ${layout.repeatCount} copias` : ''}
          </p>
        </div>

        {/* 5. VISTA PREVIA DEL DESENROLLADO */}
        {preview && (
          <div
            className="mx-auto border border-dashed border-slate-600 bg-white"
            style={{ width: layout.canvasWidthMm * scale, height: layout.canvasHeightMm * scale }}
          >
            <img
              alt="Vista previa del objeto desenrollado"
              src={preview}
              width={layout.canvasWidthMm * scale}
              height={layout.canvasHeightMm * scale}
            />
          </div>
        )}
        {preview && (
          <p className="text-[11px] text-slate-400 text-center">
            Borde superior = costura (Y = 0). Izquierda = extremo X = 0.
          </p>
        )}

        {/* ERRORES Y ADVERTENCIAS */}
        {!hasVisibleEngraving && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 p-2 rounded font-semibold">
            El diseño no contiene elementos de grabado visibles para exportar. Agregue texto o un logo antes de generar los archivos.
          </p>
        )}
        {previewResult.error && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 p-2 rounded">
            {previewResult.error}
          </p>
        )}
        {layout.errors.map((m) => (
          <p key={m} role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 p-2 rounded">
            {m}
          </p>
        ))}
        {saveError && (
          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 p-2 rounded">
            {saveError}
          </p>
        )}
        {layout.warnings.map((m) => (
          <p key={m} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 p-2 rounded">
            {m}
          </p>
        ))}

        {/* OPCIONES DE FORMATO ADICIONALES */}
        <div className="space-y-1.5 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={rasterOnly}
              checked={withDxf}
              onChange={(e) => setWithDxf(e.target.checked)}
            />
            <span>Incluir DXF para RDWorks (sólo vectorial)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={withGuides}
              onChange={(e) => setWithGuides(e.target.checked)}
            />
            <span>Incluir SVG de guías de alineación (capa T1 de encuadre en material de descarte)</span>
          </label>
        </div>

        <p className="text-[11px] text-slate-400">
          * Este módulo genera únicamente capas de grabado. Potencia y velocidad se asignan en LightBurn o RDWorks.
        </p>

        {/* BOTONES DE ACCIÓN */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
          <button type="button" className="studio-secondary-action px-3 py-1.5 text-xs" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            disabled={!layout.valid || !hasVisibleEngraving || !!previewResult.error}
            className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-4 py-2 rounded text-xs disabled:opacity-40 transition-colors"
            onClick={save}
          >
            Guardar archivos de producción
          </button>
        </div>
      </div>
    </dialog>
  );
}
