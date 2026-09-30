"use client";

import { BOARD, chooseBotAction, currentActor, describeAction, type Action, type GameState } from "@fourman/monopoly-engine";
import type { AckResult, CoachTurn } from "@fourman/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

/** The squares a suggested action is about, so the board can point at them. */
export function actionTiles(state: GameState, action: Action | null): number[] {
  if (!action) return [];
  if ("tile" in action) return [action.tile];
  if (action.type === "buy" || action.type === "decline") return [state.players[state.current]!.position];
  if (action.type === "bid" || action.type === "pass") return state.auction ? [state.auction.tile] : [];
  if (action.type === "offer") return [...action.give.tiles, ...action.get.tiles];
  return [];
}

/** What the hard bot would do in our seat right now, worked out on this device. */
export function useSuggestion(state: GameState | null, me: string | null, enabled: boolean): Action | null {
  return useMemo(() => {
    if (!enabled || !state || !me || currentActor(state) !== me) return null;
    return chooseBotAction(state, me, () => 0.5, "hard");
  }, [state, me, enabled]);
}

/** The Hints card: a switch, and when it's our move, the move worth making and why it's on the board. */
export function HintsCard({ state, on, onToggle, suggestion, act }: { state: GameState; on: boolean; onToggle: (on: boolean) => void; suggestion: Action | null; act: (a: Action) => Promise<boolean> }) {
  return (
    <div className="control-card">
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span><strong>Hints</strong> {on ? "on" : "off"}</span>
      </label>
      {!on && <p className="blurb">Suggests a good move on your turn and marks the square it's about.</p>}
      {on && !suggestion && <p className="muted small">A suggestion appears when it's your move.</p>}
      {on && suggestion && (
        <>
          <p className="hint-line">
            <span className="hint-key" /> {describeAction(state, suggestion)}
          </p>
          <button type="button" className="tiny" onClick={() => void act(suggestion)}>Do it</button>
        </>
      )}
    </div>
  );
}

const STARTERS = ["What should I do now?", "Should I buy this?", "How does rent work?", "How do I get out of jail?"];

/** A tiny chatbot: ask Tycoon Coach about the rules or your position. Answers are private to you. */
export function CoachCard({ ask }: { ask: (question: string, history: CoachTurn[]) => Promise<AckResult<{ answer: string }>> }) {
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns.length, busy]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", content: question.trim() }]);
    setDraft("");
    const result = await ask(question.trim(), history);
    setBusy(false);
    if (result.ok) setTurns((t) => [...t, { role: "assistant", content: result.answer }]);
    else setError(result.error);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="control-card coach">
      <span className="toggle-like"><span><strong>Coach</strong> ask anything</span></span>
      <ol className="coach-list" ref={list} aria-live="polite">
        {turns.length === 0 && (
          <li className="coach-starters">
            {STARTERS.map((q) => (
              <button key={q} type="button" className="tiny" onClick={() => void send(q)}>{q}</button>
            ))}
          </li>
        )}
        {turns.map((t, i) => (
          <li key={i} className={t.role === "user" ? "coach-q" : "coach-a"}>{t.content}</li>
        ))}
        {busy && <li className="coach-a muted">Thinking…</li>}
      </ol>
      {error && <p className="error">{error}</p>}
      <form className="inline" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} placeholder="Ask the coach" aria-label="Ask the coach" />
        <button type="submit" disabled={busy || !draft.trim()}>Ask</button>
      </form>
    </div>
  );
}

export function HowToPlay({ turnLimit }: { turnLimit: number | null }) {
  return (
    <ol className="rules-list">
      <li>On your turn, roll and move. Passing Go pays you $200. Doubles roll again; three in a row sends you to jail.</li>
      <li>Land on an unowned square to buy it. Say no and it's auctioned to the highest bidder.</li>
      <li>Land on someone's square and you pay rent. Tap any square to see its rents.</li>
      <li>Own a whole colour set to double its rent and build houses (evenly), then hotels. Rent jumps with each one.</li>
      <li>Stations pay more the more you own; utilities charge a multiple of the dice.</li>
      <li>Short of cash? Sell buildings for half, or mortgage squares. If you still can't pay, you're bankrupt and out.</li>
      <li>Trade squares and cash with anyone on your turn, to finish a set or stop someone else's.</li>
      <li>{turnLimit ? `After ${turnLimit} turns the richest player by net worth wins.` : "Last player standing wins."}</li>
    </ol>
  );
}

/** Tiles the board should mark for a hint. */
export const hintTiles = (state: GameState, suggestion: Action | null) => new Set(actionTiles(state, suggestion).filter((t) => BOARD[t]));
