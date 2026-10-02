"use client";

import { BOARD, JAIL_FINE, currentActor, type Action, type GameState } from "@fourman/monopoly-engine";
import { useEffect, useState } from "react";
import { money } from "../lib/look";
import { Effigy } from "./Effigy";

const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export function Die({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <span className={rolling ? "die rolling" : "die"} aria-label={`die showing ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={PIPS[value]!.includes(i + 1) ? "pip" : undefined} />
      ))}
    </span>
  );
}

interface Props {
  state: GameState;
  /** This device's player id; null when watching. */
  me: string | null;
  names: (id: string) => string;
  act: (action: Action) => Promise<boolean>;
}

/** The middle of the table: the dice, the last card, and whatever the player to act can do now. */
export function ActionPanel({ state, me, names, act }: Props) {
  const actor = currentActor(state);
  const mine = actor !== null && actor === me;
  const player = state.players[state.current]!;
  const tile = BOARD[player.position]!;
  const [rolling, setRolling] = useState(false);
  const [bid, setBid] = useState(10);
  const [busy, setBusy] = useState(false);

  // Shake the dice whenever a new roll lands.
  const rollKey = `${state.turn}:${state.dice?.join()}:${state.log.length}`;
  useEffect(() => {
    if (!state.dice) return;
    setRolling(true);
    const t = setTimeout(() => setRolling(false), 450);
    return () => clearTimeout(t);
  }, [rollKey, state.dice]);
  useEffect(() => {
    if (state.auction) setBid(state.auction.highBid + 10);
  }, [state.auction?.highBid, state.auction]);

  const run = async (action: Action) => {
    setBusy(true);
    await act(action);
    setBusy(false);
  };
  const button = (label: string, action: Action, primary = false, disabled = false) => (
    <button type="button" className={primary ? "primary" : undefined} disabled={busy || disabled} onClick={() => void run(action)}>
      {label}
    </button>
  );

  if (state.phase === "finished") {
    return (
      <div className="panel">
        <span className="label">Game over</span>
        <strong className="panel-title">{state.winner ? `${names(state.winner)} wins!` : "Game over"}</strong>
      </div>
    );
  }

  const me_ = me ? state.players.find((p) => p.id === me) : undefined;
  const who = actor ? names(actor) : "";

  let body: React.ReactNode;
  if (state.trade) {
    body = <p>{names(state.trade.from)} offered {names(state.trade.to)} a trade…</p>;
  } else if (state.phase === "debt") {
    const debt = state.debts[0]!;
    const debtor = state.players.find((p) => p.id === debt.debtor)!;
    body = mine ? (
      <>
        <p>
          You owe <strong>{money(debt.amount)}</strong> {debt.creditor ? `to ${names(debt.creditor)}` : "to the bank"} ({debt.reason}), and have {money(debtor.cash)}.
          {debtor.cash < debt.amount && " Sell buildings or mortgage squares from your properties to raise the rest."}
        </p>
        <div className="row">
          {button(`Pay ${money(debt.amount)}`, { type: "pay-debt" }, true, debtor.cash < debt.amount)}
          <button type="button" className="danger" disabled={busy} onClick={() => confirm("Declare bankruptcy? You'll be out of the game.") && void run({ type: "bankrupt" })}>
            Go bankrupt
          </button>
        </div>
      </>
    ) : (
      <p>{who} owes {money(debt.amount)} and is raising cash…</p>
    );
  } else if (state.phase === "auction") {
    const auction = state.auction!;
    const lot = BOARD[auction.tile]!;
    body = (
      <>
        <p>
          <strong>{lot.name}</strong> is up for auction (worth {money(lot.price!)}).{" "}
          {auction.highBidder ? `Top bid: ${money(auction.highBid)} by ${names(auction.highBidder)}.` : "No bids yet."}
        </p>
        {mine ? (
          <div className="row">
            <input type="number" min={auction.highBid + 1} max={me_?.cash} step={5} value={bid} onChange={(e) => setBid(Number(e.target.value))} aria-label="Your bid" />
            {button(`Bid ${money(bid)}`, { type: "bid", amount: bid }, true, bid <= auction.highBid || bid > (me_?.cash ?? 0))}
            {button("Pass", { type: "pass" })}
          </div>
        ) : (
          <p className="muted">{who} is deciding…</p>
        )}
      </>
    );
  } else if (state.phase === "buy") {
    body = mine ? (
      <>
        <p>
          Buy <strong>{tile.name}</strong> for {money(tile.price!)}? You have {money(player.cash)}.
        </p>
        <div className="row">
          {button(`Buy for ${money(tile.price!)}`, { type: "buy" }, true, player.cash < tile.price!)}
          {button(state.options.auctions ? "Auction it" : "No thanks", { type: "decline" })}
        </div>
      </>
    ) : (
      <p>{who} is thinking about {tile.name}…</p>
    );
  } else if (state.phase === "roll") {
    body = mine ? (
      <>
        {player.inJail && <p>You're in jail. Roll doubles to get out, pay {money(JAIL_FINE)}, or use a card.</p>}
        {!player.inJail && state.rollAgain && <p>Doubles! Roll again.</p>}
        <div className="row">
          {button("Roll the dice", { type: "roll" }, true)}
          {player.inJail && button(`Pay ${money(JAIL_FINE)}`, { type: "pay-jail" }, false, player.cash < JAIL_FINE)}
          {player.inJail && player.jailCards > 0 && button("Use jail card", { type: "use-jail-card" })}
        </div>
      </>
    ) : (
      <p>{who}'s turn to roll…</p>
    );
  } else {
    body = mine ? (
      <>
        <p className="muted">Build, mortgage or trade from the side panel, then end your turn.</p>
        {button("End turn", { type: "end-turn" }, true)}
      </>
    ) : (
      <p>{who} is finishing their turn…</p>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="whose">
          <Effigy id={player.id} name={player.name} />
          {mine && !state.trade ? "Your move" : `${names(player.id)}'s turn`}
        </span>
        {state.dice && (
          <span className="dice">
            <Die value={state.dice[0]} rolling={rolling} />
            <Die value={state.dice[1]} rolling={rolling} />
          </span>
        )}
      </div>
      {state.card && <p className={`card ${state.card.deck}`}>{state.card.text}</p>}
      {body}
      {state.options.parkingJackpot && state.pot > 0 && <p className="muted small">Free Parking pot: {money(state.pot)}</p>}
    </div>
  );
}
