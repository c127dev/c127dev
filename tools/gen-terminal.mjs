// Renders the terminal session as a standalone animated SVG. GitHub strips
// <style> and <script> from README HTML, but honours CSS inside an SVG that is
// referenced as an image - so all of this has to live in here.
//
//   node tools/gen-terminal.mjs <outdir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTDIR = process.argv[2] ?? 'dist';

const D = 18;          // loop length, seconds
const CLEAR = 84.44;   // when the screen wipes, in percent of the loop
const FS = 13.5;       // font size
const ADV = 8.1;       // monospace advance; textLength below makes it exact
const HOST = 'c127@github.com';
const PROMPT_CH = HOST.length + 4; // "user@host" + ":~$ "
const CMD_X = PROMPT_CH * ADV;
const PAD = 22;

const pct = (t) => Math.round((t / D) * 10000) / 100;

const lines = [
  { cmd: 'whoami', type: [0.8, 1.7], out: 1.9, text: 'c127 - drivers, firmware, OpenWrt board bring-up' },
  { cmd: 'ls trees/', appear: 2.6, type: [2.6, 3.8], out: 4.0, text: 'linux/   u-boot/   openwrt/   armbian/   containers/' },
  { cmd: 'cat trees/.now', appear: 4.8, type: [4.8, 6.6], out: 6.8, text: 'qualcommax: add support for Mercusys MR80X v2.' },
  { cmd: 'xdg-open https://www.c127.dev', appear: 7.6, type: [7.6, 10.6], out: 10.8, text: 'opening https://www.c127.dev' },
  { cmd: 'clear', appear: 11.6, type: [13.8, 14.6], out: null, text: null }
];

const ROW = 21, BLOCK = 55;
const TOP = 34;
const HEIGHT = TOP + BLOCK * (lines.length - 1) + ROW + PAD;
const WIDTH = 880;

// --- keyframes ------------------------------------------------------------
const kf = ['@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}'];

lines.forEach((l, i) => {
  const n = i + 1;
  const t0 = pct(l.type[0]), t1 = pct(l.type[1]);
  const chars = l.cmd.length;
  const end = ((chars * ADV * 100) / 100).toFixed(1);

  // Line 1 is on screen from the first frame - the console is never blank.
  if (i > 0) {
    const a = pct(l.appear);
    kf.push(`@keyframes ln${n}{0%,${a - 0.01}%{opacity:0}${a}%,${CLEAR}%{opacity:1}${CLEAR + 0.01}%,100%{opacity:0}}`);
  }
  kf.push(`@keyframes ty${n}{0%,${t0}%{clip-path:inset(0 100% 0 0)}${t1}%,${CLEAR}%{clip-path:inset(0 0 0 0)}${CLEAR + 0.01}%,100%{clip-path:inset(0 100% 0 0)}}`);
  kf.push(`@keyframes cx${n}{0%,${t0}%{transform:translateX(0)}${t1}%,${CLEAR}%{transform:translateX(${end}px)}${CLEAR + 0.01}%,100%{transform:translateX(0)}}`);

  // The caret stays on a line until that line has answered, and comes back on
  // line 1 after the wipe.
  const until = l.out === null ? CLEAR : pct(l.out);
  if (i === 0) {
    kf.push(`@keyframes cr1{0%,${until - 0.01}%{opacity:1}${until}%,${CLEAR}%{opacity:0}${CLEAR + 0.01}%,100%{opacity:1}}`);
  } else {
    const a = pct(l.appear);
    kf.push(`@keyframes cr${n}{0%,${a - 0.01}%{opacity:0}${a}%,${until - 0.01}%{opacity:1}${until}%,100%{opacity:0}}`);
  }
  if (l.out !== null) {
    const o = pct(l.out);
    kf.push(`@keyframes o${n}{0%,${o - 0.01}%{opacity:0}${o}%,${CLEAR}%{opacity:1}${CLEAR + 0.01}%,100%{opacity:0}}`);
  }
});

// --- shapes ---------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (x, y, str, cls, extra = '') =>
  `<text x="${x}" y="${y}" class="${cls}" textLength="${(str.length * ADV).toFixed(1)}" lengthAdjust="spacingAndGlyphs"${extra}>${esc(str)}</text>`;

const body = lines.map((l, i) => {
  const n = i + 1;
  const y = TOP + i * BLOCK;
  const chars = l.cmd.length;
  const anim = i === 0 ? '' : ` style="animation:ln${n} ${D}s linear infinite"`;

  const parts = [
    text(PAD, y, HOST, 'host'),
    text(PAD + HOST.length * ADV, y, ':', 'plain'),
    text(PAD + (HOST.length + 1) * ADV, y, '~', 'arg'),
    text(PAD + (HOST.length + 2) * ADV, y, '$', 'plain'),
    `<g style="animation:ty${n} ${D}s steps(${chars},end) infinite">${text(PAD + CMD_X, y, l.cmd, 'plain')}</g>`,
    `<g style="animation:cr${n} ${D}s linear infinite">` +
      `<g style="animation:cx${n} ${D}s steps(${chars},end) infinite">` +
      `<rect x="${(PAD + CMD_X).toFixed(1)}" y="${y - FS + 2.5}" width="${ADV}" height="${FS + 2}" class="caret" style="animation:blink 1s steps(1,end) infinite"/>` +
      '</g></g>'
  ];
  if (l.out !== null) {
    parts.push(`<g style="animation:o${n} ${D}s linear infinite">${text(PAD, y + ROW, l.text, 'out')}</g>`);
  }
  return `  <g${anim}>\n    ${parts.join('\n    ')}\n  </g>`;
}).join('\n');

const THEMES = {
  dark: { code: '#151b23', line: '#30363d', fg: '#e6edf3', muted: '#9198a1', prompt: '#56d364', arg: '#d2a8ff' },
  light: { code: '#f6f8fa', line: '#d1d9e0', fg: '#1f2328', muted: '#59636e', prompt: '#1a7f37', arg: '#8250df' }
};

const build = (theme) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Terminal session: whoami, ls trees/, cat trees/.now, xdg-open https://www.c127.dev">
<style>
svg{${Object.entries(theme).map(([n, v]) => `--${n}:${v}`).join(';')}}
text{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:${FS}px;white-space:pre}
.host{fill:var(--prompt)}
.arg{fill:var(--arg)}
.plain{fill:var(--fg)}
.out{fill:var(--muted)}
.caret{fill:var(--fg)}
${kf.join('\n')}
</style>
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" ry="6" fill="var(--code)" stroke="var(--line)"/>
${body}
</svg>
`;

mkdirSync(OUTDIR, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(join(OUTDIR, `terminal-${name}.svg`), build(theme));
}
console.log(`terminal svg ${WIDTH}x${HEIGHT}, ${lines.length} lines, ${D}s loop, clear at ${CLEAR}%`);
