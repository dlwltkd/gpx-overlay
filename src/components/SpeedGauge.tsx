import { useEffect, useRef } from 'react';
import { drawGauge, gaugeSize, type GaugeSettings, type GaugeFrame } from '../lib/gauge';

interface Props {
  settings: GaugeSettings;
  frame: GaugeFrame;
  /** CSS width the gauge is displayed at */
  displayWidth: number;
}

/** Canvas host for the gauge, rendered at device-pixel resolution. */
export function SpeedGauge({ settings, frame, displayWidth }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = gaugeSize(settings.style);
  const displayHeight = (displayWidth / w) * h;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = (displayWidth / w) * dpr;
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGauge(ctx, settings, frame);
  }, [settings, frame, displayWidth, w, h]);

  return (
    <canvas
      ref={ref}
      style={{ width: displayWidth, height: displayHeight, display: 'block' }}
    />
  );
}
