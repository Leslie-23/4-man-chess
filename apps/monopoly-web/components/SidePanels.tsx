"use client";

import { BOARD, currentActor, groupOf, netWorth, rentFor, unmortgageCost, type Action, type GameState } from "@fourman/monopoly-engine";
import { GROUP_COLOR, money, tokenColor } from "../lib/look";

/** Everyone at the table: cash, net worth, and who's in jail or out. */
export function Players({ state, me }: { state: GameState; me: string | null }) {
  const current = state.players[state.current]!.id;
  const ranked = [...state.players].sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id));
  return (
    <ol className="players">
      {ranked.map((p) => (
        <li key={p.id} className={[p.id === current && "current", p.bankrupt && "out", p.id === me && "me"].filter(Boolean).join(" ")}>
          <i className="token" style={{ background: tokenColor(p.id) }}>{p.name[0]}</i>
          <span className="player-name">
            {p.name}
            {p.id === me && <span className="tag">you</span>}
            {p.inJail && <span className="tag">jail</span>}
            {p.jailCards > 0 && <span className="tag">🗝 {p.jailCards}</span>}
          </span>
          <span className="num">{p.bankrupt ? "out" : money(p.cash)}</span>
          <span className="num muted" title="Net worth">{p.bankrupt ? "" : money(netWorth(state, p.id))}</span>
        </li>
      ))}
    </ol>
  );
}

/** Details for a tapped square: price, rents, owner, and what's built. */
export function TileInfo({ state, tile, names }: { state: GameState; tile: number; names: (id: string) => string }) {
  const info = BOARD[tile]!;
  const deed = state.deeds[tile];
  return (
    <div className="tile-info">
      {info.group && <span className="band wide" style={{ background: GROUP_COLOR[info.group] }} />}
      <strong>{info.name}</strong>
      {info.price !== undefined && <span>Price {money(info.price)} · mortgage {money(info.price / 2)}</span>}
      {info.rent && (
        <table className="rents">
          <tbody>
            {["Rent", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"].map((label, i) => (
              <tr key={label} className={deed?.houses === i && deed.owner ? "now" : undefined}>
                <td>{label}</td>
                <td className="num">{money(info.rent![i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {info.houseCost && <span className="muted small">Houses {money(info.houseCost)} each. A full set doubles the bare rent.</span>}
      {info.kind === "station" && <span className="muted small">Rent 25 / 50 / 100 / 200 for 1–4 stations owned.</span>}
      {info.kind === "utility" && <span className="muted small">Rent is 4× the dice, or 10× with both utilities.</span>}
      {deed && (
        <span>
          {deed.owner ? `Owned by ${names(deed.owner)}${deed.mortgaged ? " · mortgaged" : ""} · rent now ${money(rentFor(state, tile, 7))}${info.kind === "utility" ? " on a 7" : ""}` : "For sale"}
        </span>
      )}
      {info.tax && <span>Pay {money(info.tax)} to the bank.</span>}
    </div>
  );
}

/** Our squares by colour set, with build, sell and mortgage buttons where the rules allow. */
export function MyProperties({ state, me, act }: { state: GameState; me: string; act: (a: Action) => Promise<boolean> }) {
  const mine = state.deeds.flatMap((d, i) => (d?.owner === me ? [i] : []));
  const myTurn = currentActor(state) === me && !state.trade;
  const canManage = myTurn && ["roll", "end", "debt", "buy"].includes(state.phase);
  const canBuild = myTurn && ["roll", "end"].includes(state.phase);
  const cash = state.players.find((p) => p.id === me)!.cash;
  if (mine.length === 0) return <p className="muted small">You don't own anything yet. Land on a square to buy it.</p>;

  return (
    <ul className="props">
      {mine.map((i) => {
        const tile = BOARD[i]!;
        const deed = state.deeds[i]!;
        const group = tile.group ? groupOf(tile.group) : [];
        const fullSet = group.length > 0 && group.every((g) => state.deeds[g]!.owner === me && !state.deeds[g]!.mortgaged);
        const minH = Math.min(...group.map((g) => state.deeds[g]!.houses));
        const maxH = Math.max(...group.map((g) => state.deeds[g]!.houses));
        const setBuilt = group.some((g) => state.deeds[g]!.houses > 0);
        return (
          <li key={i} className={deed.mortgaged ? "mortgaged" : undefined}>
            <span className="band" style={{ background: tile.group ? GROUP_COLOR[tile.group] : "var(--muted)" }} />
            <span className="prop-name">
              {tile.name}
              <span className="muted small">
                {deed.mortgaged ? " mortgaged" : deed.houses === 5 ? " hotel" : deed.houses > 0 ? ` ${deed.houses}🏠` : ""}
              </span>
            </span>
            <span className="prop-actions">
              {fullSet && deed.houses < 5 && deed.houses === minH && (
                <button type="button" className="tiny" disabled={!canBuild || cash < tile.houseCost!} onClick={() => void act({ type: "build", tile: i })}>
                  +{deed.houses === 4 ? "hotel" : "house"}
                </button>
              )}
              {deed.houses > 0 && deed.houses === maxH && (
                <button type="button" className="tiny" disabled={!canManage} onClick={() => void act({ type: "sell-house", tile: i })}>
                  sell
                </button>
              )}
              {!deed.mortgaged && !setBuilt && (
                <button type="button" className="tiny" disabled={!canManage} onClick={() => void act({ type: "mortgage", tile: i })}>
                  mortgage +{money(tile.price! / 2)}
                </button>
              )}
              {deed.mortgaged && (
                <button type="button" className="tiny" disabled={!canBuild || cash < unmortgageCost(i)} onClick={() => void act({ type: "unmortgage", tile: i })}>
                  pay off {money(unmortgageCost(i))}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The game's running commentary, newest first. */
export function Log({ state, names }: { state: GameState; names: (id: string) => string }) {
  return (
    <ol className="log">
      {[...state.log].reverse().slice(0, 60).map((e, i) => (
        <li key={`${state.log.length - i}`}>
          {e.player && <i className="dot" style={{ background: tokenColor(e.player) }} />}
          <span>
            {e.player && <strong>{names(e.player)} </strong>}
            {e.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
