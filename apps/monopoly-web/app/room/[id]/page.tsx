"use client";

import { currentActor } from "@fourman/monopoly-engine";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

const ON_OFF = ["on", "off"] as const;
import { ActionPanel } from "../../../components/ActionPanel";
import { Board } from "../../../components/Board";
import { Chat } from "../../../components/Chat";
import { CoachCard, HintsCard, HowToPlay, hintTiles, useSuggestion } from "../../../components/Helpers";
import { Log, MyProperties, Players, TileInfo } from "../../../components/SidePanels";
import { TopBar } from "../../../components/TopBar";
import { TradeBuilder, TradeOffer } from "../../../components/Trade";
import { WorthChart } from "../../../components/WorthChart";
import { TOKEN, money, tokenColor } from "../../../lib/look";
import { useLocalSetting } from "../../../lib/settings";
import { useVoice } from "../../../lib/useVoice";
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
  const { room, seat, me, connected, error, act, start, say, askCoach } = useRoom(id, name);
  const voice = useVoice(id);
  const [hintSetting, setHintSetting] = useLocalSetting<"on" | "off">("tycoon:hints", "off", ON_OFF);
  const hintsOn = hintSetting === "on";
  const suggestion = useSuggestion(room?.state ?? null, me, hintsOn);
  const hinted = useMemo(() => (room?.state ? hintTiles(room.state, suggestion) : new Set<number>()), [room?.state, suggestion]);
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
  const actor = currentActor(state);
  const myTurn = me !== null && actor === me && !state.trade;
  const canOffer = myTurn && (state.phase === "roll" || state.phase === "end") && !state.offered;
  const out = me ? state.players.find((p) => p.id === me)?.bankrupt : false;
  const playing = me !== null && !out && state.phase !== "finished";
  const status =
    state.phase === "finished"
      ? state.winner === me
        ? "You win!"
        : `${state.winner ? names(state.winner) : "Nobody"} wins`
      : state.trade
        ? state.trade.to === me
          ? "Answer the trade offer"
          : `${names(state.trade.to)} is weighing a trade`
        : myTurn
          ? "Your move"
          : `${actor ? names(actor) : ""}'s move`;

  return (
    <div className="app room-app">
      {topbar}
      <main className="game">
        {/* Left: who's winning and how the game is going. */}
        <aside className="rail rail-left" aria-label="Standings">
          <div className="block">
            <h2 className="label">Standings</h2>
            <Players state={state} me={me} onVoice={voice.present} speaking={voice.speaking} />
            <WorthChart state={state} names={names} />
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
          <details className="block fold">
            <summary className="label">What's happened</summary>
            <Log state={state} names={names} />
          </details>
          <details className="block fold">
            <summary className="label">How to play</summary>
            <HowToPlay turnLimit={state.options.turnLimit} />
          </details>
        </aside>

        {/* Centre: the table, with this player's helpers side by side underneath. */}
        <section className="board-col">
          <Board state={state} selected={selected} onSelect={(t) => setSelected(t === selected ? null : t)} hinted={hinted} speaking={voice.speaking}>
            <ActionPanel state={state} me={me} names={names} act={act} />
            {selected !== null && (
              <div className="table-info">
                <TileInfo state={state} tile={selected} names={names} />
                <button type="button" className="tiny" onClick={() => setSelected(null)}>Close</button>
              </div>
            )}
          </Board>
          {playing && (
            <div className="board-controls">
              <HintsCard state={state} on={hintsOn} onToggle={(on) => setHintSetting(on ? "on" : "off")} suggestion={suggestion} act={act} />
              {room.coach && <CoachCard ask={askCoach} />}
            </div>
          )}
        </section>

        {/* Right: what's happening now, voice, and the table's chat. */}
        <aside className="rail rail-right" aria-label="Status and chat">
          <div className={myTurn ? "status mine" : "status"}>
            <span className="label">{state.phase === "finished" ? "Game over" : `Turn ${state.turn}${state.options.turnLimit ? ` of ${state.options.turnLimit}` : ""}`}</span>
            <p>{status}</p>
            {me && !out && <span className="status-cash">{money(state.players.find((p) => p.id === me)!.cash)} in hand</span>}
          </div>
          {error && <p className="error">{error}</p>}
          <TradeOffer state={state} me={me} names={names} act={act} />
          {seat === null && <p className="blurb">You're watching this game.</p>}
          {room.voice && (
            <div className="block voice">
              <h2 className="label">Voice</h2>
              {voice.status === "on" ? (
                <>
                  <p className="voice-line">
                    <span className="voice-dot" /> {voice.present.size === 1 ? "Just you so far" : `${voice.present.size} at the table`}
                    {!voice.canTalk && " · you're listening"}
                  </p>
                  <div className="row">
                    {voice.canTalk && (
                      <button type="button" className={voice.muted ? "primary" : undefined} onClick={() => void voice.toggleMute()}>
                        {voice.muted ? "Unmute" : "Mute"}
                      </button>
                    )}
                    <button type="button" onClick={voice.leave}>Leave voice</button>
                  </div>
                </>
              ) : (
                <button type="button" className="primary wide" disabled={voice.status === "joining"} onClick={() => void voice.join()}>
                  {voice.status === "joining" ? "Joining…" : seat !== null ? "Join voice" : "Listen in"}
                </button>
              )}
              {voice.error && <p className="error">{voice.error}</p>}
            </div>
          )}
          <div className="block chat-block">
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
