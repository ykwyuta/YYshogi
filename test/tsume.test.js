// 詰将棋 50 問の検証：node test/tsume.test.js
// 手数ちょうどで詰む／それより短く詰まない／本手順の攻め方の手が唯一／traps の手では詰まない
'use strict';
require('../js/rules.js');
require('../js/tsume.js');
require('../js/tsume-data.js');
const E = globalThis.Engine, T = globalThis.Tsume;
const assert = require('assert');

const probs = globalThis.TSUME_PROBLEMS;
assert.strictEqual(probs.length, 50, '50問');
const sfens = new Set();
probs.forEach((p, i) => {
  const no = `第${i + 1}問`;
  assert(!sfens.has(p.sfen), `${no} 重複`); sfens.add(p.sfen);
  const pos = E.parseSfen(p.sfen);
  assert(T.fillDefenderHand(pos.board, pos.hands), `${no} 駒の数`);
  assert(!E.inCheck(pos.board, 1), `${no} 最初から王手`);
  const S = new T.Solver();
  assert.strictEqual(S.mateLength(pos.board, pos.hands, p.moves), p.moves, `${no} 手数`);
  const ml = S.mainLine(pos.board, pos.hands, p.moves);
  assert(ml.alts.every(a => a === 1), `${no} 攻め方の手が唯一でない`);
  let s = E.fromPosition(pos.board, pos.hands, 0);
  for (const m of ml.line) s = E.apply(s, m);
  assert.strictEqual(s.kifu.join(' '), p.answer, `${no} 正解手順`);
  assert.strictEqual(s.winner, 0, `${no} 詰んでいない`);
  // まちがえやすい手：王手だが詰まず、玉方はその応手で逃げる
  const s0 = E.fromPosition(pos.board, pos.hands, 0);
  for (const [atk, def] of p.traps) {
    const m = S.checks(pos.board.slice(), pos.hands.slice()).find(x => E.moveText(s0, x) === atk);
    assert(m !== undefined, `${no} trap ${atk} は王手でない`);
    const b = pos.board.slice(), h = pos.hands.slice();
    E.make(b, h, 0, m);
    assert(!S.defend(b, h, p.moves - 1), `${no} trap ${atk} で詰んでしまう`);
    const s1 = E.apply(s0, m);
    const d = S.bestDefense(b, h, p.moves - 1);
    assert.strictEqual(E.moveText(s1, d.move), def, `${no} trap ${atk} の応手`);
    assert(d.len === Infinity || d.len > p.moves - 2, `${no} trap 応手で詰む`);
  }
});
const count = n => probs.filter(p => p.moves === n).length;
console.log(`詰将棋 ${probs.length}問 OK（1手詰 ${count(1)}・3手詰 ${count(3)}・5手詰 ${count(5)}）`);
