/**
 * Astra Studio — Monitor de Estado Vank 9060, Cronómetro en Vivo y Alerta Sonora/Visual de Fin de Pedido
 */

export type MachineWatchPhase = 'idle' | 'armed' | 'running' | 'paused' | 'finished';

export interface MachineJobTimerState {
  phase: MachineWatchPhase;
  source: 'hardware' | 'manual';
  jobName: string;
  totalPieces: number;
  estimatedTotalSec: number;
  armedAtMs: number | null;
  startedAtMs: number | null;
  pauseStartedAtMs: number | null;
  pausedAccumMs: number;
  finishedAtMs: number | null;
  popupMinimized: boolean;
  soundEnabled: boolean;
  autoAlertOnManualZero: boolean;
}

export interface LiveJobTimerSnapshot {
  elapsedSec: number;
  remainingSec: number;
  overtimeSec: number;
  progressPercent: number;
  estimatedFinishAtMs: number | null;
}

export function createInitialJobTimerState(): MachineJobTimerState {
  return {
    phase: 'idle',
    source: 'hardware',
    jobName: 'Pedido Vank 9060',
    totalPieces: 0,
    estimatedTotalSec: 0,
    armedAtMs: null,
    startedAtMs: null,
    pauseStartedAtMs: null,
    pausedAccumMs: 0,
    finishedAtMs: null,
    popupMinimized: false,
    soundEnabled: true,
    autoAlertOnManualZero: true,
  };
}

export function armJobTimerWatch(
  prev: MachineJobTimerState,
  params: { jobName: string; totalPieces: number; estimatedTotalSec: number },
  nowMs = Date.now()
): MachineJobTimerState {
  return {
    ...prev,
    phase: 'armed',
    source: 'hardware',
    jobName: params.jobName,
    totalPieces: params.totalPieces,
    estimatedTotalSec: Math.max(1, Math.round(params.estimatedTotalSec)),
    armedAtMs: nowMs,
    startedAtMs: null,
    pauseStartedAtMs: null,
    pausedAccumMs: 0,
    finishedAtMs: null,
    popupMinimized: false,
  };
}

export function startJobTimerExecution(
  prev: MachineJobTimerState,
  params: {
    source: 'hardware' | 'manual';
    jobName?: string;
    totalPieces?: number;
    estimatedTotalSec?: number;
  },
  nowMs = Date.now()
): MachineJobTimerState {
  return {
    ...prev,
    phase: 'running',
    source: params.source,
    jobName: params.jobName ?? prev.jobName,
    totalPieces: params.totalPieces ?? prev.totalPieces,
    estimatedTotalSec: Math.max(
      1,
      Math.round(params.estimatedTotalSec ?? (prev.estimatedTotalSec || 60))
    ),
    startedAtMs: nowMs,
    pauseStartedAtMs: null,
    pausedAccumMs: 0,
    finishedAtMs: null,
    popupMinimized: false,
  };
}

export function pauseJobTimerExecution(
  prev: MachineJobTimerState,
  nowMs = Date.now()
): MachineJobTimerState {
  if (prev.phase !== 'running') return prev;
  return {
    ...prev,
    phase: 'paused',
    pauseStartedAtMs: nowMs,
  };
}

export function resumeJobTimerExecution(
  prev: MachineJobTimerState,
  nowMs = Date.now()
): MachineJobTimerState {
  if (prev.phase !== 'paused') return prev;
  const pauseDelta = prev.pauseStartedAtMs !== null ? Math.max(0, nowMs - prev.pauseStartedAtMs) : 0;
  return {
    ...prev,
    phase: 'running',
    pauseStartedAtMs: null,
    pausedAccumMs: prev.pausedAccumMs + pauseDelta,
  };
}

export function finishJobTimerExecution(
  prev: MachineJobTimerState,
  nowMs = Date.now()
): MachineJobTimerState {
  if (prev.phase === 'finished') return prev;
  const extraPause =
    prev.phase === 'paused' && prev.pauseStartedAtMs !== null
      ? Math.max(0, nowMs - prev.pauseStartedAtMs)
      : 0;
  return {
    ...prev,
    phase: 'finished',
    pauseStartedAtMs: null,
    pausedAccumMs: prev.pausedAccumMs + extraPause,
    finishedAtMs: nowMs,
    popupMinimized: false,
  };
}

export function computeLiveTimerSnapshot(
  state: MachineJobTimerState,
  nowMs = Date.now()
): LiveJobTimerSnapshot {
  if (state.startedAtMs === null) {
    return {
      elapsedSec: 0,
      remainingSec: state.estimatedTotalSec,
      overtimeSec: 0,
      progressPercent: 0,
      estimatedFinishAtMs: null,
    };
  }

  const refEndMs =
    state.phase === 'finished' && state.finishedAtMs !== null
      ? state.finishedAtMs
      : state.phase === 'paused' && state.pauseStartedAtMs !== null
        ? state.pauseStartedAtMs
        : nowMs;

  const activeMs = Math.max(0, refEndMs - state.startedAtMs - state.pausedAccumMs);
  const elapsedSec = Math.floor(activeMs / 1000);
  const totalSec = Math.max(1, state.estimatedTotalSec);
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const overtimeSec = Math.max(0, elapsedSec - totalSec);
  const progressPercent =
    state.phase === 'finished' ? 100 : Math.min(99, Math.round((elapsedSec / totalSec) * 100));
  const estimatedFinishAtMs =
    state.phase === 'running' ? nowMs + remainingSec * 1000 : null;

  return {
    elapsedSec,
    remainingSec,
    overtimeSec,
    progressPercent,
    estimatedFinishAtMs,
  };
}

/** Formatea segundos en reloj cronómetro limpio (`MM:SS` o `HH:MM:SS`). */
export function formatDurationTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/** Reproduce una alerta sonora clara de taller (acorde ascendente limpio vía Web Audio API). */
export function playWorkshopCompletionAlertChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const notesHz = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const startTimes = [0, 0.14, 0.28, 0.42, 0.68, 0.84];
    const durations = [0.18, 0.18, 0.18, 0.3, 0.16, 0.45];

    notesHz.forEach((freq, idx) => {
      const t0 = ctx.currentTime + startTimes[idx];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.24, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durations[idx]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durations[idx] + 0.03);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1800);
  } catch {
    // Silencio seguro en entornos sin dispositivo de audio
  }
}

/** Solicita permiso y dispara notificación nativa de sistema cuando termina la Vank 9060. */
export function requestAndNotifyWorkshopCompletion(
  jobName: string,
  elapsedText: string,
  totalPieces: number
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    const fire = () => {
      new window.Notification('Vank 9060 — Pedido Terminado', {
        body: `${jobName} (${totalPieces} u.) finalizó en ${elapsedText}.`,
      });
    };
    if (window.Notification.permission === 'granted') {
      fire();
    } else if (window.Notification.permission === 'default') {
      void window.Notification.requestPermission().then((perm) => {
        if (perm === 'granted') fire();
      });
    }
  } catch {
    // Ignorar en entornos sin soporte de notificaciones
  }
}
