/*
 * うごきがみえる将棋 — 詰将棋ソルバー
 * 攻め方＝先手（side 0）、玉方＝後手（side 1）。攻め方は毎手王手をかけ、玉方は最も長く逃げる。
 * 玉方の持ち駒は「残り駒全部」。問題の自動生成（tools/gen-tsume.js）と、遊ぶときの正解判定の両方で使う。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const { make, unmake, legalRaw, inCheck } = E;
  const FULL = [0, 18, 4, 4, 4, 2, 2, 4]; // 歩 香 桂 銀 角 飛 金 の総数

  // 玉方の持ち駒を「残り駒全部」にする
  function fillDefenderHand(board, hands) {
    const used = new Int32Array(8);
    for (let sq = 0; sq < 81; sq++) {
      const t = E.baseType(E.typeOf(board[sq]));
      if (board[sq] && t !== E.OU) used[t]++;
    }
    for (let t = 1; t <= 7; t++) {
      const n = FULL[t] - used[t] - hands[t];
      if (n < 0) return false;
      hands[8 + t] = n;
    }
    return true;
  }

  function Solver() { this.memo = new Map(); this.nodes = 0; }

  Solver.prototype.key = function (b, h, n) { return n + ':' + b.join(',') + ':' + h.join(','); };

  // 攻め方の王手（合法手のうち、玉方に王手がかかるもの）
  Solver.prototype.checks = function (b, h) {
    const res = [];
    for (const m of legalRaw(b, h, 0, true, false)) {
      const c = make(b, h, 0, m);
      if (inCheck(b, 1)) res.push(m);
      unmake(b, h, 0, m, c);
    }
    return res;
  };

  // 攻め方の手番で、n 手（奇数）以内に詰むか
  Solver.prototype.attack = function (b, h, n) {
    if (n < 1) return false;
    const k = this.key(b, h, n);
    const memo = this.memo.get(k);
    if (memo !== undefined) return memo;
    this.nodes++;
    let ok = false;
    for (const m of this.checks(b, h)) {
      const c = make(b, h, 0, m);
      const r = this.defend(b, h, n - 1);
      unmake(b, h, 0, m, c);
      if (r) { ok = true; break; }
    }
    this.memo.set(k, ok);
    return ok;
  };

  // 玉方の手番（王手がかかっている）で、残り n 手以内に必ず詰むか
  Solver.prototype.defend = function (b, h, n) {
    const ms = legalRaw(b, h, 1, true, false);
    if (!ms.length) return true;
    if (n < 2) return false;
    for (const m of ms) {
      const c = make(b, h, 1, m);
      const r = this.attack(b, h, n - 1);
      unmake(b, h, 1, m, c);
      if (!r) return false;
    }
    return true;
  };

  // 攻め方の手番で、詰むまでの最短手数（max 手以内で詰まなければ 0）
  Solver.prototype.mateLength = function (b, h, max) {
    for (let n = 1; n <= max; n += 2) if (this.attack(b, h, n)) return n;
    return 0;
  };

  // 玉方の手番で、詰むまでの手数（max 手以内に詰まなければ Infinity）
  Solver.prototype.defendLength = function (b, h, max) {
    if (!legalRaw(b, h, 1, true, true).length) return 0;
    for (let n = 2; n <= max; n += 2) if (this.defend(b, h, n)) return n;
    return Infinity;
  };

  // 攻め方の手番で、n 手以内に詰ませる王手の一覧
  Solver.prototype.solutions = function (b, h, n) {
    const res = [];
    for (const m of this.checks(b, h)) {
      const c = make(b, h, 0, m);
      if (this.defend(b, h, n - 1)) res.push(m);
      unmake(b, h, 0, m, c);
    }
    return res;
  };

  // 玉方の最善の応手：一番長く逃げられる手。同じ長さなら、合駒（打つ手）より駒を動かす手を選ぶ
  Solver.prototype.bestDefense = function (b, h, max) {
    let best = null, bestLen = -1, bestRank = -1;
    for (const m of legalRaw(b, h, 1, true, false)) {
      const c = make(b, h, 1, m);
      let len = 0;
      for (let n = 1; n <= max + 2; n += 2) { if (this.attack(b, h, n)) { len = n; break; } }
      if (!len) len = Infinity;
      unmake(b, h, 1, m, c);
      const rank = (E.mDrop(m) ? 0 : 2) + (c ? 1 : 0);
      if (len > bestLen || (len === bestLen && rank > bestRank)) { best = m; bestLen = len; bestRank = rank; }
    }
    return { move: best, len: bestLen };
  };

  // 手順（最善の応手に対する攻め方の手）。各局面で攻め方の正解がいくつあるかも返す
  Solver.prototype.mainLine = function (b0, h0, n) {
    const b = Int8Array.from(b0), h = Int8Array.from(h0);
    const line = [], alts = [];
    while (n > 0) {
      const sols = this.solutions(b, h, n);
      if (!sols.length) return null;
      alts.push(sols.length);
      const m = sols[0];
      line.push(m);
      make(b, h, 0, m);
      if (n === 1) break;
      const d = this.bestDefense(b, h, n - 2);
      if (d.move === null) break;
      line.push(d.move);
      make(b, h, 1, d.move);
      n -= 2;
    }
    return { line, alts };
  };

  global.Tsume = { Solver, fillDefenderHand, FULL };
})(typeof window !== 'undefined' ? window : globalThis);
