// 詰将棋の候補を自動生成する：node tools/gen-tsume.js <手数> <個数> [seed]
// 条件：ちょうど N 手で詰む（それより短く詰まない）／初手と本手順の攻め方の手が唯一／盤上の攻め駒に無駄がない
'use strict';
require('../js/rules.js');
require('../js/tsume.js');
const E = globalThis.Engine, T = globalThis.Tsume;
const N = +(process.argv[2] || 1), COUNT = +(process.argv[3] || 10);
let seed = +(process.argv[4] || 1);
const rnd = () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = n => (rnd() * n) | 0;
const pick = a => a[ri(a.length)];
const { FU, KY, KE, GI, KA, HI, KI, OU } = E;
const TO = 9, NG = 12, UM = 13, RY = 14;

function gen() {
  const b = new Int8Array(81), h = new Int8Array(16);
  const kx = ri(9), ky = rnd() < 0.55 ? 0 : rnd() < 0.7 ? 1 : 2;
  b[ky * 9 + kx] = -OU;
  const near = (r, maxY) => {
    for (let k = 0; k < 30; k++) {
      const x = kx + ri(2 * r + 1) - r, y = ky + ri(2 * r + 1) - r;
      if (x < 0 || x > 8 || y < 0 || y > maxY || b[y * 9 + x]) continue;
      return y * 9 + x;
    }
    return -1;
  };
  const nd = ri(4);
  for (let i = 0; i < nd; i++) {
    const sq = near(1 + ri(2), 4); if (sq < 0) continue;
    const t = pick([KI, KI, GI, GI, FU, FU, KE, KY, KA, HI]);
    if (E.deadEnd(t, 1, (sq / 9) | 0)) continue;
    b[sq] = -t;
  }
  const na = 1 + ri(3);
  for (let i = 0; i < na; i++) {
    const sq = near(1 + ri(3), 8); if (sq < 0) continue;
    const t = pick([KI, GI, FU, KE, KY, KA, HI, TO, NG, UM, RY, RY, UM, KI, GI]);
    if (E.deadEnd(t, 0, (sq / 9) | 0)) continue;
    b[sq] = t;
  }
  const nh = ri(3);
  for (let i = 0; i < nh; i++) h[pick([KI, KI, GI, GI, KE, KY, FU, HI, KA])]++;
  // 二歩チェック
  for (const s of [1, -1]) for (let x = 0; x < 9; x++) {
    let c = 0; for (let y = 0; y < 9; y++) if (b[y * 9 + x] === FU * s) c++;
    if (c > 1) return null;
  }
  if (E.inCheck(b, 1)) return null;
  if (!T.fillDefenderHand(b, h)) return null;
  return { b, h };
}

function analyze(b, h) {
  const S = new T.Solver();
  // 1手ずつ短い手数から調べる（ノード数が多すぎるものは捨てる）
  const len = S.mateLength(b, h, N);
  if (len !== N) return null;
  const ml = S.mainLine(b, h, N);
  if (!ml || ml.alts.some(a => a !== 1)) return null;
  // 盤上の攻め駒に無駄がないか（どれか1枚取り除いても N 手で詰むなら不採用）
  for (let sq = 0; sq < 81; sq++) {
    if (b[sq] <= 0) continue;
    const b2 = b.slice(), h2 = h.slice();
    b2[sq] = 0; T.fillDefenderHand(b2, h2);
    if (new T.Solver().mateLength(b2, h2, N)) return null;
  }
  // 持ち駒も使い切る
  const bb = b.slice(), hh = h.slice();
  ml.line.forEach((m, i) => E.make(bb, hh, i % 2, m));
  for (let t = 1; t <= 7; t++) if (hh[t]) return null;
  return ml.line;
}

const out = [], seen = new Set();
let tries = 0;
const t0 = Date.now();
while (out.length < COUNT && Date.now() - t0 < +(process.env.TL || 600000)) {
  tries++;
  const p = gen();
  if (!p) continue;
  const sfen = E.toSfen(p.b, p.h.map((v, i) => (i >= 8 ? 0 : v)), 0);
  if (seen.has(sfen)) continue;
  seen.add(sfen);
  const line = analyze(p.b, p.h);
  if (!line) continue;
  let s = E.fromPosition(p.b, p.h, 0);
  const kifu = [];
  for (const m of line) { kifu.push(E.moveText(s, m)); s = E.apply(s, m); }
  out.push({ sfen, kifu: kifu.join(' '), pieces: p.b.filter(v => v).length });
  process.stderr.write(`${out.length} (${tries} tries)\n`);
}
console.log(JSON.stringify(out, null, 1));
process.stderr.write(`tries=${tries} found=${out.length}\n`);
