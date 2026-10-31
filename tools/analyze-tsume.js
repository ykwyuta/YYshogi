// 詰将棋の候補を分析する：node tools/analyze-tsume.js candidates.json [...]
// 盤面図・手順・手筋（捨て駒・空き王手・不成など）・「ほかの王手がダメな理由」を出す
'use strict';
require('../js/rules.js');
require('../js/tsume.js');
const E = globalThis.Engine, T = globalThis.Tsume;
const fs = require('fs');

function diagram(b) {
  let s = '  ９８７６５４３２１\n';
  for (let y = 0; y < 9; y++) {
    let r = '';
    for (let x = 0; x < 9; x++) {
      const p = b[y * 9 + x];
      r += !p ? '・' : (p < 0 ? 'v' : ' ') + E.pieceKanji(E.typeOf(p), p > 0 ? 0 : 1);
    }
    s += r.replace(/ /g, ' ') + ' ' + '一二三四五六七八九'[y] + '\n';
  }
  return s;
}

function analyze(c) {
  const p = E.parseSfen(c.sfen);
  T.fillDefenderHand(p.board, p.hands);
  const S = new T.Solver();
  const n = c.kifu.split(' ').length;
  const ml = S.mainLine(p.board, p.hands, n);
  let s = E.fromPosition(p.board, p.hands, 0);
  const feats = [];
  const b0 = p.board.slice(), h0 = p.hands.slice();
  // ほかの王手が失敗する理由
  const refut = [];
  for (const m of S.checks(b0, h0)) {
    if (m === ml.line[0]) continue;
    const b = b0.slice(), h = h0.slice();
    E.make(b, h, 0, m);
    const d = S.bestDefense(b, h, n - 1);
    const st = E.apply(s, m);
    refut.push(`${E.moveText(s, m)}→${d.move !== null ? E.moveText(st, d.move) : '?'}`);
  }
  const line = ml.line;
  for (let i = 0; i < line.length; i++) {
    const m = line[i];
    const prev = s;
    s = E.apply(s, m);
    if (i % 2) continue;
    const to = E.mTo(m);
    const tags = [];
    if (E.mDrop(m)) tags.push('打');
    if (E.mPromote(m)) tags.push('成');
    else if (s.kifu[s.kifu.length - 1].endsWith('不成')) tags.push('不成');
    if (prev.board[to]) tags.push('取');
    // 空き王手：動かした駒そのものは玉に利いていない
    const k = E.kingSq(s.board, 1);
    if (!E.attackers(s.board, k, 0).includes(to)) tags.push('空き王手');
    if (E.attackers(s.board, k, 0).length > 1) tags.push('両王手');
    const nx = line[i + 1];
    if (nx !== undefined && E.mTo(nx) === to) tags.push('捨て駒');
    feats.push(`${i + 1}:${tags.join('/')}`);
  }
  return { diagram: diagram(b0), hand: c.sfen.split(' ')[2], kifu: c.kifu, checks: refut.length + 1, feats: feats.join(' '), refut: refut.slice(0, 6).join('  '), pieces: c.pieces };
}

const all = [];
for (const f of process.argv.slice(2)) for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) all.push(c);
const out = all.map((c, i) => Object.assign({ i, sfen: c.sfen }, analyze(c)));
if (process.env.JSON) console.log(JSON.stringify(out));
else for (const a of out) console.log(`#${a.i} [${a.sfen}] 持:${a.hand} 王手${a.checks}通り\n${a.diagram}正解: ${a.kifu}   ${a.feats}\nダメ: ${a.refut}\n`);
