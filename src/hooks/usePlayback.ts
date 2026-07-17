import { useEffect, useRef, useState, useCallback } from 'react';

/** rAF-driven playback clock over [0, duration] seconds. */
export function usePlayback(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const last = useRef(0);
  const timeRef = useRef(0);

  const seek = useCallback((t: number) => {
    timeRef.current = Math.min(Math.max(0, t), duration);
    setTime(timeRef.current);
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      timeRef.current += dt;
      if (timeRef.current >= duration) {
        timeRef.current = 0; // loop
      }
      setTime(timeRef.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration]);

  // clamp when track changes
  useEffect(() => {
    if (timeRef.current > duration) seek(0);
  }, [duration, seek]);

  return { time, playing, setPlaying, seek };
}
