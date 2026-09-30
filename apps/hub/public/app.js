// Front-door fun: drifting pieces, a dice roll that picks tonight's game,
// tilting cards, confetti on the way in, and a wake-up call to sleepy servers.

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Drifting pieces ---------- */
const floaters = document.querySelector(".floaters");
const SHAPES = ["♚︎", "♛︎", "♜︎", "♝︎", "♞︎", "♟︎", "⚀", "⚂", "⚄", "⚅", "🏠", "🎩", "$"];
const COLORS = ["#d7362d", "#2b6be0", "#e0a810", "#229a4f", "currentColor"];
if (!reduced) {
  for (let i = 0; i < 22; i++) {
    const el = document.createElement("span");
    el.className = "floater";
    el.textContent = SHAPES[i % SHAPES.length];
    el.style.left = `${Math.random() * 100}%`;
    el.style.color = COLORS[i % COLORS.length];
    el.style.setProperty("--s", `${28 + Math.random() * 46}px`);
    el.style.setProperty("--d", `${18 + Math.random() * 22}s`);
    el.style.setProperty("--delay", `${-Math.random() * 30}s`);
    el.style.setProperty("--spin", `${(Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360)}deg`);
    el.dataset.depth = String(0.3 + Math.random());
    floaters.append(el);
  }
  // A little parallax: the pieces lean away from the pointer.
  addEventListener("pointermove", (e) => {
    const x = e.clientX / innerWidth - 0.5;
    const y = e.clientY / innerHeight - 0.5;
    for (const el of floaters.children) {
      const d = Number(el.dataset.depth);
      el.style.setProperty("--mx", `${-x * 40 * d}px`);
      el.style.setProperty("--my", `${-y * 40 * d}px`);
    }
  });
}

/* ---------- Scene details drawn from code ---------- */
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
// Oware: four seeds in every pit.
const oware = document.querySelector(".oware-scene .seeds");
if (oware) {
  for (const cy of [52, 98]) for (let p = 0; p < 6; p++) {
    const cx = 60 + p * 36;
    [[-5, -4], [5, -4], [-5, 5], [5, 5]].forEach(([dx, dy], k) => {
      const seed = svgEl("circle", { cx: cx + dx, cy: cy + dy, r: 4 });
      seed.style.setProperty("--d", `${(p * 0.2 + k * 0.05).toFixed(2)}s`);
      oware.append(seed);
    });
  }
}
// Bao: four rows of eight pits, two seeds each.
const bao = document.querySelector(".bao-scene .bao-pits");
if (bao) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
    const cx = 38 + c * 32, cy = 31 + r * 29 + (r > 1 ? 4 : 0);
    bao.append(svgEl("circle", { cx, cy, r: 11 }));
    for (const dx of [-3.5, 3.5]) {
      const seed = svgEl("circle", { cx: cx + dx, cy, r: 3.2, fill: "#efe3c8", stroke: "#6e4420", "stroke-width": 0.8, class: "seed" });
      seed.style.setProperty("--d", `${((r * 8 + c) * 0.07).toFixed(2)}s`);
      bao.append(seed);
    }
  }
}
// Fanorona: a 9×5 grid with diagonals from every other point, and 44 stones.
const lines = document.querySelector(".fano-scene .fano-lines");
const stones = document.querySelector(".fano-scene .fano-stones");
if (lines && stones) {
  const X = (i) => 25 + i * 25, Y = (j) => 25 + j * 25;
  let d = "";
  for (let j = 0; j < 5; j++) d += `M${X(0)} ${Y(j)}H${X(8)}`;
  for (let i = 0; i < 9; i++) d += `M${X(i)} ${Y(0)}V${Y(4)}`;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 5; j++) {
    if ((i + j) % 2) continue;
    if (i < 8 && j < 4) d += `M${X(i)} ${Y(j)}L${X(i + 1)} ${Y(j + 1)}`;
    if (i > 0 && j < 4) d += `M${X(i)} ${Y(j)}L${X(i - 1)} ${Y(j + 1)}`;
  }
  lines.append(svgEl("path", { d }));
  for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
    if (j === 2 && i === 4) continue;
    const dark = j < 2 || (j === 2 && (i < 4 ? i % 2 === 0 : i % 2 === 1));
    const stone = svgEl("circle", { cx: X(i), cy: Y(j), r: 8, fill: dark ? "#1b1b19" : "#fbfbf8", stroke: "#0b0b0b", "stroke-width": 2 });
    // The dark stone in line with the move gets captured by approach.
    if (i === 4 && j === 1) stone.classList.add("gone");
    stones.append(stone);
  }
  const mover = svgEl("circle", { r: 8, fill: "#fbfbf8", stroke: "#0b0b0b", "stroke-width": 2 });
  mover.append(svgEl("animateMotion", { dur: "3s", repeatCount: "indefinite", path: `M${X(4)} ${Y(3)} L${X(4)} ${Y(2)} L${X(4)} ${Y(2)}`, keyTimes: "0;0.5;1", keyPoints: "0;1;1", calcMode: "linear" }));
  stones.append(mover);
}

/* ---------- Bid for a game ---------- */
// Counts live on the game server; each browser remembers what it bid for so the button stays pressed.
const VOTES_URL = "https://fourman-server.onrender.com/votes";
const bidKey = (game) => `boardblaze:bid:${game}`;
const hasBid = (game) => { try { return localStorage.getItem(bidKey(game)) === "1"; } catch { return false; } };
const rememberBid = (game) => { try { localStorage.setItem(bidKey(game), "1"); } catch { /* storage blocked */ } };
function showVotes(votes) {
  const top = Math.max(1, ...Object.values(votes));
  for (const card of document.querySelectorAll("[data-vote]")) {
    const n = votes[card.dataset.vote] ?? 0;
    card.querySelector("[data-count]").textContent = n.toLocaleString();
    card.querySelector("[data-bar]").style.width = `${(n / top) * 100}%`;
  }
}
for (const card of document.querySelectorAll("[data-vote]")) {
  const game = card.dataset.vote;
  const button = card.querySelector(".bid-btn");
  if (hasBid(game)) { button.disabled = true; button.textContent = "✓ You bid"; }
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "✓ You bid";
    button.classList.add("pop");
    rememberBid(game);
    burst(card);
    try {
      const res = await fetch(`${VOTES_URL}/${game}`, { method: "POST" });
      if (res.ok) showVotes((await res.json()).votes);
    } catch { /* the count catches up on the next visit */ }
  });
}
fetch(VOTES_URL).then((r) => r.json()).then((d) => showVotes(d.votes)).catch(() => {});

/* ---------- Tilting cards ---------- */
for (const card of document.querySelectorAll(".game")) {
  if (reduced) break;
  card.addEventListener("pointermove", (e) => {
    const box = card.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    card.style.setProperty("--ry", `${x * 10}deg`);
    card.style.setProperty("--rx", `${-y * 10}deg`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--rx", "0deg");
  });
}

/* ---------- Roll for it ---------- */
const dice = [...document.querySelectorAll(".die")];
const verdict = document.getElementById("verdict");
const LINES = {
  chess: ["Four armies enter. One leaves.", "Chess, but everyone's your enemy.", "Sharpen those knights."],
  tycoon: ["Time to buy the street.", "Somebody's going bankrupt tonight.", "Hotels on Sapphire Point, anyone?"],
};
let rolling = false;
document.getElementById("roll").addEventListener("click", () => {
  if (rolling) return;
  rolling = true;
  document.querySelectorAll(".game.picked").forEach((c) => c.classList.remove("picked"));
  const faces = dice.map(() => 1 + Math.floor(Math.random() * 6));
  let ticks = 0;
  const spin = setInterval(() => {
    dice.forEach((d) => (d.dataset.face = String(1 + Math.floor(Math.random() * 6))));
    if (++ticks >= (reduced ? 1 : 8)) {
      clearInterval(spin);
      dice.forEach((d, i) => (d.dataset.face = String(faces[i])));
      land(faces[0] + faces[1]);
    }
  }, 80);
  if (!reduced) dice.forEach((d) => { d.classList.remove("rolling"); void d.offsetWidth; d.classList.add("rolling"); });
});

function land(total) {
  rolling = false;
  // Odd totals pick chess, even ones Tycoon.
  const game = total % 2 === 1 ? "chess" : "tycoon";
  const lines = LINES[game];
  const line = lines[Math.floor(Math.random() * lines.length)];
  verdict.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = `You rolled ${total}.`;
  verdict.append(strong, ` ${line}`);
  const card = document.querySelector(`.game[data-game="${game}"]`);
  card.classList.add("picked");
  card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  burst(card);
}

/* ---------- Confetti ---------- */
const canvas = document.getElementById("confetti");
const ctx = canvas.getContext("2d");
let bits = [];
let raf = 0;
function burst(from) {
  if (reduced) return;
  const box = from.getBoundingClientRect();
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  for (let i = 0; i < 90; i++) {
    bits.push({
      x: box.left + box.width / 2,
      y: box.top + 40,
      vx: (Math.random() - 0.5) * 12,
      vy: -4 - Math.random() * 9,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: ["#d7362d", "#2b6be0", "#e0a810", "#229a4f"][i % 4],
      life: 90 + Math.random() * 40,
    });
  }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}
function step() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  bits = bits.filter((b) => b.life-- > 0);
  for (const b of bits) {
    b.vy += 0.3;
    b.x += b.vx;
    b.y += b.vy;
    b.r += b.vr;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.r);
    ctx.fillStyle = b.c;
    ctx.fillRect(-5, -3, 10, 6);
    ctx.restore();
  }
  if (bits.length) raf = requestAnimationFrame(step);
}
// Confetti on the way into a game, then go.
for (const link of document.querySelectorAll(".game.live .play")) {
  link.addEventListener("click", (e) => {
    if (reduced || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    burst(link.closest(".game"));
    setTimeout(() => (location.href = link.href), 450);
  });
}

/* ---------- Wake the table ---------- */
// Free Render servers sleep when idle. Ping chess's web app and game server now,
// so they're warm by the time someone picks a game. `no-cors`: we only need an answer, not its contents.
const WAKE = {
  chess: ["https://fourman-web.onrender.com/", "https://fourman-server.onrender.com/health"],
  tycoon: ["https://lesliepaul-tycoon.onrender.com/", "https://fourman-server.onrender.com/health"],
};
for (const [game, urls] of Object.entries(WAKE)) {
  const status = document.querySelector(`.game[data-game="${game}"] [data-status]`);
  const text = status?.querySelector("[data-status-text]");
  if (!status || !text) continue;
  const slow = setTimeout(() => (text.textContent = "Waking up… (up to a minute)"), 2500);
  Promise.all(urls.map((u) => fetch(u, { mode: "no-cors", cache: "no-store" })))
    .then(() => {
      clearTimeout(slow);
      status.classList.add("ready");
      text.textContent = "Table's ready";
    })
    .catch(() => {
      clearTimeout(slow);
      text.textContent = "Can't reach it right now";
    });
}
