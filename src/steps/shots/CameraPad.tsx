import { useRef } from 'react';
import type { CameraState } from '../../state/schema';
import { panCamera } from '../../three/camera';

interface Props {
  base: CameraState;
  aspect: number;
  onLive: (state: CameraState) => void;
  onCommit: (state: CameraState) => void;
}

const ORBIT_DEG_PER_PX = 0.3;
const TILT_DEG_PER_PX = 0.2;

/**
 * The camera gizmo: the whole frame is a touch pad. One finger orbits
 * (left/right) and raises or lowers the camera (up/down); pinch dollies in
 * and out; two fingers pan. Scroll wheel zooms on desktop.
 */
export function CameraPad({ base, aspect, onLive, onCommit }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: CameraState; p0: Map<number, { x: number; y: number }> } | null>(null);
  const live = useRef<CameraState | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const begin = () => {
    gesture.current = { start: live.current ?? base, p0: new Map(pointers.current) };
  };

  const update = () => {
    const g = gesture.current;
    const box = el.current?.getBoundingClientRect();
    if (!g || !box) return;
    const now = [...pointers.current.entries()];
    let next = g.start;
    if (now.length === 1) {
      const [id, p] = now[0];
      const s = g.p0.get(id);
      if (!s) return;
      next = {
        ...g.start,
        azimuth: g.start.azimuth - (p.x - s.x) * ORBIT_DEG_PER_PX,
        elevation: Math.max(-80, Math.min(85, g.start.elevation + (p.y - s.y) * TILT_DEG_PER_PX)),
      };
    } else if (now.length >= 2) {
      const [[ia, a], [ib, b]] = now;
      const sa = g.p0.get(ia), sb = g.p0.get(ib);
      if (!sa || !sb) return;
      const span0 = Math.hypot(sa.x - sb.x, sa.y - sb.y) || 1;
      const span = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid0 = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      next = { ...g.start, distance: Math.max(0.2, Math.min(80, (g.start.distance * span0) / span)) };
      next = panCamera(next, (mid.x - mid0.x) / box.width, (mid.y - mid0.y) / box.height, aspect);
    }
    live.current = next;
    onLive(next);
  };

  const end = () => {
    if (live.current) onCommit(live.current);
    live.current = null;
    gesture.current = null;
  };

  return (
    <div
      ref={el}
      className="camera-pad"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        begin();
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        update();
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        // Lifting one of two fingers: carry on with the remaining one from here.
        if (pointers.current.size) begin();
        else end();
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        if (!pointers.current.size) end();
      }}
      onWheel={(e) => {
        const start = live.current ?? base;
        const next = { ...start, distance: Math.max(0.2, Math.min(80, start.distance * Math.exp(e.deltaY * 0.001))) };
        live.current = next;
        onLive(next);
        clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(end, 250);
      }}
    >
      <svg className="camera-pad-ring" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="30" />
        <path d="M14 50 l6 -4 v8 z M86 50 l-6 -4 v8 z M50 14 l-4 6 h8 z M50 86 l-4 -6 h8 z" />
      </svg>
      <span className="camera-pad-hint">Drag to orbit · pinch to zoom · two fingers to pan</span>
    </div>
  );
}
