// ルールエンジンのテスト：node test/rules.test.js
'use strict';
require('../js/rules.js');
const E = globalThis.Engine;
const assert = require('assert');

function perft(b, h, side, d) {
  const ms = E.legalRaw(b, h, side, true, false);
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) {
    const c = E.make(b, h, side, m);
    n += perft(b, h, 1 - side, d - 1);
    E.unmake(b, h, side, m, c);
  }
  return n;
}

// 平手初期局面の perft（既知の値：30 / 900 / 25470）
const s0 = E.newGame();
const expect = [30, 900, 25470];
for (let d = 1; d <= expect.length; d++) {
  const n = perft(s0.board.slice(), s0.hands.slice(), 0, d);
  assert.strictEqual(n, expect[d - 1], `perft(${d})`);
  console.log(`perft(${d}) = ${n} OK`);
}

// 盤面を文字で作る小さなヘルパー（大文字=先手、小文字=後手、P歩 L香 N桂 S銀 B角 R飛 G金 K玉 T と）
function pos(rows, turn, hands) {
  const map = { P: 1, L: 2, N: 3, S: 4, B: 5, R: 6, G: 7, K: 8, T: 9 };
  const s = E.newGame();
  s.board.fill(0); s.hands.fill(0);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    const t = map[c.toUpperCase()];
    s.board[y * 9 + x] = c === c.toUpperCase() ? t : -t;
  }));
  s.turn = turn;
  for (const [side, t, n] of hands || []) s.hands[side * 8 + t] = n;
  s.keys = [E.posKey(s)];
  return s;
}
const sq = (file, rank) => (rank - 1) * 9 + (9 - file);

// 二歩：同じ筋に歩があると打てない
{
  const s = pos(['....k....', '.........', '.........', '.........', '.........', '.........', '....P....', '.........', '....K....'], 0, [[0, E.FU, 1]]);
  const drops = E.legalMoves(s).filter(m => E.mDrop(m) === E.FU).map(E.mTo);
  assert(!drops.some(t => t % 9 === 4), '二歩は打てない');
  assert(!drops.some(t => t < 9), '1段目に歩は打てない');
  console.log('二歩・行き所のない駒 OK');
}

// 打ち歩詰め：歩を打って詰ませるのは反則。ただし突き歩詰めは OK
{
  // 後手玉 1一、後手の香 2一と歩 1二の頭…ではなく、玉の逃げ道をふさいだ形
  const s = pos(['.......nk', '.......p.', '........G', '.........', '.........', '.........', '.........', '.........', 'K........'], 0, [[0, E.FU, 1]]);
  // 1二に歩を打つと、玉は 1二の歩を取れない（金が守る）→ 詰み → 反則
  const m = E.dropMove(E.FU, sq(1, 2));
  assert(!E.legalMoves(s).includes(m), '打ち歩詰めは打てない');
  console.log('打ち歩詰め OK');
}

// 行き所のない駒は必ず成る（歩が 1段目へ）
{
  const s = pos(['k........', '........P', '.........', '.........', '.........', '.........', '.........', '.........', '....K....'], 0);
  const ms = E.legalMoves(s).filter(m => E.mFrom(m) === sq(1, 2));
  assert.strictEqual(ms.length, 1);
  assert(E.mPromote(ms[0]), '歩は1段目で必ず成る');
  console.log('強制成り OK');
}

// 詰みの判定
{
  // 頭金：後手玉 5一、先手の歩 5三、持ち駒の金を 5二に打つ
  const s = pos(['....k....', '.........', '....P....', '.........', '.........', '.........', '.........', '.........', '....K....'], 0, [[0, E.KI, 1]]);
  const s2 = E.apply(s, E.dropMove(E.KI, sq(5, 2)));
  assert.strictEqual(s2.winner, 0);
  assert.strictEqual(s2.result, 'mate');
  assert.strictEqual(s2.kifu[0], '▲５二金打');
  console.log('詰み判定 OK');
}

// 千日手
{
  let s = pos(['k........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '........K'], 0);
  const a = [E.encode(sq(1, 9), sq(2, 9)), E.encode(sq(9, 1), sq(8, 1)), E.encode(sq(2, 9), sq(1, 9)), E.encode(sq(8, 1), sq(9, 1))];
  for (let k = 0; k < 12 && s.winner === null; k++) s = E.apply(s, a[k % 4]);
  assert.strictEqual(s.result, 'sennichite');
  console.log('千日手 OK');
}

// 駒落ち
{
  const s = E.newGame({ handicap: 'two', handicapSide: 1 });
  assert.strictEqual(s.board[sq(8, 2)], 0);
  assert.strictEqual(s.board[sq(2, 2)], 0);
  const t = E.newGame({ handicap: 'kaku', handicapSide: 0 });
  assert.strictEqual(t.board[sq(8, 8)], 0);
  assert.strictEqual(t.board[sq(2, 8)], E.HI);
  console.log('駒落ち OK');
}
console.log('all rules tests passed');
