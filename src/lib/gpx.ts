// GPX parsing + speed derivation.

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number | null;
  /** seconds since track start */
  t: number;
  /** speed in m/s (derived or from extensions) */
  speed: number;
}

export interface Track {
  name: string;
  points: TrackPoint[];
  /** total duration in seconds */
  duration: number;
  /** max raw speed in m/s */
  maxSpeed: number;
}

const R = 6371000; // earth radius, m

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function parseGpx(xml: string): Track {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not a valid GPX file.');
  }

  const name =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    'Untitled track';

  const trkpts = Array.from(doc.querySelectorAll('trkpt'));
  if (trkpts.length < 2) throw new Error('Track has fewer than 2 points.');

  const raw = trkpts
    .map((pt) => {
      const timeEl = pt.querySelector('time');
      return {
        lat: parseFloat(pt.getAttribute('lat') ?? ''),
        lon: parseFloat(pt.getAttribute('lon') ?? ''),
        ele: pt.querySelector('ele')
          ? parseFloat(pt.querySelector('ele')!.textContent ?? '')
          : null,
        time: timeEl ? new Date(timeEl.textContent ?? '').getTime() : NaN,
        // Garmin/others sometimes embed speed in extensions
        extSpeed: extensionSpeed(pt),
      };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.time));

  if (raw.length < 2) throw new Error('Track points are missing timestamps — cannot derive speed.');

  const t0 = raw[0].time;
  const points: TrackPoint[] = [];

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    let speed = p.extSpeed;
    if (speed == null) {
      if (i === 0) {
        speed = 0;
      } else {
        const q = raw[i - 1];
        const dt = (p.time - q.time) / 1000;
        speed = dt > 0 ? haversine(q.lat, q.lon, p.lat, p.lon) / dt : points[i - 1].speed;
      }
    }
    points.push({
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      t: (p.time - t0) / 1000,
      speed: Math.max(0, speed),
    });
  }

  // Drop GPS spikes: cap at 3x the 95th percentile
  const sorted = points.map((p) => p.speed).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const cap = Math.max(p95 * 3, 1);
  for (const p of points) if (p.speed > cap) p.speed = cap;

  return {
    name,
    points,
    duration: points[points.length - 1].t,
    maxSpeed: Math.max(...points.map((p) => p.speed)),
  };
}

function extensionSpeed(pt: Element): number | null {
  for (const el of Array.from(pt.getElementsByTagName('*'))) {
    if (el.localName === 'speed') {
      const v = parseFloat(el.textContent ?? '');
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** Moving-average smoothing over a time window (seconds). Returns a new speed lookup. */
export function smoothSpeeds(track: Track, windowSec: number): number[] {
  const { points } = track;
  if (windowSec <= 0) return points.map((p) => p.speed);
  const half = windowSec / 2;
  const out = new Array<number>(points.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    while (hi < points.length && points[hi].t <= t + half) {
      sum += points[hi].speed;
      hi++;
    }
    while (lo < hi && points[lo].t < t - half) {
      sum -= points[lo].speed;
      lo++;
    }
    out[i] = hi > lo ? sum / (hi - lo) : points[i].speed;
  }
  return out;
}

/** Interpolated speed (m/s) at time t using smoothed values. */
export function speedAt(track: Track, smoothed: number[], t: number): number {
  const pts = track.points;
  if (t <= pts[0].t) return smoothed[0];
  if (t >= pts[pts.length - 1].t) return smoothed[smoothed.length - 1];
  // binary search
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const span = pts[hi].t - pts[lo].t;
  const f = span > 0 ? (t - pts[lo].t) / span : 0;
  return smoothed[lo] + (smoothed[hi] - smoothed[lo]) * f;
}

export const MS_TO_KMH = 3.6;
export const MS_TO_MPH = 2.23694;

/** Synthetic demo ride so the gauge has something to show before a file is loaded. */
export function demoTrack(): Track {
  const points: TrackPoint[] = [];
  const dur = 120;
  let speed = 0;
  for (let t = 0; t <= dur; t += 1) {
    // a ride profile: accelerate, cruise with wobble, sprint, coast down
    const phase = t / dur;
    let target: number;
    if (phase < 0.15) target = 9 * (phase / 0.15);
    else if (phase < 0.5) target = 9 + Math.sin(t * 0.4) * 1.6;
    else if (phase < 0.65) target = 16.5;
    else if (phase < 0.8) target = 12 + Math.sin(t * 0.7) * 1.2;
    else target = 12 * (1 - (phase - 0.8) / 0.2);
    speed += (target - speed) * 0.25;
    points.push({ lat: 0, lon: 0, ele: null, t, speed: Math.max(0, speed) });
  }
  return {
    name: 'Demo ride',
    points,
    duration: dur,
    maxSpeed: Math.max(...points.map((p) => p.speed)),
  };
}
