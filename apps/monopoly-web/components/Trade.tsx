"use client";

import { BOARD, groupOf, type Action, type GameState, type TradeSide } from "@fourman/monopoly-engine";
import { useState } from "react";
import { GROUP_COLOR, money } from "../lib/look";

/** Squares `owner` may trade: theirs, with no buildings anywhere in the set. */
const tradable = (state: GameState, owner: string) =>
  state.deeds.flatMap((d, i) => {
    const group = BOARD[i]!.group;
    const bare = !group || groupOf(group).every((g) => state.deeds[g]!.houses === 0);
    return d?.owner === owner && bare ? [i] : [];
  });

function Side({ title, state, owner, side, onChange }: { title: string; state: GameState; owner: string; side: TradeSide; onChange: (s: TradeSide) => void }) {
  const cash = state.players.find((p) => p.id === owner)!.cash;
  const tiles = tradable(state, owner);
  return (
    <fieldset className="trade-side">
      <legend className="label">{title}</legend>
      <label className="field-inline">
        Cash
        <input type="number" min={0} max={cash} step={10} value={side.cash} onChange={(e) => onChange({ ...side, cash: Math.max(0, Math.min(cash, Math.floor(Number(e.target.value) || 0))) })} />
        <span className="muted small">of {money(cash)}</span>
      </label>
      {tiles.length === 0 && <p className="muted small">No squares to trade.</p>}
      {tiles.map((t) => (
        <label key={t} className="check">
          <input
            type="checkbox"
            checked={side.tiles.includes(t)}
            onChange={(e) => onChange({ ...side, tiles: e.target.checked ? [...side.tiles, t] : side.tiles.filter((x) => x !== t) })}
          />
          <span className="band" style={{ background: BOARD[t]!.group ? GROUP_COLOR[BOARD[t]!.group!] : "var(--muted)" }} />
          {BOARD[t]!.name}
          {state.deeds[t]!.mortgaged && <span className="muted small"> (mortgaged)</span>}
        </label>
      ))}
    </fieldset>
  );
}

/** Make an offer to another player: what you give, what you want back. */
export function TradeBuilder({ state, me, names, act, onClose }: { state: GameState; me: string; names: (id: string) => string; act: (a: Action) => Promise<boolean>; onClose: () => void }) {
  const others = state.players.filter((p) => p.id !== me && !p.bankrupt);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [give, setGive] = useState<TradeSide>({ cash: 0, tiles: [] });
  const [get, setGet] = useState<TradeSide>({ cash: 0, tiles: [] });
  const empty = give.cash + get.cash + give.tiles.length + get.tiles.length === 0;

  return (
    <div className="modal" role="dialog" aria-label="Make a trade" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Make a trade</strong>
          <select value={to} onChange={(e) => (setTo(e.target.value), setGet({ cash: 0, tiles: [] }))} aria-label="Trade with">
            {others.map((p) => (
              <option key={p.id} value={p.id}>with {p.name}</option>
            ))}
          </select>
        </div>
        <div className="trade-sides">
          <Side title="You give" state={state} owner={me} side={give} onChange={setGive} />
          {to && <Side title={`${names(to)} gives`} state={state} owner={to} side={get} onChange={setGet} />}
        </div>
        <p className="muted small">One offer per turn. Squares change hands mortgaged or not, as they are.</p>
        <div className="row">
          <button type="button" className="primary" disabled={empty || !to} onClick={() => void act({ type: "offer", to, give, get }).then((ok) => ok && onClose())}>
            Send offer
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const describe = (side: TradeSide) =>
  [side.cash > 0 && money(side.cash), ...side.tiles.map((t) => BOARD[t]!.name)].filter(Boolean).join(", ") || "nothing";

/** An offer waiting for an answer: the receiver accepts or declines; everyone else sees it's pending. */
export function TradeOffer({ state, me, names, act }: { state: GameState; me: string | null; names: (id: string) => string; act: (a: Action) => Promise<boolean> }) {
  const trade = state.trade;
  if (!trade) return null;
  const forMe = trade.to === me;
  return (
    <div className={forMe ? "offer for-me" : "offer"}>
      <strong>{forMe ? `${names(trade.from)} offers you a trade` : `${names(trade.from)} → ${names(trade.to)}: trade offer`}</strong>
      <p>
        <span className="muted">{forMe ? "You get" : `${names(trade.to)} gets`}:</span> {describe(trade.give)}
        <br />
        <span className="muted">{forMe ? "You give" : `${names(trade.to)} gives`}:</span> {describe(trade.get)}
      </p>
      {forMe ? (
        <div className="row">
          <button type="button" className="primary" onClick={() => void act({ type: "accept" })}>Accept</button>
          <button type="button" onClick={() => void act({ type: "reject" })}>Decline</button>
        </div>
      ) : (
        <p className="muted small">Waiting for {names(trade.to)} to answer…</p>
      )}
    </div>
  );
}
