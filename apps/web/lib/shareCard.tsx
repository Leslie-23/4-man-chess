import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BrandMark } from "../components/BrandMark";

/** Open Graph images are 1200×630: the size link previews expect. */
export const SHARE_SIZE = { width: 1200, height: 630 };

const INK = "#0b0b0b";
const PAPER = "#fbfbf8";
const LIGHT = "#ede3cf";
const DARK = "#b59c77";
const ARMY = { red: "#d7362d", blue: "#2b6be0", yellow: "#e0a810", green: "#229a4f" };

// The same files the site loads, read once. next/og takes woff but not woff2.
const font = (pkg: string, file: string) => readFile(join(process.cwd(), "node_modules/@fontsource", pkg, "files", file));
const fonts = Promise.all([
  font("space-grotesk", "space-grotesk-latin-700-normal.woff"),
  font("jetbrains-mono", "jetbrains-mono-latin-700-normal.woff"),
]);

/** Which army starts on a square of the 14×14 cross, and whether it's the back rank. */
function armyAt(x: number, y: number): { color: string; back: boolean } | null {
  const mid = x >= 3 && x <= 10;
  const side = y >= 3 && y <= 10;
  if (mid && y >= 12) return { color: ARMY.red, back: y === 13 };
  if (mid && y <= 1) return { color: ARMY.yellow, back: y === 0 };
  if (side && x <= 1) return { color: ARMY.blue, back: x === 0 };
  if (side && x >= 12) return { color: ARMY.green, back: x === 13 };
  return null;
}

/** The 4-player cross in its starting position, pieces drawn as dots in army colours. */
function CrossBoard({ cell }: { cell: number }) {
  const rows = Array.from({ length: 14 }, (_, y) => y);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((y) => (
        <div key={y} style={{ display: "flex" }}>
          {rows.map((x) => {
            const corner = (x < 3 || x > 10) && (y < 3 || y > 10);
            const army = armyAt(x, y);
            const dot = army ? (army.back ? cell * 0.7 : cell * 0.44) : 0;
            return (
              <div
                key={x}
                style={{
                  width: cell,
                  height: cell,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: corner ? "transparent" : (x + y) % 2 ? DARK : LIGHT,
                }}
              >
                {army && (
                  <div style={{ width: dot, height: dot, borderRadius: dot, background: army.color, border: `2px solid ${INK}` }} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A branded share card: eyebrow, headline and a one-line pitch beside the board. */
export async function shareCard({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const [grotesk, mono] = await fonts;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK, color: PAPER, padding: 64, fontFamily: "Grotesk" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", paddingRight: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <BrandMark size={64} />
            <span style={{ fontFamily: "Mono", fontSize: 26, letterSpacing: 4, textTransform: "uppercase" }}>4-Man Chess</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <span style={{ fontFamily: "Mono", fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: ARMY.yellow }}>{eyebrow}</span>
            <span style={{ fontSize: 80, lineHeight: 0.95, letterSpacing: -3, textTransform: "uppercase" }}>{title}</span>
            <span style={{ fontSize: 30, lineHeight: 1.3, color: "#c9c9c3" }}>{subtitle}</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {Object.values(ARMY).map((c) => (
              <div key={c} style={{ width: 56, height: 12, background: c }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", border: `4px solid ${PAPER}`, padding: 10 }}>
          <CrossBoard cell={33} />
        </div>
      </div>
    ),
    {
      ...SHARE_SIZE,
      fonts: [
        { name: "Grotesk", data: grotesk, weight: 700, style: "normal" },
        { name: "Mono", data: mono, weight: 700, style: "normal" },
      ],
    },
  );
}
