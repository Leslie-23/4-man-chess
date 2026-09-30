"use client";

import type { BotLevel, GameOptions } from "@fourman/monopoly-engine";
import { MONOPOLY_MAX_PLAYERS, type MonopolySeatPlan } from "@fourman/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { TopBar } from "../components/TopBar";
import { GAME_NAME, TAGLINE, TOKEN } from "../lib/look";
import { getSocket, loadName, saveName, saveToken } from "../lib/socket";

const PLAN_LABEL: Record<MonopolySeatPlan, string> = { friend: "Friend", easy: "Easy bot", hard: "Hard bot" };
const NEXT_PLAN: Record<MonopolySeatPlan, MonopolySeatPlan> = { friend: "easy", easy: "hard", hard: "friend" };

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [seats, setSeats] = useState<MonopolySeatPlan[]>(["hard", "easy", "hard"]);
  const [cash, setCash] = useState<GameOptions["startingCash"]>(1500);
  const [turnLimit, setTurnLimit] = useState<number | null>(120);
  const [jackpot, setJackpot] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(loadName() ?? ""), []);

  const needName = () => {
    if (name.trim()) return saveName(name.trim()), true;
    setError("Type your name first");
    return false;
  };

  const create = async () => {
    if (!needName()) return;
    setBusy(true);
    const result = await getSocket().emitWithAck("room:create", { name: name.trim(), seats, options: { startingCash: cash, turnLimit, parkingJackpot: jackpot } });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (result.token) saveToken(result.roomId, result.token);
    router.push(`/room/${result.roomId}`);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!needName()) return;
    if (code.trim().length === 5) router.push(`/room/${code.trim().toUpperCase()}`);
    else setError("Room codes are 5 letters");
  };

  const friends = seats.filter((s) => s === "friend").length;
  return (
    <div className="app">
      <TopBar />
      <main className="home">
        <section className="home-hero">
          <p className="eyebrow">{TAGLINE}</p>
          <h1>
            Buy the street.
            <br />
            Build the hotel.
            <br />
            <span className="hl">Bankrupt your friends.</span>
          </h1>
          <p className="lede">All the classic rules: auctions, jail, Chance, houses and hotels, mortgages and trading. Fill empty seats with bots.</p>
        </section>

        <section className="home-actions">
          <label className="field">
            <span className="label">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Type your name" />
          </label>

          <div className="block">
            <h2 className="label">New game · {seats.length + 1} players</h2>
            <ul className="seat-list">
              <li>
                <i className="token" style={{ background: TOKEN[0] }}>{(name || "Y")[0]}</i> You (host)
              </li>
              {seats.map((plan, i) => (
                <li key={i}>
                  <i className="token" style={{ background: TOKEN[i + 1] }}>{i + 2}</i>
                  <button type="button" className="tiny" onClick={() => setSeats(seats.map((p, j) => (j === i ? NEXT_PLAN[p] : p)))}>
                    {PLAN_LABEL[plan]} ↻
                  </button>
                  {seats.length > 1 && (
                    <button type="button" className="tiny ghost" onClick={() => setSeats(seats.filter((_, j) => j !== i))} aria-label="Remove seat">
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {seats.length + 1 < MONOPOLY_MAX_PLAYERS && (
              <button type="button" className="tiny" onClick={() => setSeats([...seats, "hard" as BotLevel])}>+ Add a seat</button>
            )}
            <div className="options">
              <label>
                Starting cash
                <select value={cash} onChange={(e) => setCash(Number(e.target.value))}>
                  {[1000, 1500, 2000].map((c) => <option key={c} value={c}>${c}</option>)}
                </select>
              </label>
              <label>
                Game length
                <select value={turnLimit ?? "none"} onChange={(e) => setTurnLimit(e.target.value === "none" ? null : Number(e.target.value))}>
                  <option value={60}>Quick · 60 turns</option>
                  <option value={120}>Standard · 120 turns</option>
                  <option value={200}>Long · 200 turns</option>
                  <option value="none">Until one is left</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={jackpot} onChange={(e) => setJackpot(e.target.checked)} /> Free Parking jackpot
              </label>
            </div>
            <p className="blurb">
              {turnLimit ? `When time's up, the richest player wins. ` : ""}
              {friends ? "You'll get a code to send your friends." : "Starts right away."}
            </p>
            <button type="button" className="primary wide" disabled={busy} onClick={() => void create()}>
              {friends ? "Create game & get code" : "Start game"}
            </button>
          </div>

          <form className="block" onSubmit={join}>
            <h2 className="label">Join a friend</h2>
            <div className="inline">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="ROOM CODE" aria-label="Room code" className="code" />
              <button type="submit">Join</button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
          <p className="muted small">{GAME_NAME} shares its game server with 4-Man Chess. If it's been asleep, the first game can take a minute to start.</p>
        </section>
      </main>
    </div>
  );
}
