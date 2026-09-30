"use client";

import { VARIANT_IDS, getVariant, type PlayerColor, type VariantId } from "@fourman/game-engine";
import type { SeatPlan } from "@fourman/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BoardSlides } from "../components/BoardSlides";
import { Segmented, ThemePicker } from "../components/Controls";
import { SeatPlanner, describePlan } from "../components/SeatPlanner";
import { TopBar } from "../components/TopBar";
import { useLocalSetting } from "../lib/settings";
import { getSocket, loadName, saveName, saveToken } from "../lib/socket";
import { BOARD_THEME_IDS, themeById, type BoardThemeId } from "../lib/themes";
import { VARIANT_INFO } from "../lib/variants";

const BOARD_OPTIONS = VARIANT_IDS.map((id) => ({ value: id, label: `${VARIANT_INFO[id].players} players` }));

export default function Opener() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useLocalSetting<VariantId>("fourman:variant", "four", VARIANT_IDS);
  const [themeId, setThemeId] = useLocalSetting<BoardThemeId>("fourman:board-theme", "classic", BOARD_THEME_IDS);
  // Plans for every colour; each board uses the seats it has. Defaults: a hard bot everywhere.
  const [plans, setPlans] = useState<Partial<Record<PlayerColor, SeatPlan>>>({});
  const setup = useRef<HTMLDivElement>(null);

  useEffect(() => setName(loadName() ?? ""), []);

  const opponents = getVariant(variant).players.slice(1);
  const seatPlans = opponents.map((c) => plans[c] ?? "hard");
  const friends = seatPlans.filter((p) => p === "friend").length;

  const pick = (id: VariantId) => {
    setVariant(id);
    setup.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const create = async () => {
    if (!name.trim()) return setError("Enter your name first");
    saveName(name.trim());
    setBusy(true);
    setError(null);
    const created = await getSocket().emitWithAck("room:create", { name: name.trim(), variant, seats: seatPlans });
    setBusy(false);
    if (!created.ok) return setError(created.error);
    saveToken(created.roomId, created.token!);
    router.push(`/room/${created.roomId}`);
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Enter your name first");
    if (!/^[A-Za-z0-9]{5}$/.test(code.trim())) return setError("Room codes are 5 letters or digits");
    saveName(name.trim());
    router.push(`/room/${code.trim().toUpperCase()}`);
  };

  return (
    <div className="app">
      <TopBar>
        <span className="topbar-note">2, 3 or 4 players · friends or bots</span>
      </TopBar>

      <main>
        <div className="opener">
          <section className="hero">
            <h1>
              Chess for
              <br />
              everyone at
              <br />
              the table.
            </h1>
            <BoardSlides theme={themeById(themeId)} onPick={pick} />
          </section>

          <section className="actions" ref={setup}>
            <label className="field">
              <span className="label">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Type your name" autoComplete="nickname" />
            </label>

            <div className="block">
              <h2 className="label">01 · New game</h2>
              <Segmented label="Board" value={variant} options={BOARD_OPTIONS} onChange={setVariant} />
              <p className="blurb">
                <strong>{VARIANT_INFO[variant].name}.</strong> {VARIANT_INFO[variant].tagline}
              </p>
              <span className="label muted-label">Opponents</span>
              <SeatPlanner
                rows={opponents.map((color, i) => ({ color, plan: seatPlans[i]! }))}
                onChange={(color, plan) => setPlans((p) => ({ ...p, [color]: plan }))}
              />
              <p className="blurb">
                {describePlan(seatPlans)}. {friends ? "You'll get a code to send your friends; the game starts when they're in." : "Starts right away."}
              </p>
              <button type="button" className="primary wide" disabled={busy} onClick={() => void create()}>
                {friends ? "Create game & get code" : "Start game"}
              </button>
            </div>

            <form className="block" onSubmit={join}>
              <h2 className="label">02 · Join a friend</h2>
              <div className="inline">
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="ROOM CODE" aria-label="Room code" className="code-input" />
                <button type="submit">Join</button>
              </div>
            </form>

            <div className="block">
              <h2 className="label">03 · Leaderboard</h2>
              <p className="blurb">Who's winning, people and bots, over the last day, week or all time.</p>
              <Link href="/leaderboard" className="button wide">See who's winning</Link>
            </div>

            <details className="block fold">
              <summary className="label">04 · Board theme</summary>
              <ThemePicker value={themeId} onChange={setThemeId} />
              <p className="blurb">Saved on this device only. Your friends keep their own.</p>
            </details>

            {error && <p className="error">{error}</p>}
          </section>
        </div>

        <About onPick={pick} />
      </main>
    </div>
  );
}

function About({ onPick }: { onPick: (variant: VariantId) => void }) {
  return (
    <div className="about">
      <section className="about-intro">
        <span className="label">What we're going for</span>
        <h2>Chess works beautifully for two. We want it to work just as well for three and four.</h2>
        <p>
          Game night rarely has exactly two players. 4-Man Chess keeps the rules you already know and changes only what
          has to change when more armies share a board. Every seat is identical, so nobody starts with an edge. Send a
          code to friends, fill empty chairs with bots, and play in the browser on any device.
        </p>
      </section>

      <section className="pillars">
        {[
          ["Same chess, more players", "Pieces move exactly as they always have. The only new rules are the ones a bigger board needs: who moves next, and what happens when a king falls."],
          ["Every seat is fair", "Each board is symmetric: rotate it and every army's position is the same. Turn order runs clockwise, so everyone always knows who's next."],
          ["Play whoever's around", "Friends join with a five-letter code. Bots come in three levels: Easy for learning, Hard for a game, Advanced for a fight. Auto mode lets a bot play your seat so you can watch."],
          ["One engine underneath", "The same rules engine runs on the server and in your browser. Every move is checked by the server, so what you see is exactly what your friends see."],
        ].map(([title, body], i) => (
          <article key={title} className="pillar">
            <span className="label">{String(i + 1).padStart(2, "0")}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="boards-table">
        <span className="label">The three boards</span>
        <div className="board-cards">
          {VARIANT_IDS.map((id) => {
            const info = VARIANT_INFO[id];
            return (
              <article key={id} className="board-card">
                <header>
                  <strong>{info.players}</strong>
                  <span>
                    players · {info.name}
                    <br />
                    {info.squares} squares
                  </span>
                </header>
                <ul>
                  {info.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <button type="button" onClick={() => onPick(id)}>Play {info.players}-player</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="steps">
        <span className="label">How a game works</span>
        <ol>
          <li><strong>Pick a board.</strong> 2, 3 or 4 players.</li>
          <li><strong>Fill the seats.</strong> Each one is a friend or a bot: Easy, Hard or Advanced.</li>
          <li><strong>Share the code.</strong> Friends open the link on a phone or laptop and take their seat.</li>
          <li><strong>Play.</strong> Every move appears on every screen at once. Last king standing wins.</li>
        </ol>
      </section>

      <section className="roadmap">
        <span className="label">What's next</span>
        <ul>
          <li>Chess clocks and timed games</li>
          <li>Choose your promotion piece</li>
          <li>Accounts, ratings and game history</li>
          <li>2v2 team games on the cross board</li>
          <li>Phone app</li>
        </ul>
      </section>
    </div>
  );
}
