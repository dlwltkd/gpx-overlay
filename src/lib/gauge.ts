// Pure canvas renderer for the speed ribbon gauge.
// Kept framework-free so the same function can drive the live preview
// and, later, offscreen frame rendering for export.

export type GaugeStyle = 'bar' | 'dial';

export interface GaugeSettings {
  style: GaugeStyle;
  unit: 'kmh' | 'mph';
  /** gauge full-scale, in display units */
  maxValue: number;
  accent: string;
  label: string;
  /** number of fill segments */
  segments: number;
  showPeak: boolean;
  showGlow: boolean;
}

export interface GaugeFrame {
  /** current speed, display units */
  value: number;
  /** session peak so far, display units */
  peak: number;
}

export const GAUGE_W = 840;
export const GAUGE_H = 130;
export const DIAL_W = 420;
export const DIAL_H = 420;

/** Design-space size of a gauge style, in canvas units. */
export function gaugeSize(style: GaugeStyle): { w: number; h: number } {
  return style === 'dial' ? { w: DIAL_W, h: DIAL_H } : { w: GAUGE_W, h: GAUGE_H };
}

const FONT_DIGITS = '"Saira", system-ui, sans-serif';

/**
 * Draws the gauge into its gaugeSize(style)-unit space.
 * Caller is responsible for scaling the context (devicePixelRatio / export scale)
 * and clearing the canvas.
 */
export function drawGauge(ctx: CanvasRenderingContext2D, s: GaugeSettings, f: GaugeFrame) {
  if (s.style === 'dial') drawDial(ctx, s, f);
  else drawBar(ctx, s, f);
}

function drawBar(ctx: CanvasRenderingContext2D, s: GaugeSettings, f: GaugeFrame) {
  const unitLabel = s.unit === 'kmh' ? 'KM/H' : 'MPH';
  const frac = Math.min(1, Math.max(0, f.value / s.maxValue));
  const peakFrac = Math.min(1, Math.max(0, f.peak / s.maxValue));

  // ----- geometry -----
  const barX = 24;
  const barW = 560;
  const barH = 14;
  const barY = 78;
  const digitsX = barX + barW + 36;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ----- label row -----
  ctx.font = `500 17px ${FONT_DIGITS}`;
  ctx.letterSpacing = '3.5px';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText(s.label.toUpperCase(), barX, barY - 22);
  ctx.letterSpacing = '0px';

  // ----- track (empty bar) -----
  const seg = s.segments;
  const gap = 3;
  const segW = (barW - gap * (seg - 1)) / seg;
  const litSegs = frac * seg;

  for (let i = 0; i < seg; i++) {
    const x = barX + i * (segW + gap);
    // taper: segments get slightly taller toward the fast end
    const grow = (i / (seg - 1)) * 10;
    const h = barH + grow;
    const y = barY + (barH - h) + 0; // grow upward
    const lit = Math.min(1, Math.max(0, litSegs - i));

    ctx.beginPath();
    roundRect(ctx, x, y, segW, h, 2);
    if (lit > 0) {
      ctx.fillStyle = s.accent;
      ctx.globalAlpha = 0.25 + 0.75 * lit;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.globalAlpha = 1;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // glow under the lit portion
  if (s.showGlow && frac > 0.02) {
    const litW = barW * frac;
    const g = ctx.createLinearGradient(barX, 0, barX + litW, 0);
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, hexWithAlpha(s.accent, 0.55));
    ctx.save();
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = g;
    ctx.fillRect(barX, barY - 4, litW, barH + 14);
    ctx.restore();
  }

  // ----- peak marker -----
  if (s.showPeak && peakFrac > 0.01) {
    const px = barX + barW * peakFrac;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(px - 1, barY - 14, 2, barH + 22);
    ctx.font = `600 12px ${FONT_DIGITS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const peakText = `${Math.round(f.peak)}`;
    const tw = ctx.measureText(peakText).width;
    ctx.fillText(peakText, Math.min(px - tw / 2, barX + barW - tw), barY - 20);
  }

  // ----- scale endpoints -----
  ctx.font = `500 13px ${FONT_DIGITS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('0', barX, barY + barH + 22);
  const maxText = `${Math.round(s.maxValue)}`;
  ctx.fillText(maxText, barX + barW - ctx.measureText(maxText).width, barY + barH + 22);

  // ----- digits -----
  const shown = Math.round(f.value);
  ctx.font = `700 76px ${FONT_DIGITS}`;
  ctx.fillStyle = '#FFFFFF';
  const digits = `${shown}`;
  // right-align digits in a 3-char box so they don't jitter
  const boxW = ctx.measureText('000').width;
  const dw = ctx.measureText(digits).width;
  ctx.fillText(digits, digitsX + boxW - dw, barY + barH + 12);

  // faint leading zeros for the dashboard feel
  if (digits.length < 3) {
    const lead = '0'.repeat(3 - digits.length);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillText(lead, digitsX + boxW - dw - ctx.measureText(lead).width, barY + barH + 12);
  }

  // ----- unit chip -----
  ctx.font = `600 15px ${FONT_DIGITS}`;
  ctx.letterSpacing = '2px';
  const ux = digitsX + boxW + 14;
  ctx.fillStyle = s.accent;
  ctx.fillText(unitLabel, ux, barY + barH + 10);
  ctx.letterSpacing = '0px';

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Circular dial: 270° tick ring, big center digits, lingering peak tick.
// ---------------------------------------------------------------------------

const DIAL_START = Math.PI * 0.75; // 135° — lower left
const DIAL_SWEEP = Math.PI * 1.5; // 270°

function drawDial(ctx: CanvasRenderingContext2D, s: GaugeSettings, f: GaugeFrame) {
  const unitLabel = s.unit === 'kmh' ? 'KM/H' : 'MPH';
  const frac = Math.min(1, Math.max(0, f.value / s.maxValue));
  const peakFrac = Math.min(1, Math.max(0, f.peak / s.maxValue));

  const cx = DIAL_W / 2;
  const cy = DIAL_H / 2 + 6;
  const rOuter = 178;
  const tickLen = 16;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.lineCap = 'round';

  // ----- tick ring -----
  const seg = s.segments;
  const litSegs = frac * seg;
  for (let i = 0; i < seg; i++) {
    const a = DIAL_START + (i / (seg - 1)) * DIAL_SWEEP;
    const lit = Math.min(1, Math.max(0, litSegs - i));
    // ticks grow slightly toward the fast end, echoing the bar's taper
    const grow = (i / (seg - 1)) * 7;
    const r1 = rOuter - tickLen - grow;
    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    const x2 = cx + Math.cos(a) * rOuter;
    const y2 = cy + Math.sin(a) * rOuter;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = 4;
    if (lit > 0) {
      ctx.strokeStyle = s.accent;
      ctx.globalAlpha = 0.25 + 0.75 * lit;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ----- glow arc under the lit ticks -----
  if (s.showGlow && frac > 0.02) {
    ctx.save();
    ctx.filter = 'blur(12px)';
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter - tickLen / 2, DIAL_START, DIAL_START + DIAL_SWEEP * frac);
    ctx.lineWidth = 18;
    ctx.strokeStyle = hexWithAlpha(s.accent, 0.45);
    ctx.stroke();
    ctx.restore();
  }

  // ----- peak marker -----
  if (s.showPeak && peakFrac > 0.01) {
    const a = DIAL_START + DIAL_SWEEP * peakFrac;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (rOuter - tickLen - 10), cy + Math.sin(a) * (rOuter - tickLen - 10));
    ctx.lineTo(cx + Math.cos(a) * (rOuter + 6), cy + Math.sin(a) * (rOuter + 6));
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  // ----- scale endpoints, tucked into the bottom gap -----
  ctx.font = `500 15px ${FONT_DIGITS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const rLabel = rOuter - tickLen / 2;
  const ax = cx + Math.cos(DIAL_START) * rLabel;
  const ay = cy + Math.sin(DIAL_START) * rLabel;
  const bx = cx + Math.cos(DIAL_START + DIAL_SWEEP) * rLabel;
  const by = cy + Math.sin(DIAL_START + DIAL_SWEEP) * rLabel;
  ctx.fillText('0', ax - ctx.measureText('0').width / 2, ay + 30);
  const maxText = `${Math.round(s.maxValue)}`;
  ctx.fillText(maxText, bx - ctx.measureText(maxText).width / 2, by + 30);

  // ----- label above digits -----
  ctx.font = `500 17px ${FONT_DIGITS}`;
  ctx.letterSpacing = '3.5px';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  const label = s.label.toUpperCase();
  ctx.fillText(label, cx - ctx.measureText(label).width / 2, cy - 62);
  ctx.letterSpacing = '0px';

  // ----- digits, centered -----
  const shown = Math.round(f.value);
  ctx.font = `700 104px ${FONT_DIGITS}`;
  const digits = `${shown}`;
  const dw = ctx.measureText(digits).width;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(digits, cx - dw / 2, cy + 36);

  // ----- unit below digits -----
  ctx.font = `600 17px ${FONT_DIGITS}`;
  ctx.letterSpacing = '2px';
  const uw = ctx.measureText(unitLabel).width;
  ctx.fillStyle = s.accent;
  ctx.fillText(unitLabel, cx - uw / 2, cy + 76);
  ctx.letterSpacing = '0px';

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
