import { useMemo, useRef, useCallback } from 'react';
import type { Track } from '../lib/gpx';

interface Props {
  track: Track;
  smoothed: number[];
  time: number;
  onSeek: (t: number) => void;
}

/** Scrubber with the ride's speed profile drawn behind the playhead. */
export function Timeline({ track, smoothed, time, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const path = useMemo(() => {
    const W = 1000;
    const H = 100;
    const max = Math.max(...smoothed, 0.1);
    const pts = track.points.map((p, i) => {
      const x = (p.t / track.duration) * W;
      const y = H - (smoothed[i] / max) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
  }, [track, smoothed]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(f * track.duration);
    },
    [onSeek, track.duration],
  );

  const frac = track.duration > 0 ? time / track.duration : 0;

  return (
    <div
      ref={ref}
      className="timeline"
      role="slider"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={track.duration}
      aria-valuenow={time}
      tabIndex={0}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        seekFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) seekFromEvent(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - 2));
        if (e.key === 'ArrowRight') onSeek(Math.min(track.duration, time + 2));
      }}
    >
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="timeline-profile">
        <path d={path} />
      </svg>
      <div className="timeline-played" style={{ width: `${frac * 100}%` }} />
      <div className="timeline-playhead" style={{ left: `${frac * 100}%` }} />
    </div>
  );
}
