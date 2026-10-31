/*
 * うごきがみえる将棋 — CPU 思考ルーチン
 * 評価関数 + αβ探索（反復深化・駒の取り合いを読み切る静止探索）。
 * 制限時間で打ち切るので、スマホでも固まらない。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const { genMoves, make, unmake, attacked, FU, KI, GI, OU } = E;

  // 駒の価値（盤上）と持ち駒の価値
  const VAL = [0, 100, 300, 330, 460, 700, 820, 520, 0, 530, 500, 500, 500, 950, 1100];
  const HAND = [0, 115, 320, 350, 500, 780, 920, 580];
  const MATE = 100000;
  const INF = 1e9;

  // margin：最善手からこの点差以内の手をランダムに選ぶ（手加減）
  // blunder：この確率で、まったく適当な手を指す
  const LEVELS = {
    easy: { depth: 1, time: 400, margin: 260, blunder: 0.2 },
    normal: { depth: 2, time: 1200, margin: 40, blunder: 0 },
    hard: { depth: 4, time: 2500, margin: 0, blunder: 0 },
    hint: { depth: 3, time: 1500, margin: 0, blunder: 0 },
  };

  // 玉の段ごとの評価（先手から見た y。奥にいるほど安全）
  const KING_Y = [-150, -150, -140, -130, -110, -80, -40, -8, 0];
  const DEFENDER = new Uint8Array(15);
  DEFENDER[KI] = DEFENDER[GI] = 1;
  for (let t = 9; t <= 12; t++) DEFENDER[t] = 1;

  function evaluate(S, side) {
    const b = S.b, h = S.h;
    const k0 = S.k[0], k1 = S.k[1];
    const k0x = k0 % 9, k0y = (k0 / 9) | 0, k1x = k1 % 9, k1y = (k1 / 9) | 0;
    let sc = 0;
    for (let sq = 0; sq < 81; sq++) {
      const p = b[sq];
      if (!p) continue;
      const x = sq % 9, y = (sq / 9) | 0;
      if (p > 0) {
        if (p === OU) { sc += KING_Y[y]; continue; }
        let v = VAL[p];
        const de = Math.max(Math.abs(x - k1x), Math.abs(y - k1y));
        if (de <= 2) v += (3 - de) * (p >= 5 && p !== KI ? 22 : 14);
        if (DEFENDER[p]) {
          const dk = Math.max(Math.abs(x - k0x), Math.abs(y - k0y));
          if (dk <= 2) v += (3 - dk) * 16;
        }
        if (p === FU && y <= 5) v += (6 - y) * 4;
        sc += v;
      } else {
        const t = -p;
        if (t === OU) { sc -= KING_Y[8 - y]; continue; }
        let v = VAL[t];
        const de = Math.max(Math.abs(x - k0x), Math.abs(y - k0y));
        if (de <= 2) v += (3 - de) * (t >= 5 && t !== KI ? 22 : 14);
        if (DEFENDER[t]) {
          const dk = Math.max(Math.abs(x - k1x), Math.abs(y - k1y));
          if (dk <= 2) v += (3 - dk) * 16;
        }
        if (t === FU && y >= 3) v += (y - 2) * 4;
        sc -= v;
      }
    }
    for (let t = 1; t <= 7; t++) sc += HAND[t] * (h[t] - h[8 + t]);
    return side === 0 ? sc : -sc;
  }

  function doMove(S, side, m) {
    const cap = make(S.b, S.h, side, m);
    const to = (m >> 7) & 127;
    if (S.b[to] === (side === 0 ? OU : -OU)) S.k[side] = to;
    return cap;
  }
  function undoMove(S, side, m, cap) {
    unmake(S.b, S.h, side, m, cap);
    const from = m & 127;
    if (from < 81 && S.b[from] === (side === 0 ? OU : -OU)) S.k[side] = from;
  }

  // 取る手 → 成る手 → キラー手 → 履歴 の順に並べる
  function ordered(S, moves, ply) {
    const b = S.b;
    const keys = new Float64Array(moves.length);
    const k1 = S.killers[ply * 2], k2 = S.killers[ply * 2 + 1];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const from = m & 127, to = (m >> 7) & 127;
      let s;
      const cap = b[to];
      if (cap) s = 200000 + VAL[cap < 0 ? -cap : cap] * 16 - (from < 81 ? VAL[b[from] < 0 ? -b[from] : b[from]] : 0);
      else if (m === k1 || m === k2) s = 150000;
      else s = Math.min(S.hist[(m & 0x7fff) % S.hist.length], 100000);
      if (m & E.PROMOTE_BIT) s += 8000;
      keys[i] = s * 32768 + (m & 0x7fff);
    }
    keys.sort();
    const out = new Array(moves.length);
    for (let i = 0; i < moves.length; i++) out[i] = keys[moves.length - 1 - i] % 32768;
    return out;
  }

  function tick(S) {
    if ((++S.nodes & 1023) === 0 && Date.now() > S.deadline) S.stop = true;
    return S.stop;
  }

  // pawnDrop：直前の手が歩を打つ手だったか（打ち歩詰めは打った側の反則負け）
  function qsearch(S, side, alpha, beta, ply, qd, pawnDrop) {
    if (tick(S)) return 0;
    const inChk = attacked(S.b, S.k[side], 1 - side);
    const evasions = inChk && qd < 3;
    let best = -INF;
    if (!evasions) {
      best = evaluate(S, side);
      if (best >= beta || qd > 8) return best;
      if (best > alpha) alpha = best;
    }
    const moves = ordered(S, genMoves(S.b, S.h, side, [], !evasions), ply);
    let legal = 0;
    for (const m of moves) {
      const cap = doMove(S, side, m);
      if (attacked(S.b, S.k[side], 1 - side)) { undoMove(S, side, m, cap); continue; }
      legal++;
      const v = -qsearch(S, 1 - side, -beta, -alpha, ply + 1, qd + 1, (m & 127) === 80 + FU);
      undoMove(S, side, m, cap);
      if (S.stop) return 0;
      if (v > best) {
        best = v;
        if (v > alpha) { alpha = v; if (v >= beta) break; }
      }
    }
    if (evasions && !legal) return pawnDrop ? MATE - ply : -MATE + ply;
    return best;
  }

  function search(S, side, depth, alpha, beta, ply, pawnDrop) {
    if (depth <= 0) return qsearch(S, side, alpha, beta, ply, 0, pawnDrop);
    if (tick(S)) return 0;
    const moves = ordered(S, genMoves(S.b, S.h, side, []), ply);
    let legal = 0, best = -INF;
    for (const m of moves) {
      const cap = doMove(S, side, m);
      if (attacked(S.b, S.k[side], 1 - side)) { undoMove(S, side, m, cap); continue; }
      legal++;
      const v = -search(S, 1 - side, depth - 1, -beta, -alpha, ply + 1, (m & 127) === 80 + FU);
      undoMove(S, side, m, cap);
      if (S.stop) return 0;
      if (v > best) {
        best = v;
        if (v > alpha) {
          alpha = v;
          if (v >= beta) {
            if (!cap) {
              if (S.killers[ply * 2] !== m) { S.killers[ply * 2 + 1] = S.killers[ply * 2]; S.killers[ply * 2] = m; }
              S.hist[(m & 0x7fff) % S.hist.length] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) {
      // 指せる手がない＝負け。ただし相手の打ち歩詰めなら相手の反則
      return pawnDrop && attacked(S.b, S.k[side], 1 - side) ? MATE - ply : -MATE + ply;
    }
    return best;
  }

  // 局面（盤・持ち駒・手番）から指し手（整数）を返す。指せる手がなければ null
  function think(board, hands, side, levelName) {
    const L = LEVELS[levelName] || LEVELS.normal;
    const S = {
      b: Int8Array.from(board), h: Int8Array.from(hands), k: [E.kingSq(board, 0), E.kingSq(board, 1)],
      nodes: 0, deadline: Date.now() + L.time, stop: false,
      killers: new Int32Array(128), hist: new Int32Array(32768),
    };
    const root = E.legalRaw(S.b, S.h, side, true, false);
    if (!root.length) return null;
    if (root.length === 1) return root[0];
    if (L.blunder && Math.random() < L.blunder) return root[(Math.random() * root.length) | 0];

    let order = ordered(S, root, 0);
    let best = order[0];
    for (let depth = 1; depth <= L.depth; depth++) {
      const scored = [];
      let alpha = -INF, bestR = -INF, pick = null;
      for (const m of order) {
        const cap = doMove(S, side, m);
        const v = -search(S, 1 - side, depth - 1, -INF, -(alpha - L.margin), 1, (m & 127) === 80 + FU);
        undoMove(S, side, m, cap);
        if (S.stop) break;
        scored.push([m, v]);
        if (v > alpha) alpha = v;
        const r = v + Math.random() * L.margin;
        if (r > bestR) { bestR = r; pick = m; }
      }
      if (S.stop && depth > 1) break; // 読み切れなかった深さは捨てる
      if (pick !== null) best = pick;
      if (S.stop) break;
      scored.sort((a, b) => b[1] - a[1]);
      order = scored.map(a => a[0]);
      if (alpha >= MATE - 100) break; // 詰みを見つけた
    }
    return best;
  }

  global.AI = { think, evaluate, LEVELS, VAL };
})(typeof window !== 'undefined' ? window : globalThis);
