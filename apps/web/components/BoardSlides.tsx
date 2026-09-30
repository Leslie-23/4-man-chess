"use client";

import { VARIANT_IDS, applyMove, chooseBotMove, createGame, getVariant, type GameState, type VariantId } from "@fourman/game-engine";
import { useEffect, useRef, useState } from "react";
import type { BoardTheme } from "../lib/themes";
import { VARIANT_INFO } from "../lib/variants";
import { Board } from "./Board";

const SLIDE_MS = 7000;
const MOVE_MS = 650;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** A bot-vs-bot game that plays itself while its slide is showing, and starts over when it ends. */
function DemoBoard({ variant, theme, running }: { variant: VariantId; theme: BoardTheme; running: boolean }) {
  const [state, setState] = useState<GameState>(() => createGame({ variant }));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setState((current) => {
        if (current.status !== "playing" || current.ply > 160) return createGame({ variant });
        const move = chooseBotMove(current, Math.random, "hard");
        return move ? applyMove(current, move) : createGame({ variant });
      });
    }, MOVE_MS);
    return () => clearInterval(timer);
  }, [running, variant]);
  return <Board state={state} perspective={getVariant(variant).players[0]!} theme={theme} />;
}

/** The three boards as slides; each one plays a live demo game while it's on screen. */
export function BoardSlides({ theme, onPick }: { theme: BoardTheme; onPick?: (variant: VariantId) => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused || reduced) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % VARIANT_IDS.length), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, reduced]);

  const go = (i: number) => setIndex((i + VARIANT_IDS.length) % VARIANT_IDS.length);

  return (
    <div
      ref={root}
      className="slides"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node) && setPaused(false)}
      aria-roledescription="carousel"
    >
      <div className="slides-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {VARIANT_IDS.map((id, i) => {
          const info = VARIANT_INFO[id];
          return (
            <section key={id} className="slide" aria-roledescription="slide" aria-label={`${info.players} players`} aria-hidden={i !== index}>
              <div className="slide-board">
                <DemoBoard variant={id} theme={theme} running={i === index && !reduced} />
              </div>
              <div className="slide-copy">
                <span className="label">
                  {String(i + 1).padStart(2, "0")} / {info.players} players · {info.squares} squares
                </span>
                <h2>{info.name}</h2>
                <p>{info.tagline}</p>
                <ul>
                  {info.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                {onPick && (
                  <button type="button" className="primary" tabIndex={i === index ? 0 : -1} onClick={() => onPick(id)}>
                    Set up a {info.players}-player game
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="slides-nav">
        <button type="button" className="tiny" onClick={() => go(index - 1)} aria-label="Previous board">←</button>
        {VARIANT_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            className={i === index ? "dot on" : "dot"}
            aria-label={`Show ${VARIANT_INFO[id].players}-player board`}
            aria-current={i === index}
            onClick={() => go(i)}
          >
            {VARIANT_INFO[id].players}P
          </button>
        ))}
        <button type="button" className="tiny" onClick={() => go(index + 1)} aria-label="Next board">→</button>
        <span className={paused || reduced ? "slides-state" : "slides-state playing"}>
          {reduced ? "Motion off" : paused ? "Paused" : "Live demo"}
        </span>
      </div>
    </div>
  );
}
