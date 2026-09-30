"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

const ARMY = ["#d7362d", "#2b6be0", "#e0a810", "#229a4f"];
const HOLD_MS = 1800;
const SHOW_MS = 7000;

interface Props {
  /** Who won, as shown on their plate; null for a draw. */
  name: string | null;
  /** The winner's army colour, so their name is spelled mostly in it. */
  color: string | null;
  isYou: boolean;
  onClose: () => void;
}

interface Bit {
  x: number;
  y: number;
  /** Where it settles to help spell the name; unset for loose confetti. */
  tx?: number;
  ty?: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  c: string;
  delay: number;
}

/**
 * Game over: confetti flies in and spells the winner's name, hangs there for a
 * moment, then falls away. A banner underneath says who won.
 */
export function WinCelebration({ name, color, isYou, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = setTimeout(onClose, SHOW_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = el.getContext("2d")!;
    const w = innerWidth;
    const h = innerHeight;
    el.width = w * devicePixelRatio;
    el.height = h * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Trace the name in an offscreen canvas and use its filled pixels as landing spots.
    const text = (name ?? "Draw!").toUpperCase();
    const off = document.createElement("canvas");
    const width = Math.min(w - 32, 1000);
    let size = 160;
    const octx = off.getContext("2d")!;
    const font = (px: number) => `700 ${px}px "Space Grotesk", system-ui, sans-serif`;
    octx.font = font(size);
    size = Math.max(36, Math.min(size, (size * width) / Math.max(1, octx.measureText(text).width)));
    off.width = width;
    off.height = Math.ceil(size * 1.2);
    octx.font = font(size);
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText(text, width / 2, off.height / 2);
    const pixels = octx.getImageData(0, 0, off.width, off.height).data;
    const gap = Math.max(4, Math.round(size / 22));
    const left = (w - width) / 2;
    const top = h * 0.36 - off.height / 2;
    const bits: Bit[] = [];
    const main = color ?? ARMY[0]!;
    for (let y = 0; y < off.height; y += gap) {
      for (let x = 0; x < off.width; x += gap) {
        if (pixels[(y * off.width + x) * 4 + 3]! < 128) continue;
        bits.push({
          x: Math.random() * w,
          y: h + 20 + Math.random() * 200,
          tx: left + x,
          ty: top + y,
          vx: 0,
          vy: 0,
          r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          c: Math.random() < 0.7 ? main : ARMY[Math.floor(Math.random() * ARMY.length)]!,
          delay: Math.random() * 400,
        });
      }
    }
    // Plus loose confetti bursting from both bottom corners.
    for (let i = 0; i < 160; i++) {
      const fromLeft = i % 2 === 0;
      bits.push({
        x: fromLeft ? 0 : w,
        y: h,
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9),
        vy: -12 - Math.random() * 10,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        c: ARMY[i % ARMY.length]!,
        delay: Math.random() * 300,
      });
    }

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        if (t < b.delay) continue;
        if (b.tx !== undefined && b.ty !== undefined && t < HOLD_MS + 900) {
          // Ease towards the letter; once the hold is over, let go.
          b.x += (b.tx - b.x) * 0.12;
          b.y += (b.ty - b.y) * 0.12;
          b.r += b.vr * 0.3;
          if (t > HOLD_MS + 800) {
            b.vx = (Math.random() - 0.5) * 4;
            b.vy = -2 - Math.random() * 3;
            b.tx = undefined;
          }
        } else {
          b.vy += 0.35;
          b.vx *= 0.99;
          b.x += b.vx;
          b.y += b.vy;
          b.r += b.vr;
        }
        const s = gap * 0.9;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-s / 2, -s / 3, s, (s * 2) / 3);
        ctx.restore();
      }
      if (t < SHOW_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [name, color]);

  return (
    <div className="celebration" role="dialog" aria-label={name ? `${name} wins` : "The game is a draw"} onClick={onClose}>
      <canvas ref={canvas} className="celebration-canvas" aria-hidden="true" />
      <div className="celebration-banner" onClick={(e) => e.stopPropagation()}>
        <span className="label">Game over</span>
        <strong>{name ? (isYou ? `You win, ${name}!` : `${name} wins!`) : "It's a draw"}</strong>
        <div className="row">
          <Link href="/leaderboard" className="button primary">Leaderboard</Link>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
