import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  onCommit: (v: number) => void;
}

/** A number input that commits on blur or Enter, so typing doesn't create an undo step per key. */
export function NumberField({ label, value, step = 0.1, min, max, digits = 2, onCommit }: NumberFieldProps) {
  const shown = String(Number(value.toFixed(digits)));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v) || text.trim() === '') return setText(shown);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    else setText(shown);
  };

  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="row">
        <span className="grow">{label}</span>
        <span className="muted">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
