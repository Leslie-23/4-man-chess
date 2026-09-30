"use client";

import { BOT_LEVELS, chooseBotMove, type BotLevel, type PlayerColor } from "@fourman/game-engine";
import type { RoomView, SeatPlan } from "@fourman/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Board } from "../../../components/Board";
import { Segmented, ThemePicker } from "../../../components/Controls";
import { MoveLog } from "../../../components/MoveLog";
import { PlayerPlate } from "../../../components/PlayerPlate";
import { SeatPlanner } from "../../../components/SeatPlanner";
import { useLocalSetting } from "../../../lib/settings";
import { getSocket, loadName, saveName } from "../../../lib/socket";
import { BOARD_THEME_IDS, BOT_LEVEL_INFO, themeById, type BoardThemeId } from "../../../lib/themes";
import { useRoom } from "../../../lib/useRoom";
import { VARIANT_INFO } from "../../../lib/variants";

const AUTO_DELAY_MS = 800;
const LEVEL_OPTIONS = BOT_LEVELS.map((l) => ({ value: l, label: BOT_LEVEL_INFO[l].name }));
const label = (c: PlayerColor) => c[0]!.toUpperCase() + c.slice(1);

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
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (!draft.trim()) return;
      saveName(draft.trim());
      setName(draft.trim());
    };
    return (
      <div className="app">
        <TopBar />
        <main className="center">
          <form className="block card" onSubmit={submit}>
            <h1 className="label">Join room {id.toUpperCase()}</h1>
            <label className="field">
              <span className="label">Your name</span>
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20} />
            </label>
            <button type="submit" className="primary wide">Take a seat</button>
          </form>
        </main>
      </div>
    );
  }
  return <Room id={id} name={name} />;
}

function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="wordmark">4-Man Chess</Link>
      {children}
    </header>
  );
}

function Room({ id, name }: { id: string; name: string }) {
  const { room, color, connected, error, move, start, resign } = useRoom(id, name);
  const [copied, setCopied] = useState(false);
  const [auto, setAuto] = useState(false);
  const [autoLevel, setAutoLevel] = useLocalSetting<BotLevel>("fourman:auto-level", "hard", BOT_LEVELS);
  const [themeId, setThemeId] = useLocalSetting<BoardThemeId>("fourman:board-theme", "classic", BOARD_THEME_IDS);
  const [hostError, setHostError] = useState<string | null>(null);

  // Auto mode: when it's our turn, the bot picks and sends the move for us.
  const myTurnAtPly = room?.phase === "playing" && color === room.state.currentPlayer ? room.state.ply : null;
  useEffect(() => {
    if (!auto || myTurnAtPly === null || !room) return;
    const timer = setTimeout(() => {
      const next = chooseBotMove(room.state, Math.random, autoLevel);
      if (next) void move(next);
    }, AUTO_DELAY_MS);
    return () => clearTimeout(timer);
    // `room` changes with every update; the ply is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, myTurnAtPly, autoLevel]);

  if (!room) {
    return (
      <div className="app">
        <TopBar />
        <main className="center">
          <div className="block card">
            <p className="label">{error ? "Can't join" : "Connecting…"}</p>
            {error && <p className="error">{error}</p>}
            {error && <Link href="/" className="button primary wide">Back to start</Link>}
          </div>
        </main>
      </div>
    );
  }

  const { state, players } = room;
  const out = new Set(state.eliminations.map((e) => e.player));
  const isHost = color === room.host;
  const myTurn = room.phase === "playing" && color === state.currentPlayer;
  const shareUrl = `${window.location.origin}/room/${room.id}`;
  const onLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const perspective = color ?? players[0]!;
  const info = VARIANT_INFO[room.variant];

  const setSeat = async (seat: PlayerColor, plan: SeatPlan) => {
    const result = await getSocket().emitWithAck("room:set-seat", { roomId: room.id, color: seat, plan });
    setHostError(result.ok ? null : result.error);
  };

  const plates = Object.fromEntries(
    players.map((c) => [
      c,
      <PlayerPlate
        key={c}
        color={c}
        seat={room.seats[c] ?? null}
        state={state}
        isTurn={room.phase === "playing" && state.currentPlayer === c}
        isYou={c === color}
        waiting={room.phase === "lobby" && room.plan[c] === "friend" && !room.seats[c]}
      />,
    ]),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this invite link", shareUrl);
    }
  };

  return (
    <div className="app">
      <TopBar>
        <div className="room-chip">
          <span className="label">Room</span>
          <strong>{room.id}</strong>
          <button type="button" className="tiny" onClick={() => void copy()}>{copied ? "Copied" : "Copy invite"}</button>
        </div>
        <span className={connected ? "conn live" : "conn"}>{connected ? "Live" : "Reconnecting"}</span>
      </TopBar>

      <main className="game">
        <section className="board-area">
          <Board state={state} perspective={perspective} theme={themeById(themeId)} playable={myTurn ? color : null} onMove={(m) => void move(m)} plates={plates} />
        </section>

        <aside className="sidebar">
          <div className={myTurn ? "status mine" : "status"}>
            <span className="label">{room.phase === "lobby" ? "Lobby" : room.phase === "finished" ? "Game over" : `Move ${Math.floor(state.ply / players.length) + 1}`}</span>
            <p>{statusLine(room, color)}</p>
          </div>
          {(error || hostError) && <p className="error">{error ?? hostError}</p>}

          {room.phase === "lobby" && (
            <div className="block">
              <h2 className="label">Seats · {info.players}-player {info.name}</h2>
              <SeatPlanner
                rows={players
                  .filter((c) => c !== room.host)
                  .map((c) => {
                    const seat = room.seats[c];
                    return { color: c, plan: room.plan[c] ?? "friend", ...(seat && !seat.bot && { occupant: seat.name }) };
                  })}
                onChange={(c, plan) => void setSeat(c, plan)}
                disabled={!isHost}
              />
              <p className="blurb">
                {isHost
                  ? "Send friends the code for their seats, or switch a seat to a bot. The game starts by itself once every seat is filled."
                  : "Waiting for the host to start. It also starts by itself once every seat is filled."}
              </p>
              {isHost && players.filter((c) => room.seats[c]).length >= 2 && (
                <button type="button" className="primary wide" onClick={() => void start()}>Start now (open seats sit out)</button>
              )}
              {onLocalhost && (
                <p className="note">Friends can't open a localhost link. Open this page through your computer's network address before you share it.</p>
              )}
            </div>
          )}

          {room.phase !== "lobby" && color && !out.has(color) && room.phase === "playing" && (
            <div className="block">
              <h2 className="label">Auto mode</h2>
              <label className="toggle">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                <span>{auto ? "On: a bot is playing your moves" : "Off: let a bot play for you and watch"}</span>
              </label>
              <Segmented label="Auto mode strength" value={autoLevel} options={LEVEL_OPTIONS} onChange={setAutoLevel} />
              <button type="button" className="danger wide" onClick={() => confirm("Resign this game?") && void resign()}>Resign</button>
            </div>
          )}
          {color === null && <p className="blurb">You're watching. The room was full or already under way.</p>}

          <div className="block">
            <h2 className="label">Board theme</h2>
            <ThemePicker value={themeId} onChange={setThemeId} />
          </div>

          <div className="block">
            <h2 className="label">Moves</h2>
            <MoveLog room={room} />
          </div>

          <details className="block rules">
            <summary className="label">How to play · {info.players} players</summary>
            <ol>
              {info.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </details>
        </aside>
      </main>
    </div>
  );
}

function statusLine(room: RoomView, color: PlayerColor | null): string {
  const { state, seats, players } = room;
  const who = (c: PlayerColor) => seats[c]?.name ?? label(c);
  if (room.phase === "lobby") return `Waiting for players · ${players.filter((c) => seats[c]).length}/${players.length}`;
  if (state.status === "finished") {
    if (state.winner) return state.winner === color ? "You win!" : `${who(state.winner)} wins`;
    if (state.drawReason === "only-kings") return "Draw · only kings left";
    if (state.drawReason === "stalemate") return "Draw · stalemate";
    return "Draw · 50 moves without progress";
  }
  if (color && state.eliminations.some((e) => e.player === color)) return `You're out · ${who(state.currentPlayer)} to move`;
  if (color === state.currentPlayer) return "Your move";
  return `${who(state.currentPlayer)} (${label(state.currentPlayer)}) to move`;
}
