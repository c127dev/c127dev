// Plays a full game on the contribution calendar and bakes the result into a
// standalone animated SVG. No script ships in the output - GitHub strips it.
//
//   node tools/gen-maze.mjs <user> <outdir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchCalendar, syntheticCalendar } from './contributions.mjs';

const USER = process.argv[2] ?? 'c127dev';
const OUTDIR = process.argv[3] ?? 'dist';

const PITCH = 14, CELL = 11, H = 7;

let seed = 20260819;
const reseed = (v) => { seed = v >>> 0; };
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let calendar;
try {
  calendar = await fetchCalendar(USER);
} catch (err) {
  console.warn(`calendar unavailable (${err.message}); using a synthetic year`);
  calendar = syntheticCalendar(rnd);
}

// --- grid -----------------------------------------------------------------
const DAY = 86400000;
const firstDate = Date.parse(calendar[0].date + 'T00:00:00Z');
const originSunday = firstDate - new Date(firstDate).getUTCDay() * DAY;
const placed = calendar.map((c) => {
  const ts = Date.parse(c.date + 'T00:00:00Z');
  return { level: c.level, w: Math.floor((ts - originSunday) / (7 * DAY)), d: new Date(ts).getUTCDay() };
});
const W = Math.max(...placed.map((p) => p.w)) + 1;
const N = W * H;

const k = (w, d) => w * H + d;
const wOf = (c) => Math.floor(c / H);
const dOf = (c) => c % H;
const cx = (c) => wOf(c) * PITCH + CELL / 2;
const cy = (c) => dOf(c) * PITCH + CELL / 2;

const present = new Uint8Array(N);
const level = new Int8Array(N).fill(-1);
for (const p of placed) {
  present[k(p.w, p.d)] = 1;
  level[k(p.w, p.d)] = p.level;
}
const CELLS = [];
for (let c = 0; c < N; c++) if (present[c]) CELLS.push(c);

const ACTIVE_DAYS = CELLS.filter((c) => level[c] > 0).length;
const ACTIVE_RATIO = ACTIVE_DAYS / CELLS.length;
// Enough commit days to carry a board on their own, or not.
const DENSE = ACTIVE_RATIO >= 0.33;

const gridNeighbours = (c) => {
  const w = wOf(c), d = dOf(c), out = [];
  if (d > 0) out.push(k(w, d - 1));
  if (d < H - 1) out.push(k(w, d + 1));
  if (w > 0) out.push(k(w - 1, d));
  if (w < W - 1) out.push(k(w + 1, d));
  return out.filter((n) => present[n]);
};
const GRID = Array.from({ length: N }, (_, c) => (present[c] ? gridNeighbours(c) : []));
const ekey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// --- one attempt ----------------------------------------------------------
function play(attemptSeed) {
  reseed(attemptSeed);

  // Randomised DFS spanning tree, then braided: a perfect maze is nothing but
  // dead ends, which makes for a dull chase.
  const open = new Set();
  const seen = new Uint8Array(N);
  const root = CELLS[Math.floor(CELLS.length / 2)];
  const stack = [root];
  seen[root] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const cand = shuffle(GRID[c].filter((n) => !seen[n]));
    if (!cand.length) { stack.pop(); continue; }
    open.add(ekey(c, cand[0]));
    seen[cand[0]] = 1;
    stack.push(cand[0]);
  }
  for (const c of CELLS) {
    if (GRID[c].filter((n) => open.has(ekey(c, n))).length > 1) continue;
    const extra = shuffle(GRID[c].filter((n) => !open.has(ekey(c, n))));
    if (extra.length && rnd() < 0.82) open.add(ekey(c, extra[0]));
  }
  for (let i = 0; i < Math.round(CELLS.length / 14); i++) {
    const c = pick(CELLS);
    const cand = GRID[c].filter((n) => !open.has(ekey(c, n)));
    if (cand.length) open.add(ekey(c, pick(cand)));
  }
  const ADJ = Array.from({ length: N }, (_, c) => GRID[c].filter((n) => open.has(ekey(c, n))));

  // Sparse year: every day is a pellet, and the days you did commit are the
  // power pellets - otherwise the board would sit untouched. Dense year: only
  // commit days are pellets and the busiest days are the power pellets.
  const pellet = new Uint8Array(N);
  const power = new Uint8Array(N);
  const powerCap = Math.max(4, Math.round(CELLS.length * 0.06));
  let powerFloor = 1;
  if (DENSE) {
    while (powerFloor < 4 && CELLS.filter((c) => level[c] >= powerFloor).length > powerCap) powerFloor++;
    for (const c of CELLS) {
      if (level[c] > 0) pellet[c] = 1;
      if (level[c] >= powerFloor) power[c] = 1;
    }
  } else {
    for (const c of CELLS) {
      pellet[c] = 1;
      if (level[c] > 0) power[c] = 1;
    }
  }
  const powerCount = CELLS.filter((c) => power[c]).length;
  // Keep total frightened time roughly constant however many there are.
  const FRIGHT = Math.max(10, Math.min(40, Math.round(600 / Math.max(1, powerCount))));
  let remaining = CELLS.reduce((n, c) => n + pellet[c], 0);

  const bfs = (starts, blocked = null) => {
    const dist = new Int16Array(N).fill(-1);
    const prev = new Int16Array(N).fill(-1);
    const q = [...starts];
    for (const s of starts) dist[s] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (const n of ADJ[c]) {
        if (dist[n] !== -1 || (blocked && blocked[n])) continue;
        dist[n] = dist[c] + 1;
        prev[n] = c;
        q.push(n);
      }
    }
    return { dist, prev };
  };
  const firstStep = (prev, from, to) => {
    let c = to;
    while (prev[c] !== -1 && prev[c] !== from) c = prev[c];
    return prev[c] === from ? c : null;
  };

  const nearest = (w, d) => CELLS.reduce((best, c) => (
    Math.abs(wOf(c) - w) + Math.abs(dOf(c) - d) < Math.abs(wOf(best) - w) + Math.abs(dOf(best) - d) ? c : best
  ), CELLS[0]);
  const HOUSE = nearest(Math.floor(W / 2), 3);
  const START = nearest(1, 3);
  const CORNERS = [nearest(W - 1, 0), nearest(0, 0), nearest(W - 1, H - 1), nearest(0, H - 1)];
  const COLOURS = ['#ff5f56', '#ffb8de', '#7ee8fa', '#ffb86c'];

  let hero = START, heroPrev = START;
  const chasers = COLOURS.map((colour, i) => ({ colour, at: HOUSE, prev: HOUSE, eaten: false, out: i * 22 }));

  let fright = 0, lives = 4, freeze = 0, deaths = 0, chasersEaten = 0;
  const SCATTER = 55, CHASE = 190;
  const modeAt = (tick) => ((tick % (SCATTER + CHASE)) < SCATTER ? 'scatter' : 'chase');

  const heroTrack = [], heroAlive = [];
  const chaserTracks = chasers.map(() => []);
  const chaserFright = chasers.map(() => []);
  const chaserEyes = chasers.map(() => []);
  const eatenAt = new Array(N).fill(null);

  const ahead = (from, prev, n) => {
    const dw = wOf(from) - wOf(prev), dd = dOf(from) - dOf(prev);
    return nearest(
      Math.max(0, Math.min(W - 1, wOf(from) + dw * n)),
      Math.max(0, Math.min(H - 1, dOf(from) + dd * n))
    );
  };
  const euclid = (a, b) => (wOf(a) - wOf(b)) ** 2 + (dOf(a) - dOf(b)) ** 2;

  const MAX_TICKS = 2400;
  for (let t = 0; t < MAX_TICKS && remaining > 0 && lives > 0; t++) {
    heroTrack.push(hero);
    heroAlive.push(freeze <= 0);
    chasers.forEach((g, i) => {
      chaserTracks[i].push(g.at);
      chaserFright[i].push(fright > 0 && !g.eaten);
      chaserEyes[i].push(g.eaten);
    });
    if (freeze > 0) { freeze--; continue; }

    // Chasers run at 4/5 of his speed, and half of that while frightened.
    const chaserStep = t % 5 !== 4;
    for (const g of chasers) {
      if (g.out > 0) { g.out--; continue; }
      if (!chaserStep && !g.eaten) continue;
      if (fright > 0 && !g.eaten && t % 2 === 1) continue;

      const i = chasers.indexOf(g);
      let target;
      if (g.eaten) target = HOUSE;
      else if (fright > 0) target = null;
      else if (modeAt(t) === 'scatter') target = CORNERS[i];
      else if (i === 0) target = hero;
      else if (i === 1) target = ahead(hero, heroPrev, 4);
      else if (i === 2) {
        const pivot = ahead(hero, heroPrev, 2), red = chasers[0].at;
        target = nearest(
          Math.max(0, Math.min(W - 1, 2 * wOf(pivot) - wOf(red))),
          Math.max(0, Math.min(H - 1, 2 * dOf(pivot) - dOf(red)))
        );
      } else target = euclid(g.at, hero) > 64 ? hero : CORNERS[3];

      let opts = ADJ[g.at].filter((n) => n !== g.prev);
      if (!opts.length) opts = ADJ[g.at];
      if (!opts.length) continue;
      const step = target === null
        ? pick(opts)
        : opts.reduce((best, n) => (euclid(n, target) < euclid(best, target) ? n : best), opts[0]);
      g.prev = g.at;
      g.at = step;
      if (g.eaten && g.at === HOUSE) { g.eaten = false; g.out = 6; }
    }

    // Threat is read after the chasers have moved, so he reacts to where they
    // are now rather than where they were.
    const active = chasers.filter((g) => g.out <= 0 && !g.eaten && fright === 0).map((g) => g.at);
    const threat = active.length ? bfs(active) : null;
    const edible = chasers.filter((g) => fright > 0 && !g.eaten && g.out <= 0).map((g) => g.at);
    let next = null;

    const hot = threat
      ? Array.from({ length: N }, (_, c) => threat.dist[c] >= 0 && threat.dist[c] <= 1)
      : null;
    let reach = bfs([hero], hot);
    if (!CELLS.some((c) => pellet[c] && reach.dist[c] > 0)) reach = bfs([hero]);

    // He has to win the race to anything nearby. Distant targets get committed
    // to anyway - the chasers chase him, not the pellet, so demanding a margin
    // out there leaves him circling instead of clearing the board.
    const margin = (c) => (!threat || threat.dist[c] < 0 ? 99 : threat.dist[c] - reach.dist[c]);
    const safe = (c) => reach.dist[c] >= 0 && (reach.dist[c] > 8 || margin(c) > 1);

    if (edible.length) {
      const prey = edible.reduce((a, b) => (reach.dist[a] >= 0 && reach.dist[a] <= reach.dist[b] ? a : b));
      if (reach.dist[prey] > 0 && reach.dist[prey] < 14) next = firstStep(reach.prev, hero, prey);
    }
    if (next === null) {
      let goal = -1, best = -Infinity;
      for (const c of CELLS) {
        if (!pellet[c] || !safe(c)) continue;
        const score = -reach.dist[c] * 1.6 + Math.min(margin(c), 14) * 2.6 + (power[c] ? 5 : 0);
        if (score > best) { best = score; goal = c; }
      }
      if (goal >= 0) next = firstStep(reach.prev, hero, goal);
    }
    if (next === null && threat) {
      let goal = -1, best = -Infinity;
      for (const c of CELLS) {
        if (reach.dist[c] < 0) continue;
        const score = Math.min(margin(c), 20) * 2 - reach.dist[c] * 0.3 + ADJ[c].length * 0.6;
        if (score > best) { best = score; goal = c; }
      }
      if (goal >= 0 && goal !== hero) next = firstStep(reach.prev, hero, goal);
    }
    if (next === null) {
      const opts = ADJ[hero];
      next = opts.reduce((b, n) => {
        const bd = threat && threat.dist[b] >= 0 ? threat.dist[b] : 30;
        const nd = threat && threat.dist[n] >= 0 ? threat.dist[n] : 30;
        const bs = bd * 2 + ADJ[b].length + (power[b] ? 9 : 0);
        const ns = nd * 2 + ADJ[n].length + (power[n] ? 9 : 0);
        return ns > bs ? n : b;
      }, opts[0]);
    }

    const swapped = chasers.some((g) => g.at === hero && g.prev === next);
    heroPrev = hero;
    hero = next;

    if (pellet[hero]) {
      pellet[hero] = 0;
      remaining--;
      eatenAt[hero] = t;
      if (power[hero]) {
        fright = FRIGHT;
        for (const g of chasers) if (!g.eaten) g.prev = g.at;
      }
    }
    if (fright > 0) fright--;

    for (const g of chasers) {
      if (g.out > 0 || g.eaten) continue;
      if (!(g.at === hero || (g.prev === hero && g.at === heroPrev) || swapped)) continue;
      if (fright > 0) { g.eaten = true; chasersEaten++; continue; }
      lives--;
      deaths++;
      freeze = 14;
      hero = START;
      heroPrev = START;
      chasers.forEach((gg, i) => {
        gg.at = HOUSE; gg.prev = HOUSE; gg.eaten = false; gg.out = i * 10 + 6;
      });
      fright = 0;
      break;
    }
  }

  // A beat on the finished board before the loop restarts.
  for (let i = 0; i < 24; i++) {
    heroTrack.push(hero);
    heroAlive.push(true);
    chasers.forEach((g, gi) => {
      chaserTracks[gi].push(g.at);
      chaserFright[gi].push(false);
      chaserEyes[gi].push(g.eaten);
    });
  }

  return {
    open, power, eatenAt, heroTrack, heroAlive, chaserTracks, chaserFright, chaserEyes, chasers,
    deaths, chasersEaten, remaining, powerCount, powerFloor, cleared: remaining === 0
  };
}

// A daily job cannot ship a game that ends with the chomper dead in a corner, so
// several mazes are played and the best run is the one that gets published.
let game = null;
for (let attempt = 0; attempt < 12; attempt++) {
  const candidate = play(20260819 + attempt * 7919);
  const better = !game
    || (candidate.cleared && !game.cleared)
    || (candidate.cleared === game.cleared && candidate.remaining < game.remaining)
    || (candidate.cleared && game.cleared && candidate.deaths < game.deaths);
  if (better) game = candidate;
  if (game.cleared && game.deaths <= 2) break;
}

const {
  open, power, eatenAt, heroTrack, heroAlive, chaserTracks, chaserFright, chaserEyes, chasers,
  deaths, chasersEaten, remaining, powerCount, powerFloor, cleared
} = game;

// --- keyframes ------------------------------------------------------------
// Every animation runs with steps(1, end): a stop holds until the next one, so
// entities sit on cell centres instead of drifting between them.
const TICKS = heroTrack.length - 1;
const DUR = Math.max(30, Math.min(60, Math.round(TICKS / 18)));
const pctOf = (i) => (i / TICKS) * 100;
const num = (v) => (Math.round(v * 100) / 100).toString();

function motion(track) {
  const out = [];
  let last = -1;
  for (let i = 0; i <= TICKS; i++) {
    if (track[i] === last) continue;
    last = track[i];
    out.push(`${num(pctOf(i))}%{transform:translate(${num(cx(last))}px,${num(cy(last))}px)}`);
  }
  out.push(`100%{transform:translate(${num(cx(track[TICKS]))}px,${num(cy(track[TICKS]))}px)}`);
  return out.join('');
}

function facing(track) {
  const angle = (a, b) => {
    const dw = wOf(b) - wOf(a), dd = dOf(b) - dOf(a);
    return dw === 1 ? 0 : dw === -1 ? 180 : dd === 1 ? 90 : 270;
  };
  const out = [];
  let cur = 0;
  for (let i = 0; i < TICKS; i++) {
    if (track[i] === track[i + 1]) continue;
    const a = angle(track[i], track[i + 1]);
    if (a === cur && out.length) continue;
    out.push(`${num(pctOf(i))}%{transform:rotate(${a}deg)}`);
    cur = a;
  }
  if (!out.length) out.push('0%{transform:rotate(0deg)}');
  out.push(`100%{transform:rotate(${cur}deg)}`);
  return out.join('');
}

function visibility(flags) {
  const out = [`0%{opacity:${flags[0] ? 1 : 0}}`];
  for (let i = 1; i <= TICKS; i++) {
    if (flags[i] === flags[i - 1]) continue;
    out.push(`${num(pctOf(i))}%{opacity:${flags[i] ? 1 : 0}}`);
  }
  return out.join('');
}

const keyframes = [
  '@keyframes chompOpen{0%,44%{opacity:1}45%,100%{opacity:0}}',
  '@keyframes chompShut{0%,44%{opacity:0}45%,100%{opacity:1}}',
  '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}',
  '@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}',
  `@keyframes heroMove{${motion(heroTrack)}}`,
  `@keyframes heroFace{${facing(heroTrack)}}`,
  `@keyframes heroAlive{${visibility(heroAlive)}}`
];
chasers.forEach((_, i) => {
  keyframes.push(`@keyframes gMove${i}{${motion(chaserTracks[i])}}`);
  keyframes.push(`@keyframes gWell${i}{${visibility(chaserFright[i].map((f, j) => !f && !chaserEyes[i][j]))}}`);
  keyframes.push(`@keyframes gFright${i}{${visibility(chaserFright[i])}}`);
});

// --- board ----------------------------------------------------------------
const cellKeyframes = [];
const cellShapes = [];
for (const c of CELLS) {
  const x = wOf(c) * PITCH, y = dOf(c) * PITCH;
  const fill = `var(--l${level[c]})`;
  const r = power[c] ? 5.5 : 2;
  if (eatenAt[c] === null) {
    cellShapes.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${r}" ry="${r}" fill="${fill}"/>`);
    continue;
  }
  const gone = num(pctOf(eatenAt[c] + 1));
  cellKeyframes.push(`@keyframes c${c}{0%{opacity:1}${gone}%{opacity:0}}`);
  const anim = `animation:c${c} ${DUR}s steps(1,end) infinite`
    + (power[c] ? ',pulse 1.1s ease-in-out infinite' : '');
  const box = power[c] ? 'transform-box:fill-box;transform-origin:center;' : '';
  cellShapes.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${r}" ry="${r}" fill="${fill}" style="${box}${anim}"/>`);
}

const wallShapes = [];
for (const c of CELLS) {
  const w = wOf(c), d = dOf(c);
  const below = k(w, d + 1), right = k(w + 1, d);
  if (d < H - 1 && present[below] && !open.has(ekey(c, below))) {
    wallShapes.push(`<rect x="${w * PITCH - 1.5}" y="${d * PITCH + CELL}" width="${CELL + 3}" height="3" rx="1.5" ry="1.5" fill="var(--wall)"/>`);
  }
  if (w < W - 1 && present[right] && !open.has(ekey(c, right))) {
    wallShapes.push(`<rect x="${w * PITCH + CELL}" y="${d * PITCH - 1.5}" width="3" height="${CELL + 3}" rx="1.5" ry="1.5" fill="var(--wall)"/>`);
  }
}

const CHASER_BODY = 'M0 12 L0 6 A6 6 0 0 1 12 6 L12 12 L9.6 10 L7.2 12 L4.8 10 L2.4 12 Z';
const chaserShapes = chasers.map((g, i) => `  <g style="animation:gMove${i} ${DUR}s steps(1,end) infinite">
    <g style="transform:translate(-6px,-6px)">
      <g style="animation:bob 0.5s ease-in-out infinite">
        <path d="${CHASER_BODY}" fill="${g.colour}" style="animation:gWell${i} ${DUR}s steps(1,end) infinite"/>
        <path d="${CHASER_BODY}" fill="var(--fright)" style="animation:gFright${i} ${DUR}s steps(1,end) infinite"/>
        <circle cx="4" cy="5.5" r="1.7" fill="#fff"/>
        <circle cx="8.4" cy="5.5" r="1.7" fill="#fff"/>
        <circle cx="3.5" cy="5.5" r="0.85" fill="#111"/>
        <circle cx="7.9" cy="5.5" r="0.85" fill="#111"/>
      </g>
    </g>
  </g>`).join('\n');

const THEMES = {
  dark: {
    l0: '#1a222c', l1: '#033a16', l2: '#196c2e', l3: '#2ea043', l4: '#56d364',
    wall: '#6e7781', hero: '#f2cc60', fright: '#3b5bdb'
  },
  light: {
    l0: '#e8ecf1', l1: '#aceebb', l2: '#4ac26b', l3: '#2da44e', l4: '#116329',
    wall: '#8c959f', hero: '#bf8700', fright: '#4257c4'
  }
};

const build = (theme) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-7 -7 ${W * PITCH + 11} ${H * PITCH + 11}" width="${W * PITCH + 11}" height="${H * PITCH + 11}" role="img" aria-label="A maze chase clearing a year of GitHub contributions">
<style>
svg{${Object.entries(theme).map(([n, v]) => `--${n}:${v}`).join(';')}}
${keyframes.join('\n')}
${cellKeyframes.join('\n')}
</style>
${cellShapes.join('\n')}
${wallShapes.join('\n')}
${chaserShapes}
  <g style="animation:heroMove ${DUR}s steps(1,end) infinite">
    <g style="animation:heroAlive ${DUR}s steps(1,end) infinite">
      <g style="animation:heroFace ${DUR}s steps(1,end) infinite">
        <path d="M0 0 L6 -3.2 A6 6 0 1 0 6 3.2 Z" fill="var(--hero)" style="animation:chompOpen 0.36s steps(1,end) infinite"/>
        <path d="M0 0 L6 -0.5 A6 6 0 1 0 6 0.5 Z" fill="var(--hero)" style="animation:chompShut 0.36s steps(1,end) infinite"/>
      </g>
    </g>
  </g>
</svg>
`;

mkdirSync(OUTDIR, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const out = build(theme);
  writeFileSync(join(OUTDIR, `maze-${name}.svg`), out);
}

const stats = {
  user: USER,
  mode: DENSE ? 'dense' : 'sparse',
  days: CELLS.length,
  weeks: W,
  activeDays: ACTIVE_DAYS,
  powerPellets: powerCount,
  powerFloor,
  ticks: TICKS,
  seconds: DUR,
  deaths,
  chasersEaten,
  cleared,
  remaining,
  walls: wallShapes.length,
  generated: new Date().toISOString()
};
writeFileSync(join(OUTDIR, 'maze-stats.json'), JSON.stringify(stats, null, 2));
console.log(`${stats.mode} | ${ACTIVE_DAYS}/${CELLS.length} active days | ${TICKS} ticks / ${DUR}s | ${deaths} deaths, ${chasersEaten} chasers eaten | cleared: ${cleared}`);
