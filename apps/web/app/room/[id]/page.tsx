"use client";

import { BOT_LEVELS, chooseBotMove, createGame, getVariant, type BotLevel, type PlayerColor } from "@fourman/game-engine";
import type { RoomView, SeatPlan } from "@fourman/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Board } from "../../../components/Board";
import { Chat } from "../../../components/Chat";
import { Segmented, ThemePicker } from "../../../components/Controls";
import { MoveLog } from "../../../components/MoveLog";
import { PlayerPlate } from "../../../components/PlayerPlate";
import { SeatPlanner } from "../../../components/SeatPlanner";
import { Standings } from "../../../components/Standings";
import { TopBar } from "../../../components/TopBar";
import { WinCelebration } from "../../../components/WinCelebration";
import { useHints } from "../../../lib/hints";
import { useLocalSetting } from "../../../lib/settings";
import { useVoice } from "../../../lib/useVoice";
import { clock, useCountdown } from "../../../lib/useCountdown";
import { getSocket, loadName, saveName } from "../../../lib/socket";
import { BOARD_THEME_IDS, BOT_LEVEL_INFO, themeById, type BoardThemeId } from "../../../lib/themes";
import { useRoom } from "../../../lib/useRoom";
import { VARIANT_INFO } from "../../../lib/variants";

const AUTO_DELAY_MS = 800;
const LEVEL_OPTIONS = BOT_LEVELS.map((l) => ({ value: l, label: BOT_LEVEL_INFO[l].name }));
const label = (c: PlayerColor) => c[0]!.toUpperCase() + c.slice(1);
const ON_OFF = ["on", "off"] as const;
/** Army colours for canvas drawing, matching the CSS tokens. */
const ARMY_HEX: Record<PlayerColor, string> = {
  red: "#d7362d",
  blue: "#2b6be0",
  yellow: "#e0a810",
  green: "#229a4f",
  white: "#9a9a92",
  black: "#1b1b1b",
};
/** Stands in for the game until the room arrives, so hooks run in the same order every render. */
const EMPTY_STATE = createGame();

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

function Room({ id, name }: { id: string; name: string }) {
  const { room, color, connected, error, move, start, resign, say, startPoll, vote, askCoach, turnDeadline, pollDeadline } = useRoom(id, name);
  const secondsLeft = useCountdown(turnDeadline);
  const voice = useVoice(id);
  // Celebrate when we see the game end live, not every time a finished room is reopened.
  const [celebrate, setCelebrate] = useState(false);
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (lastPhase.current === "playing" && room?.phase === "finished") setCelebrate(true);
    lastPhase.current = room?.phase ?? null;
  }, [room?.phase]);
  const [advice, setAdvice] = useState<{ text: string; ply: number } | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [auto, setAuto] = useState(false);
  const [autoLevel, setAutoLevel] = useLocalSetting<BotLevel>("fourman:auto-level", "hard", BOT_LEVELS);
  const [themeId, setThemeId] = useLocalSetting<BoardThemeId>("fourman:board-theme", "classic", BOARD_THEME_IDS);
  const [hostError, setHostError] = useState<string | null>(null);
  const [hintSetting, setHintSetting] = useLocalSetting<"on" | "off">("fourman:hints", "off", ON_OFF);
  const hintsOn = hintSetting === "on";
  const hints = useHints(room?.state ?? EMPTY_STATE, color, hintsOn && room?.phase === "playing");

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
  const who = (c: PlayerColor) => room.seats[c]?.name ?? label(c);
  const suggestion = hints.suggestion;
  const victim = suggestion?.capture ? state.board[getVariant(state.variant).indexOf(suggestion.to)]?.color : undefined;
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
        onVoice={voice.present.has(c)}
        speaking={voice.speaking.has(c)}
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

  const playingSeat = room.phase === "playing" && color !== null && !out.has(color);
  const seatedPerson = color !== null && Boolean(room.seats[color]) && !room.seats[color]?.bot;

  const coach = async () => {
    setCoaching(true);
    const result = await askCoach();
    setCoaching(false);
    setCoachError(result.ok ? null : result.error);
    if (result.ok) setAdvice({ text: result.advice, ply: state.ply });
  };

  return (
    <div className="app room-app">
      <TopBar>
        <div className="room-chip">
          <span className="label">Room</span>
          <strong>{room.id}</strong>
          <button type="button" className="tiny" onClick={() => void copy()}>{copied ? "Copied" : "Copy invite"}</button>
        </div>
        <span className={connected ? "conn live" : "conn"}>{connected ? "Live" : "Reconnecting"}</span>
      </TopBar>

      {celebrate && (
        <WinCelebration
          name={state.winner ? who(state.winner) : null}
          color={state.winner ? ARMY_HEX[state.winner] : null}
          isYou={state.winner !== null && state.winner === color}
          onClose={() => setCelebrate(false)}
        />
      )}

      <main className="game">
        {/* Left: how the game is going. */}
        <aside className="sidebar rail-left" aria-label="Standings and moves">
          {room.phase !== "lobby" && (
            <div className="block">
              <h2 className="label">Standings</h2>
              <Standings room={room} />
            </div>
          )}
          <details className="block fold" open={room.phase !== "lobby"}>
            <summary className="label">Moves</summary>
            <MoveLog room={room} />
          </details>
          <details className="block fold">
            <summary className="label">How to play · {info.players} players</summary>
            <ol className="rules-list">
              {info.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </details>
          <details className="block fold">
            <summary className="label">Board theme</summary>
            <ThemePicker value={themeId} onChange={setThemeId} />
          </details>
        </aside>

        {/* Centre: the board, with this player's controls side by side underneath. */}
        <section className="board-col">
          <div className="board-area">
            <Board state={state} perspective={perspective} theme={themeById(themeId)} playable={myTurn ? color : null} onMove={(m) => void move(m)} plates={plates}
              hints={hintsOn ? { move: suggestion, danger: hints.danger } : undefined}
            />
          </div>
          {playingSeat && (
            <div className="board-controls">
              <div className="control-card">
                <label className="toggle">
                  <input type="checkbox" checked={hintsOn} onChange={(e) => setHintSetting(e.target.checked ? "on" : "off")} />
                  <span><strong>Hints</strong> {hintsOn ? "on" : "off"}</span>
                </label>
                {hintsOn ? (
                  <div className="hint-card">
                    {hints.inCheck && <p><strong>You're in check.</strong> Move your king, block, or take the attacker.</p>}
                    {suggestion ? (
                      <p>
                        <span className="hint-key from" /> <span className="hint-key to" /> Try your <strong>{suggestion.piece}</strong> {suggestion.from} → {suggestion.to}
                        {suggestion.capture && <>, taking {victim ? `${who(victim)}'s` : "a"} {suggestion.capture}</>}
                        {suggestion.castle && <> (castling {suggestion.castle})</>}.{" "}
                        <button type="button" className="tiny" onClick={() => void move({ from: suggestion.from, to: suggestion.to, ...(suggestion.promotion && { promotion: suggestion.promotion }) })}>
                          Play it
                        </button>
                      </p>
                    ) : (
                      <p className="muted">A suggested move appears on your turn.</p>
                    )}
                    {hints.danger.size > 0 && (
                      <p>
                        <span className="hint-key danger" /> {hints.danger.size === 1 ? "1 piece" : `${hints.danger.size} pieces`} can be taken next turn.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="blurb">Marks a good move and pieces in danger. Handy while you learn.</p>
                )}
              </div>
              <div className="control-card">
                <label className="toggle">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                  <span><strong>Auto mode</strong> {auto ? "on: a bot plays for you" : "off"}</span>
                </label>
                <Segmented label="Auto mode strength" value={autoLevel} options={LEVEL_OPTIONS} onChange={setAutoLevel} />
                <button type="button" className="danger wide" onClick={() => confirm("Resign this game?") && void resign()}>Resign</button>
              </div>
              {room.coach && (
                <div className="control-card">
                  <span className="toggle-like"><span><strong>Coach</strong> explains the position</span></span>
                  {advice && <p className={advice.ply === state.ply ? "coach-advice" : "coach-advice stale"}>{advice.text}</p>}
                  {advice && advice.ply !== state.ply && <p className="muted small-text">That was a few moves ago.</p>}
                  {!advice && <p className="blurb">Stuck? Ask for a plain-English read of the board and the move worth playing.</p>}
                  {coachError && <p className="error">{coachError}</p>}
                  <button type="button" className="wide" disabled={coaching} onClick={() => void coach()}>
                    {coaching ? "Thinking…" : advice ? "Ask again" : "Ask the coach"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right: what's happening now, and the table's chat. */}
        <aside className="sidebar rail-right" aria-label="Game status and chat">
          <div className={myTurn ? "status mine" : "status"}>
            <span className="label">{room.phase === "lobby" ? "Lobby" : room.phase === "finished" ? "Game over" : `Move ${Math.floor(state.ply / players.length) + 1}`}</span>
            <p>{statusLine(room, color)}</p>
            {secondsLeft !== null && room.phase === "playing" && (
              <span className={secondsLeft <= 5 ? "turn-clock urgent" : "turn-clock"} aria-live={secondsLeft <= 5 ? "assertive" : "off"}>
                {clock(secondsLeft)} <span className="muted-inline">left for {state.currentPlayer === color ? "you" : who(state.currentPlayer)}</span>
              </span>
            )}
          </div>
          {(error || hostError) && <p className="error">{error ?? hostError}</p>}
          {room.phase === "finished" && (
            <Link href="/leaderboard" className="button primary wide">See the leaderboard</Link>
          )}
          {color === null && <p className="blurb">You're watching. The room was full or already under way.</p>}

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
                  {voice.status === "joining" ? "Joining…" : color ? "Join voice" : "Listen in"}
                </button>
              )}
              {voice.error && <p className="error">{voice.error}</p>}
            </div>
          )}

          <div className="block chat-block">
            <h2 className="label">Table talk</h2>
            <Chat
              messages={room.chat ?? []}
              color={color}
              onSend={say}
              poll={room.poll ?? null}
              pollDeadline={pollDeadline}
              moveSeconds={room.moveSeconds ?? null}
              canStartPoll={seatedPerson && room.phase !== "finished"}
              onStartPoll={startPoll}
              onVote={vote}
              who={who}
            />
          </div>
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
