"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A preference kept in this browser only (localStorage), so every player can
 * choose differently. Starts at `fallback` until the stored value is read.
 */
export function useLocalSetting<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
    } catch {
      // Storage blocked (private mode, etc.): keep the default.
    }
    // `allowed` is a constant list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Not persisted; still applies for this visit.
      }
    },
    [key],
  );

  return [value, update];
}
