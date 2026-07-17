import type { GaugeSettings } from '../lib/gauge';

export type ExportFormat = 'png-seq' | 'webm' | 'snapshot';

export interface ExportState {
  running: boolean;
  progress: number;
  fps: number;
  width: number;
}

export interface OverlaySettings extends GaugeSettings {
  /** 'auto' derives full-scale from the ride's max */
  maxMode: 'auto' | 'manual';
  smoothingSec: number;
  /** display-speed multiplier as a percentage, e.g. +15 shows readings 15% faster */
  boostPct: number;
  /** gauge width as a fraction of frame width */
  scale: number;
}

interface Props {
  settings: OverlaySettings;
  onChange: (patch: Partial<OverlaySettings>) => void;
  onFile: (file: File) => void;
  trackName: string;
  autoMax: number;
  exportState: ExportState;
  onExportChange: (patch: Partial<ExportState>) => void;
  onExport: (format: ExportFormat) => void;
}

const SWATCHES = ['#FFB020', '#FF5C39', '#4FC3F7', '#7CFC9A', '#E8E4DA', '#C77DFF'];

export function EditorPanel({
  settings,
  onChange,
  onFile,
  trackName,
  autoMax,
  exportState,
  onExportChange,
  onExport,
}: Props) {
  return (
    <aside className="panel">
      <section className="panel-group">
        <h2>Data</h2>
        <label className="file-drop">
          <input
            type="file"
            accept=".gpx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <span className="file-drop-title">Load GPX</span>
          <span className="file-drop-sub">{trackName}</span>
        </label>

        <div className="control">
          <label htmlFor="boost">Speed boost</label>
          <div className="control-row">
            <input
              id="boost"
              type="range"
              min={-50}
              max={50}
              step={1}
              value={settings.boostPct}
              onChange={(e) => onChange({ boostPct: Number(e.target.value) })}
            />
            <span className="control-value">
              {settings.boostPct > 0 ? '+' : ''}
              {settings.boostPct}%
            </span>
          </div>
        </div>

        <div className="control">
          <label htmlFor="smoothing">Smoothing</label>
          <div className="control-row">
            <input
              id="smoothing"
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={settings.smoothingSec}
              onChange={(e) => onChange({ smoothingSec: Number(e.target.value) })}
            />
            <span className="control-value">{settings.smoothingSec}s</span>
          </div>
        </div>
      </section>

      <section className="panel-group">
        <h2>Gauge</h2>

        <div className="control">
          <label>Style</label>
          <div className="seg-toggle" role="radiogroup" aria-label="Gauge style">
            {(['bar', 'dial'] as const).map((st) => (
              <button
                key={st}
                role="radio"
                aria-checked={settings.style === st}
                className={settings.style === st ? 'active' : ''}
                onClick={() => onChange({ style: st })}
              >
                {st === 'bar' ? 'Bar' : 'Dial'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <label>Unit</label>
          <div className="seg-toggle" role="radiogroup" aria-label="Speed unit">
            {(['kmh', 'mph'] as const).map((u) => (
              <button
                key={u}
                role="radio"
                aria-checked={settings.unit === u}
                className={settings.unit === u ? 'active' : ''}
                onClick={() => onChange({ unit: u })}
              >
                {u === 'kmh' ? 'km/h' : 'mph'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <label htmlFor="label-text">Label</label>
          <input
            id="label-text"
            className="text-input"
            type="text"
            maxLength={20}
            value={settings.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>

        <div className="control">
          <label>Full scale</label>
          <div className="control-row">
            <div className="seg-toggle">
              {(['auto', 'manual'] as const).map((m) => (
                <button
                  key={m}
                  className={settings.maxMode === m ? 'active' : ''}
                  onClick={() =>
                    onChange(
                      m === 'auto'
                        ? { maxMode: m, maxValue: autoMax }
                        : { maxMode: m },
                    )
                  }
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className="text-input num"
              type="number"
              min={10}
              max={500}
              disabled={settings.maxMode === 'auto'}
              value={Math.round(settings.maxValue)}
              onChange={(e) => onChange({ maxValue: Number(e.target.value) || 10 })}
              aria-label="Gauge full scale value"
            />
          </div>
        </div>

        <div className="control">
          <label>Accent</label>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch ${settings.accent === c ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={`Accent color ${c}`}
                onClick={() => onChange({ accent: c })}
              />
            ))}
            <input
              type="color"
              className="swatch swatch-custom"
              value={settings.accent}
              onChange={(e) => onChange({ accent: e.target.value })}
              aria-label="Custom accent color"
            />
          </div>
        </div>

        <div className="control">
          <label htmlFor="segments">Segments</label>
          <div className="control-row">
            <input
              id="segments"
              type="range"
              min={12}
              max={60}
              step={2}
              value={settings.segments}
              onChange={(e) => onChange({ segments: Number(e.target.value) })}
            />
            <span className="control-value">{settings.segments}</span>
          </div>
        </div>

        <div className="control checks">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.showPeak}
              onChange={(e) => onChange({ showPeak: e.target.checked })}
            />
            Peak marker
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.showGlow}
              onChange={(e) => onChange({ showGlow: e.target.checked })}
            />
            Glow
          </label>
        </div>
      </section>

      <section className="panel-group">
        <h2>Export</h2>

        <div className="control">
          <label>Frame rate</label>
          <div className="seg-toggle" role="radiogroup" aria-label="Export frame rate">
            {[30, 60].map((fps) => (
              <button
                key={fps}
                role="radio"
                aria-checked={exportState.fps === fps}
                className={exportState.fps === fps ? 'active' : ''}
                onClick={() => onExportChange({ fps })}
              >
                {fps} fps
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <label htmlFor="export-width">Overlay width (px)</label>
          <input
            id="export-width"
            className="text-input num wide"
            type="number"
            min={200}
            max={3840}
            step={10}
            value={exportState.width}
            onChange={(e) => onExportChange({ width: Number(e.target.value) || 200 })}
          />
        </div>

        {exportState.running ? (
          <div className="export-progress" role="progressbar" aria-valuenow={Math.round(exportState.progress * 100)}>
            <div className="export-progress-fill" style={{ width: `${exportState.progress * 100}%` }} />
            <span>{Math.round(exportState.progress * 100)}%</span>
          </div>
        ) : (
          <div className="export-actions">
            <button className="btn-primary" onClick={() => onExport('png-seq')}>
              PNG sequence (alpha)
            </button>
            <button className="btn-secondary" onClick={() => onExport('webm')}>
              WebM (on black, realtime)
            </button>
            <button className="btn-secondary" onClick={() => onExport('snapshot')}>
              Snapshot current frame
            </button>
          </div>
        )}
        <p className="export-hint">
          PNG sequence keeps transparency: import the zip contents into DaVinci as an image
          sequence. WebM records on black for Screen or Add blend.
        </p>
      </section>

      <section className="panel-group">
        <h2>Layout</h2>
        <div className="control">
          <label htmlFor="scale">Size</label>
          <div className="control-row">
            <input
              id="scale"
              type="range"
              min={0.3}
              max={0.9}
              step={0.01}
              value={settings.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value) })}
            />
            <span className="control-value">{Math.round(settings.scale * 100)}%</span>
          </div>
        </div>
      </section>
    </aside>
  );
}
