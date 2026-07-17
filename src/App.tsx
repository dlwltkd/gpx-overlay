import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  parseGpx,
  smoothSpeeds,
  speedAt,
  demoTrack,
  MS_TO_KMH,
  MS_TO_MPH,
  type Track,
} from './lib/gpx';
import { usePlayback } from './hooks/usePlayback';
import { SpeedGauge } from './components/SpeedGauge';
import { Timeline } from './components/Timeline';
import {
  EditorPanel,
  type OverlaySettings,
  type ExportFormat,
  type ExportState,
} from './components/EditorPanel';
import {
  exportPngSequence,
  exportWebm,
  renderSnapshot,
  downloadBlob,
} from './lib/export';
import './App.css';

function niceCeil(v: number): number {
  const steps = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 100) * 100;
}

export default function App() {
  const [track, setTrack] = useState<Track>(() => demoTrack());
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<OverlaySettings>({
    style: 'bar',
    unit: 'kmh',
    maxMode: 'auto',
    maxValue: 60,
    accent: '#FFB020',
    label: 'Speed',
    segments: 32,
    showPeak: true,
    showGlow: true,
    smoothingSec: 3,
    boostPct: 0,
    scale: 0.62,
  });

  const { time, playing, setPlaying, seek } = usePlayback(track.duration);

  // m/s -> display units, including the speed boost so the whole gauge
  // (readout, peak, auto scale) exaggerates consistently
  const toUnit =
    (settings.unit === 'kmh' ? MS_TO_KMH : MS_TO_MPH) * (1 + settings.boostPct / 100);
  const smoothed = useMemo(
    () => smoothSpeeds(track, settings.smoothingSec),
    [track, settings.smoothingSec],
  );

  const autoMax = useMemo(
    () => niceCeil(Math.max(...smoothed) * toUnit),
    [smoothed, toUnit],
  );

  const maxValue = settings.maxMode === 'auto' ? autoMax : settings.maxValue;

  // running peak up to the playhead
  const peakSoFar = useMemo(() => {
    let peak = 0;
    for (let i = 0; i < track.points.length && track.points[i].t <= time; i++) {
      if (smoothed[i] > peak) peak = smoothed[i];
    }
    return peak * toUnit;
  }, [track, smoothed, time, toUnit]);

  const value = speedAt(track, smoothed, time) * toUnit;

  // prefix max of smoothed speeds, for peak lookups at arbitrary export times
  const prefixMax = useMemo(() => {
    const out = new Array<number>(smoothed.length);
    let m = 0;
    for (let i = 0; i < smoothed.length; i++) {
      if (smoothed[i] > m) m = smoothed[i];
      out[i] = m;
    }
    return out;
  }, [smoothed]);

  const frameAt = useCallback(
    (t: number) => {
      const pts = track.points;
      let lo = 0;
      let hi = pts.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].t <= t) lo = mid;
        else hi = mid;
      }
      return {
        value: speedAt(track, smoothed, t) * toUnit,
        peak: prefixMax[pts[lo + 1] && pts[lo + 1].t <= t ? lo + 1 : lo] * toUnit,
      };
    },
    [track, smoothed, prefixMax, toUnit],
  );

  const [exportState, setExportState] = useState<ExportState>({
    running: false,
    progress: 0,
    fps: 30,
    width: 1200,
  });

  const onExport = useCallback(
    async (format: ExportFormat) => {
      const gauge = { ...settings, maxValue };
      const stem = track.name.replace(/[^\w-]+/g, '_').toLowerCase() || 'overlay';
      if (format === 'snapshot') {
        const blob = await renderSnapshot(gauge, frameAt(time), exportState.width);
        downloadBlob(blob, `${stem}_frame.png`);
        return;
      }
      setPlaying(false);
      setExportState((s) => ({ ...s, running: true, progress: 0 }));
      const onProgress = (f: number) =>
        setExportState((s) => ({ ...s, progress: f }));
      try {
        const opts = { fps: exportState.fps, width: exportState.width };
        if (format === 'png-seq') {
          const blob = await exportPngSequence(gauge, frameAt, track.duration, opts, onProgress);
          downloadBlob(blob, `${stem}_${exportState.fps}fps.zip`);
        } else {
          const blob = await exportWebm(gauge, frameAt, track.duration, opts, onProgress);
          downloadBlob(blob, `${stem}_${exportState.fps}fps.webm`);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Export failed.');
      } finally {
        setExportState((s) => ({ ...s, running: false }));
      }
    },
    [settings, maxValue, track, frameAt, time, exportState.fps, exportState.width, setPlaying],
  );

  const onFile = useCallback(async (file: File) => {
    try {
      const parsed = parseGpx(await file.text());
      setTrack(parsed);
      setError(null);
      seek(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }, [seek]);

  const patch = useCallback(
    (p: Partial<OverlaySettings>) => setSettings((s) => ({ ...s, ...p })),
    [],
  );

  // measure the preview stage so the gauge scales with it
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(960);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60).toString().padStart(2, '0');
  const durM = Math.floor(track.duration / 60);
  const durS = Math.floor(track.duration % 60).toString().padStart(2, '0');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Ribbon
          <span className="brand-sub">GPX overlay studio</span>
        </div>
        <div className="track-name">{track.name}</div>
      </header>

      <main className="workspace">
        <div className="preview-col">
          <div className="stage" ref={stageRef}>
            <div className="stage-safe" aria-hidden="true" />
            <div className="stage-gauge">
              <SpeedGauge
                settings={{ ...settings, maxValue }}
                frame={{ value, peak: peakSoFar }}
                displayWidth={stageW * settings.scale * (settings.style === 'dial' ? 0.42 : 1)}
              />
            </div>
          </div>

          <div className="transport">
            <button
              className="play-btn"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <Timeline track={track} smoothed={smoothed} time={time} onSeek={seek} />
            <div className="timecode">
              {mins}:{secs} <span>/ {durM}:{durS}</span>
            </div>
          </div>

          {error && <div className="error" role="alert">{error}</div>}
        </div>

        <EditorPanel
          settings={{ ...settings, maxValue }}
          onChange={patch}
          onFile={onFile}
          trackName={track.name}
          autoMax={autoMax}
          exportState={exportState}
          onExportChange={(p) => setExportState((s) => ({ ...s, ...p }))}
          onExport={onExport}
        />
      </main>
    </div>
  );
}
