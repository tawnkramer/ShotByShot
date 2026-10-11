import { useRef, useState } from 'react';
import type { CameraState } from '../../state/schema';
import { moveCamera, panCamera } from '../../three/camera';

interface Props {
  base: CameraState;
  aspect: number;
  onLive: (state: CameraState) => void;
  onCommit: (state: CameraState) => void;
}

const ORBIT_DEG_PER_PX = 0.3;
const TILT_DEG_PER_PX = 0.2;

/** What a one-finger drag does. Pan, dolly and crane move the camera without turning it. */
export type PadMove = 'orbit' | 'pan' | 'dolly' | 'crane';

const MOVES: { id: PadMove; label: string; hint: string }[] = [
  { id: 'orbit', label: 'Orbit', hint: 'Drag to orbit · pinch to zoom · two fingers to pan' },
  { id: 'pan', label: 'Pan', hint: 'Drag left or right to move the camera sideways' },
  { id: 'dolly', label: 'Dolly', hint: 'Drag up to move in, down to move out' },
  { id: 'crane', label: 'Crane', hint: 'Drag up or down to raise or lower the camera' },
];

/**
 * The camera gizmo: the whole frame is a touch pad. In Orbit, one finger
 * orbits (left/right) and raises or lowers the view (up/down); Pan, Dolly and
 * Crane slide the camera left/right, in/out and up/down instead. Pinch zooms
 * and two fingers pan in every mode. Scroll wheel zooms on desktop.
 */
export function CameraPad({ base, aspect, onLive, onCommit }: Props) {
  const [move, setMove] = useState<PadMove>('orbit');
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
      const dx = p.x - s.x, dy = p.y - s.y;
      // Slides scale with how far away the subject is, so a drag across the frame is a sensible move at any size.
      const m = Math.max(1, g.start.distance) / Math.max(box.width, box.height);
      if (move === 'pan') next = moveCamera(g.start, { right: dx * m });
      else if (move === 'dolly') next = moveCamera(g.start, { forward: -dy * m });
      else if (move === 'crane') next = moveCamera(g.start, { up: -dy * m * 0.8 });
      else
        next = {
          ...g.start,
          azimuth: g.start.azimuth - dx * ORBIT_DEG_PER_PX,
          elevation: Math.max(-80, Math.min(85, g.start.elevation + dy * TILT_DEG_PER_PX)),
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
        {move === 'orbit' && <circle cx="50" cy="50" r="30" />}
        {move !== 'orbit' && <path className="axis" d={move === 'pan' ? 'M18 50 H82' : 'M50 18 V82'} />}
        <path d={move === 'pan' ? 'M14 50 l6 -4 v8 z M86 50 l-6 -4 v8 z' : move === 'orbit' ? 'M14 50 l6 -4 v8 z M86 50 l-6 -4 v8 z M50 14 l-4 6 h8 z M50 86 l-4 -6 h8 z' : 'M50 14 l-4 6 h8 z M50 86 l-4 -6 h8 z'} />
      </svg>
      <span className="camera-pad-hint">{MOVES.find((m) => m.id === move)!.hint}</span>
      <div className="segmented compact camera-moves" role="radiogroup" aria-label="Camera move" onPointerDown={(e) => e.stopPropagation()}>
        {MOVES.map((m) => (
          <button key={m.id} role="radio" aria-checked={move === m.id} className={move === m.id ? 'on' : ''} onClick={() => setMove(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
