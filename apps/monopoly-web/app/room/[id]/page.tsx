"use client";

import { currentActor } from "@fourman/monopoly-engine";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ActionPanel } from "../../../components/ActionPanel";
import { Board } from "../../../components/Board";
import { Chat } from "../../../components/Chat";
import { Log, MyProperties, Players, TileInfo } from "../../../components/SidePanels";
import { TopBar } from "../../../components/TopBar";
import { TradeBuilder, TradeOffer } from "../../../components/Trade";
import { TOKEN, tokenColor } from "../../../lib/look";
import { loadName, saveName } from "../../../lib/socket";
import { useRoom } from "../../../lib/useRoom";

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setName(loadName());
    setChecked(true);
  }, []);
  if (!checked) return null;
  if (!name) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (!draft.trim()) return;
      saveName(draft.trim());
      setName(draft.trim());
    };
    return (
      <div className="app">
        <TopBar />
        <main className="center">
          <form className="card" onSubmit={submit}>
            <h1 className="label">Join room {id.toUpperCase()}</h1>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20} placeholder="Your name" aria-label="Your name" />
            <button type="submit" className="primary wide">Take a seat</button>
          </form>
        </main>
      </div>
    );
  }
  return <Room id={id} name={name} />;
}

function Room({ id, name }: { id: string; name: string }) {
  const { room, seat, me, connected, error, act, start, say } = useRoom(id, name);
  const [selected, setSelected] = useState<number | null>(null);
  const [trading, setTrading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!room) {
    return (
      <div className="app">
        <TopBar />
        <main className="center">
          <div className="card">
            <p className="label">{error ? "Can't join" : "Connecting… (a sleeping server can take a minute)"}</p>
            {error && <p className="error">{error}</p>}
            {error && <Link href="/" className="button primary">Back to start</Link>}
          </div>
        </main>
      </div>
    );
  }

  const names = (pid: string) => room.state?.players.find((p) => p.id === pid)?.name ?? room.seats[Number(pid.slice(1))]?.name ?? pid;
  const shareUrl = `${window.location.origin}/room/${room.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this invite link", shareUrl);
    }
  };

  const topbar = (
    <TopBar>
      <span className="room-chip">
        <span className="label">Room</span> <strong>{room.id}</strong>
        <button type="button" className="tiny" onClick={() => void copy()}>{copied ? "Copied" : "Copy invite"}</button>
      </span>
      <span className={connected ? "conn live" : "conn"}>{connected ? "Live" : "Reconnecting"}</span>
    </TopBar>
  );

  if (room.phase === "lobby" || !room.state) {
    const seated = room.seats.filter(Boolean).length;
    return (
      <div className="app">
        {topbar}
        <main className="center">
          <div className="card lobby">
            <h1 className="label">Lobby · {seated}/{room.plan.length} seated</h1>
            <ul className="seat-list">
              {room.plan.map((plan, i) => {
                const s = room.seats[i];
                return (
                  <li key={i}>
                    <i className="token" style={{ background: TOKEN[i] }}>{s?.name[0] ?? "?"}</i>
                    {s ? `${s.name}${i === seat ? " (you)" : ""}` : plan === "friend" ? <span className="muted">Waiting for a friend…</span> : plan}
                  </li>
                );
              })}
            </ul>
            <p className="blurb">Send friends the code <strong>{room.id}</strong> or the invite link. The game starts by itself once every seat is filled.</p>
            {seat === room.host && seated >= 2 && (
              <button type="button" className="primary wide" onClick={() => void start()}>Start now (empty seats are dropped)</button>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  const state = room.state;
  const myTurn = me !== null && currentActor(state) === me && !state.trade;
  const canOffer = myTurn && (state.phase === "roll" || state.phase === "end") && !state.offered;
  const out = me ? state.players.find((p) => p.id === me)?.bankrupt : false;

  return (
    <div className="app">
      {topbar}
      <main className="game">
        <section className="board-area">
          <Board state={state} selected={selected} onSelect={(t) => setSelected(t === selected ? null : t)}>
            <ActionPanel state={state} me={me} names={names} act={act} />
            {selected !== null && (
              <div className="table-info">
                <TileInfo state={state} tile={selected} names={names} />
                <button type="button" className="tiny" onClick={() => setSelected(null)}>Close</button>
              </div>
            )}
          </Board>
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="side">
          <TradeOffer state={state} me={me} names={names} act={act} />
          <div className="block">
            <h2 className="label">Players</h2>
            <Players state={state} me={me} />
          </div>
          {me && !out && (
            <div className="block">
              <div className="block-head">
                <h2 className="label">Your properties</h2>
                <button type="button" className="tiny" disabled={!canOffer} onClick={() => setTrading(true)} title={canOffer ? "" : "On your turn, before or after rolling"}>
                  Trade…
                </button>
              </div>
              <MyProperties state={state} me={me} act={act} />
            </div>
          )}
          {seat === null && <p className="blurb">You're watching this game.</p>}
          <details className="block fold" open>
            <summary className="label">What's happened</summary>
            <Log state={state} names={names} />
          </details>
          <div className="block">
            <h2 className="label">Table talk</h2>
            <Chat messages={room.chat} onSend={say} />
          </div>
        </aside>
      </main>
      {trading && me && <TradeBuilder state={state} me={me} names={names} act={act} onClose={() => setTrading(false)} />}
      {state.phase === "finished" && state.winner && (
        <div className="winner-banner" style={{ "--win": tokenColor(state.winner) } as React.CSSProperties}>
          🏆 {state.winner === me ? `You win, ${names(state.winner)}!` : `${names(state.winner)} wins!`}
        </div>
      )}
    </div>
  );
}
