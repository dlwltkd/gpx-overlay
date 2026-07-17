// Offscreen rendering of the gauge to files DaVinci (or any NLE) can use.
//
// PNG sequence: transparent frames zipped up — the reliable alpha route.
// WebM: realtime canvas capture on a black background. Browsers do not
// preserve alpha in MediaRecorder, so this is meant for Screen/Add blend
// modes in the editor rather than true transparency.

import { Zip, ZipPassThrough } from 'fflate';
import { drawGauge, gaugeSize, type GaugeSettings, type GaugeFrame } from './gauge';

export interface ExportOptions {
  fps: number;
  /** overlay width in output pixels */
  width: number;
}

export type FrameAt = (t: number) => GaugeFrame;

function makeCanvas(settings: GaugeSettings, width: number) {
  const { w, h } = gaugeSize(settings.style);
  const scale = width / w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx, w, h, scale };
}

/** One transparent PNG of the gauge at time t. */
export async function renderSnapshot(
  settings: GaugeSettings,
  frame: GaugeFrame,
  width: number,
): Promise<Blob> {
  const { canvas, ctx, w, h, scale } = makeCanvas(settings, width);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawGauge(ctx, settings, frame);
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

/** Zip of transparent PNGs, one per frame, named frame_00000.png … */
export async function exportPngSequence(
  settings: GaugeSettings,
  frameAt: FrameAt,
  duration: number,
  opts: ExportOptions,
  onProgress: (f: number) => void,
): Promise<Blob> {
  const { canvas, ctx, w, h, scale } = makeCanvas(settings, opts.width);
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else chunks.push(chunk);
  });

  const total = Math.floor(duration * opts.fps) + 1;
  for (let i = 0; i < total; i++) {
    if (zipError) throw zipError;
    const t = i / opts.fps;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGauge(ctx, settings, frameAt(t));
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const file = new ZipPassThrough(`frame_${String(i).padStart(5, '0')}.png`);
    zip.add(file);
    file.push(new Uint8Array(await blob.arrayBuffer()), true);
    if (i % 5 === 0) {
      onProgress(i / total);
      await new Promise((r) => setTimeout(r)); // let the UI breathe
    }
  }
  zip.end();
  onProgress(1);
  if (zipError) throw zipError;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/**
 * Realtime WebM capture on black (use Screen/Add blend in the editor).
 * Takes as long as the clip lasts.
 */
export async function exportWebm(
  settings: GaugeSettings,
  frameAt: FrameAt,
  duration: number,
  opts: ExportOptions,
  onProgress: (f: number) => void,
): Promise<Blob> {
  const { canvas, ctx, scale } = makeCanvas(settings, opts.width);
  const stream = canvas.captureStream(opts.fps);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(parts, { type: 'video/webm' }));
  });

  rec.start(1000);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) return resolve();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawGauge(ctx, settings, frameAt(t));
      onProgress(t / duration);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  onProgress(1);
  return done;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
