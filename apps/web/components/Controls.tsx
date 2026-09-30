"use client";

import { BOARD_THEMES, type BoardThemeId } from "../lib/themes";

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A row of square toggle buttons; exactly one is pressed. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker({ value, onChange }: { value: BoardThemeId; onChange: (id: BoardThemeId) => void }) {
  return (
    <div className="themes" role="radiogroup" aria-label="Board theme">
      {BOARD_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === value}
          className={t.id === value ? "theme on" : "theme"}
          onClick={() => onChange(t.id)}
        >
          <span className="theme-swatch" style={{ background: `conic-gradient(${t.dark} 0 25%, ${t.light} 0 50%, ${t.dark} 0 75%, ${t.light} 0)` }} />
          <span className="theme-name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}
