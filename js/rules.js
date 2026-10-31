/*
 * うごきがみえる将棋 — ルールエンジン
 * 盤面状態は純粋なデータとして扱い、apply は常に新しい状態を返す。
 * 低レベルの指し手生成（genMoves / make / unmake / attacked）は AI の探索でもそのまま使う。
 *
 * 座標：x は画面の左から 0〜8（筋は 9 - x）、y は上から 0〜8（段は y + 1）。sq = y * 9 + x。
 * 駒：先手（side 0・下側）は正の数、後手（side 1・上側）は負の数。
 * 指し手：整数。bit 0-6 = 移動元（81 以上は「打つ」で 80 + 駒の種類）、bit 7-13 = 移動先、bit 14 = 成り。
 */
(function (global) {
  'use strict';

  const SIZE = 9;
  const N = 81;
  const MAX_PLY = 400;

  const FU = 1, KY = 2, KE = 3, GI = 4, KA = 5, HI = 6, KI = 7, OU = 8;
  const PROMO = 8;            // 成ると種類が +8（歩→と、角→馬 など）
  const PROMOTE_BIT = 1 << 14;

  const SIDES = [
    { name: '先手', mark: '▲', color: 'あお' },
    { name: '後手', mark: '△', color: 'あか' },
  ];

  // 方向 0〜7：上・右上・右・右下・下・左下・左・左上（先手から見た向き。上が前）
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const FLIP = [4, 3, 2, 1, 0, 7, 6, 5]; // 後手は上下が逆
  const M = (...ds) => ds.reduce((a, d) => a | (1 << d), 0);
  const ORTH = M(0, 2, 4, 6), DIAG = M(1, 3, 5, 7), ALL = 255;
  const GOLD = M(0, 1, 2, 4, 6, 7);

  // step = 1マスだけ動ける方向、slide = どこまでも動ける方向、jump = 桂馬とび
  const PIECES = [
    null,
    { kanji: '歩', kifu: '歩', name: 'ふ', formal: '歩兵', step: M(0), slide: 0,
      desc: 'まえに 1マスだけ すすめるよ。いちばん 数が おおい こま。' },
    { kanji: '香', kifu: '香', name: 'きょう', formal: '香車', step: 0, slide: M(0),
      desc: 'まえに まっすぐ、どこまでも すすめるよ。うしろや よこには うごけない。' },
    { kanji: '桂', kifu: '桂', name: 'けい', formal: '桂馬', step: 0, slide: 0, jump: true,
      desc: 'まえに 2つ・よこに 1つの ところへ ジャンプ！ ほかの こまを とびこえられるよ。' },
    { kanji: '銀', kifu: '銀', name: 'ぎん', formal: '銀将', step: M(0, 1, 7, 3, 5), slide: 0,
      desc: 'まえと ななめ 4ほうこうに 1マス。よこと まうしろには うごけない。' },
    { kanji: '角', kifu: '角', name: 'かく', formal: '角行', step: 0, slide: DIAG,
      desc: 'ななめに、どこまでも すすめるよ。' },
    { kanji: '飛', kifu: '飛', name: 'ひしゃ', formal: '飛車', step: 0, slide: ORTH,
      desc: 'たて・よこに、どこまでも すすめるよ。いちばん つよい こま。' },
    { kanji: '金', kifu: '金', name: 'きん', formal: '金将', step: GOLD, slide: 0,
      desc: 'ななめうしろ いがいの 6ほうこうに 1マス。王さまを まもるのが とくい。' },
    { kanji: '玉', kifu: '玉', name: 'おう', formal: '王将・玉将', step: ALL, slide: 0,
      desc: 'まわりの 8ほうこうに 1マス。とられたら まけ！ だいじに まもろう。' },
    { kanji: 'と', kifu: 'と', name: 'と', formal: 'と金', step: GOLD, slide: 0, base: FU,
      desc: '歩が なった こま。金と おなじ うごきに パワーアップ！' },
    { kanji: '杏', kifu: '成香', name: 'なりきょう', formal: '成香', step: GOLD, slide: 0, base: KY,
      desc: '香が なった こま。金と おなじ うごきに なるよ。' },
    { kanji: '圭', kifu: '成桂', name: 'なりけい', formal: '成桂', step: GOLD, slide: 0, base: KE,
      desc: '桂が なった こま。金と おなじ うごきに なるよ。' },
    { kanji: '全', kifu: '成銀', name: 'なりぎん', formal: '成銀', step: GOLD, slide: 0, base: GI,
      desc: '銀が なった こま。金と おなじ うごきに なるよ。' },
    { kanji: '馬', kifu: '馬', name: 'うま', formal: '竜馬', step: ORTH, slide: DIAG, base: KA,
      desc: '角が なった こま。ななめに どこまでも ＋ たて・よこに 1マス。' },
    { kanji: '龍', kifu: '龍', name: 'りゅう', formal: '竜王', step: DIAG, slide: ORTH, base: HI,
      desc: '飛が なった こま。たて・よこに どこまでも ＋ ななめに 1マス。さいきょう！' },
  ];
  const HAND_ORDER = [HI, KA, KI, GI, KE, KY, FU];

  function flipMask(m) {
    let r = 0;
    for (let d = 0; d < 8; d++) if (m & (1 << d)) r |= 1 << FLIP[d];
    return r;
  }
  // 盤の向きで表した各陣営の動き
  const STEP = [new Uint8Array(15), new Uint8Array(15)];
  const SLIDE = [new Uint8Array(15), new Uint8Array(15)];
  for (let t = 1; t < 15; t++) {
    STEP[0][t] = PIECES[t].step; SLIDE[0][t] = PIECES[t].slide;
    STEP[1][t] = flipMask(PIECES[t].step); SLIDE[1][t] = flipMask(PIECES[t].slide);
  }

  // 駒落ち（ハンデ）。座標は上側（後手）の駒。下側に適用するときは点対称に移す
  const HANDICAPS = {
    none: { name: 'なし', remove: [] },
    kyo: { name: '香落ち', remove: [[8, 0]] },
    kaku: { name: '角落ち', remove: [[7, 1]] },
    hisha: { name: '飛車落ち', remove: [[1, 1]] },
    two: { name: '二枚落ち（飛車・角）', remove: [[1, 1], [7, 1]] },
    four: { name: '四枚落ち（飛車・角・香）', remove: [[1, 1], [7, 1], [0, 0], [8, 0]] },
    six: { name: '六枚落ち（飛車・角・香・桂）', remove: [[1, 1], [7, 1], [0, 0], [8, 0], [1, 0], [7, 0]] },
  };
  const HANDICAP_ORDER = ['none', 'kyo', 'kaku', 'hisha', 'two', 'four', 'six'];

  const FW = '０１２３４５６７８９';
  const KN = '〇一二三四五六七八九';

  function inB(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }
  function sideOf(p) { return p > 0 ? 0 : 1; }
  function typeOf(p) { return p < 0 ? -p : p; }
  function baseType(t) { return t > PROMO ? t - PROMO : t; }
  function canPromoteType(t) { return t >= FU && t <= HI; }
  function inZone(side, y) { return side === 0 ? y <= 2 : y >= 6; }
  // そこに置くと二度と動けなくなる（行き所のない駒）
  function deadEnd(t, side, y) {
    if (t === FU || t === KY) return side === 0 ? y === 0 : y === 8;
    if (t === KE) return side === 0 ? y <= 1 : y >= 7;
    return false;
  }
  function pieceKanji(t, side) { return t === OU ? (side === 0 ? '玉' : '王') : PIECES[t].kanji; }
  function sqName(sq) { return FW[9 - sq % 9] + KN[((sq / 9) | 0) + 1]; }

  // ---- 指し手の符号化 ----

  function mFrom(m) { return m & 127; }
  function mTo(m) { return (m >> 7) & 127; }
  function mPromote(m) { return (m & PROMOTE_BIT) !== 0; }
  function mDrop(m) { const f = m & 127; return f > 80 ? f - 80 : 0; }
  function encode(from, to, promote) { return from | (to << 7) | (promote ? PROMOTE_BIT : 0); }
  function dropMove(t, to) { return (80 + t) | (to << 7); }

  // ---- 指し手生成（王手放置などは見ない「疑似合法手」）----

  function pushMove(out, side, t, from, fy, to, ty) {
    const base = from | (to << 7);
    if (canPromoteType(t) && (inZone(side, fy) || inZone(side, ty))) {
      out.push(base | PROMOTE_BIT);
      if (!deadEnd(t, side, ty)) out.push(base);
    } else {
      out.push(base);
    }
  }

  function genMoves(board, hands, side, out, capsOnly) {
    const own = side === 0 ? 1 : -1;
    const st = STEP[side], sl = SLIDE[side];
    for (let sq = 0; sq < N; sq++) {
      const p = board[sq] * own;
      if (p <= 0) continue;
      const x = sq % 9, y = (sq / 9) | 0;
      if (p === KE) {
        const ty = y - 2 * own;
        if (ty < 0 || ty > 8) continue;
        for (let dx = -1; dx <= 1; dx += 2) {
          const tx = x + dx;
          if (tx < 0 || tx > 8) continue;
          const to = ty * 9 + tx;
          const q = board[to] * own;
          if (q > 0 || (capsOnly && !q)) continue;
          pushMove(out, side, p, sq, y, to, ty);
        }
        continue;
      }
      const sm = st[p], lm = sl[p];
      for (let d = 0; d < 8; d++) {
        const bit = 1 << d;
        if (!((sm | lm) & bit)) continue;
        const dx = DIRS[d][0], dy = DIRS[d][1];
        let tx = x + dx, ty = y + dy;
        while (tx >= 0 && ty >= 0 && tx < 9 && ty < 9) {
          const to = ty * 9 + tx;
          const q = board[to] * own;
          if (q > 0) break;
          if (!capsOnly || q < 0) pushMove(out, side, p, sq, y, to, ty);
          if (q < 0 || !(lm & bit)) break;
          tx += dx; ty += dy;
        }
      }
    }
    if (capsOnly) return out;
    // 持ち駒を打つ
    const hb = side * 8;
    let pawnFiles = 0;
    if (hands[hb + FU]) for (let sq = 0; sq < N; sq++) if (board[sq] === FU * own) pawnFiles |= 1 << (sq % 9);
    for (let t = FU; t <= KI; t++) {
      if (!hands[hb + t]) continue;
      for (let sq = 0; sq < N; sq++) {
        if (board[sq]) continue;
        if (deadEnd(t, side, (sq / 9) | 0)) continue;
        if (t === FU && (pawnFiles & (1 << (sq % 9)))) continue; // 二歩
        out.push((80 + t) | (sq << 7));
      }
    }
    return out;
  }

  // 盤上の駒 1枚が（王手などを考えずに）動けるマス。相手の駒の「届く範囲」の表示用
  function reachFrom(board, sq) {
    const p = board[sq];
    if (!p) return [];
    const side = sideOf(p);
    const out = [];
    const ms = genMoves(board, new Int8Array(16), side, [], false);
    for (const m of ms) if (mFrom(m) === sq && !out.includes(mTo(m))) out.push(mTo(m));
    return out;
  }

  // ---- 利き ----

  function attacked(board, sq, by) {
    const sgn = by === 0 ? 1 : -1;
    const x = sq % 9, y = (sq / 9) | 0;
    const st = STEP[by], sl = SLIDE[by];
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      const od = 1 << ((d + 4) & 7);
      let cx = x + dx, cy = y + dy, first = true;
      while (cx >= 0 && cy >= 0 && cx < 9 && cy < 9) {
        const p = board[cy * 9 + cx] * sgn;
        if (p) {
          if (p > 0 && ((sl[p] & od) || (first && (st[p] & od)))) return true;
          break;
        }
        first = false; cx += dx; cy += dy;
      }
    }
    const ky = y + 2 * sgn;
    if (ky >= 0 && ky < 9) {
      if (x > 0 && board[ky * 9 + x - 1] === KE * sgn) return true;
      if (x < 8 && board[ky * 9 + x + 1] === KE * sgn) return true;
    }
    return false;
  }

  // sq に利いている by 側の駒のマス一覧
  function attackers(board, sq, by) {
    const sgn = by === 0 ? 1 : -1;
    const x = sq % 9, y = (sq / 9) | 0;
    const st = STEP[by], sl = SLIDE[by];
    const res = [];
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      const od = 1 << ((d + 4) & 7);
      let cx = x + dx, cy = y + dy, first = true;
      while (cx >= 0 && cy >= 0 && cx < 9 && cy < 9) {
        const p = board[cy * 9 + cx] * sgn;
        if (p) {
          if (p > 0 && ((sl[p] & od) || (first && (st[p] & od)))) res.push(cy * 9 + cx);
          break;
        }
        first = false; cx += dx; cy += dy;
      }
    }
    const ky = y + 2 * sgn;
    if (ky >= 0 && ky < 9) {
      if (x > 0 && board[ky * 9 + x - 1] === KE * sgn) res.push(ky * 9 + x - 1);
      if (x < 8 && board[ky * 9 + x + 1] === KE * sgn) res.push(ky * 9 + x + 1);
    }
    return res;
  }

  function kingSq(board, side) {
    const k = side === 0 ? OU : -OU;
    for (let sq = 0; sq < N; sq++) if (board[sq] === k) return sq;
    return -1;
  }
  function inCheck(board, side) {
    const k = kingSq(board, side);
    return k >= 0 && attacked(board, k, 1 - side);
  }

  // ---- 指す・戻す（盤を直接書き換える。戻り値は取った駒）----

  function make(board, hands, side, m) {
    const from = m & 127, to = (m >> 7) & 127;
    if (from > 80) {
      const t = from - 80;
      board[to] = side === 0 ? t : -t;
      hands[side * 8 + t]--;
      return 0;
    }
    const p = board[from];
    const cap = board[to];
    if (cap) hands[side * 8 + baseType(cap < 0 ? -cap : cap)]++;
    board[to] = (m & PROMOTE_BIT) ? (p > 0 ? p + PROMO : p - PROMO) : p;
    board[from] = 0;
    return cap;
  }

  function unmake(board, hands, side, m, cap) {
    const from = m & 127, to = (m >> 7) & 127;
    if (from > 80) {
      board[to] = 0;
      hands[side * 8 + from - 80]++;
      return;
    }
    const p = board[to];
    board[from] = (m & PROMOTE_BIT) ? (p > 0 ? p - PROMO : p + PROMO) : p;
    board[to] = cap;
    if (cap) hands[side * 8 + baseType(cap < 0 ? -cap : cap)]--;
  }

  // ---- 合法手 ----

  // strict = 打ち歩詰めも禁じる。firstOnly = 1手見つかったら終わる
  function legalRaw(board, hands, side, strict, firstOnly) {
    const out = genMoves(board, hands, side, []);
    const res = [];
    for (const m of out) {
      const cap = make(board, hands, side, m);
      let ok = !inCheck(board, side);
      if (ok && strict && (m & 127) === 80 + FU && inCheck(board, 1 - side) &&
          !legalRaw(board, hands, 1 - side, false, true).length) ok = false; // 打ち歩詰め
      unmake(board, hands, side, m, cap);
      if (ok) {
        res.push(m);
        if (firstOnly) return res;
      }
    }
    return res;
  }

  function legalMoves(s) {
    if (s.winner !== null) return [];
    return legalRaw(s.board.slice(), s.hands.slice(), s.turn, true, false);
  }

  // ---- 局面 ----

  function newGame(opts) {
    opts = opts || {};
    const board = new Int8Array(N);
    const back = [KY, KE, GI, KI, OU, KI, GI, KE, KY];
    for (let x = 0; x < 9; x++) {
      board[x] = -back[x];
      board[18 + x] = -FU;
      board[54 + x] = FU;
      board[72 + x] = back[x];
    }
    board[9 + 1] = -HI; board[9 + 7] = -KA;
    board[63 + 1] = KA; board[63 + 7] = HI;
    const hc = HANDICAPS[opts.handicap] || HANDICAPS.none;
    const hs = opts.handicapSide === 0 ? 0 : 1;
    for (const [x, y] of hc.remove) {
      const sq = y * 9 + x;
      board[hs === 1 ? sq : 80 - sq] = 0;
    }
    const s = {
      board, hands: new Int8Array(16), turn: 0, ply: 0,
      handicap: opts.handicap || 'none', handicapSide: hs,
      keys: [], checks: [], kifu: [], last: null, inCheck: false,
      winner: null, result: null,
    };
    s.keys.push(posKey(s));
    return s;
  }

  function clone(s) {
    return {
      board: s.board.slice(), hands: s.hands.slice(), turn: s.turn, ply: s.ply,
      handicap: s.handicap, handicapSide: s.handicapSide,
      keys: s.keys.slice(), checks: s.checks.slice(), kifu: s.kifu.slice(),
      last: s.last, inCheck: s.inCheck, winner: s.winner, result: s.result,
    };
  }

  function posKey(s) { return s.turn + ':' + s.board.join(',') + ':' + s.hands.join(','); }

  function moveText(s, m) {
    const side = s.turn;
    const from = mFrom(m), to = mTo(m), drop = mDrop(m);
    const t = drop || typeOf(s.board[from]);
    let txt = SIDES[side].mark + (s.last && s.last.to === to ? '同' : sqName(to)) + PIECES[t].kifu.replace('玉', side === 0 ? '玉' : '王');
    if (drop) txt += '打';
    else if (mPromote(m)) txt += '成';
    else if (canPromoteType(t) && (inZone(side, (from / 9) | 0) || inZone(side, (to / 9) | 0))) txt += '不成';
    return txt;
  }

  function apply(s, m) {
    const n = clone(s);
    const side = s.turn;
    const from = mFrom(m), to = mTo(m), drop = mDrop(m);
    const piece = drop || typeOf(s.board[from]);
    n.kifu.push(moveText(s, m));
    const cap = make(n.board, n.hands, side, m);
    n.last = { move: m, from: drop ? -1 : from, to, drop, promote: mPromote(m), piece, captured: cap ? baseType(typeOf(cap)) : 0, capturedRaw: cap ? typeOf(cap) : 0, side };
    n.turn = 1 - side;
    n.ply++;
    n.inCheck = inCheck(n.board, n.turn);
    n.checks.push(n.inCheck);
    const key = posKey(n);
    n.keys.push(key);

    if (!legalRaw(n.board, n.hands, n.turn, true, true).length) {
      n.winner = side;
      n.result = n.inCheck ? 'mate' : 'nomove';
      return n;
    }
    // 千日手：同じ局面が 4 回。連続王手で起きたら王手をかけ続けた側の負け
    const seen = [];
    for (let k = 0; k < n.keys.length; k++) if (n.keys[k] === key) seen.push(k);
    if (seen.length >= 4) {
      const first = seen[0];
      for (const p of [0, 1]) {
        let all = true, any = false;
        for (let k = first + 1; k <= n.ply; k++) {
          if ((k - 1) % 2 !== p) continue;
          any = true;
          if (!n.checks[k - 1]) { all = false; break; }
        }
        if (any && all) { n.winner = 1 - p; n.result = 'perpetual'; return n; }
      }
      n.winner = -1;
      n.result = 'sennichite';
      return n;
    }
    if (n.ply >= MAX_PLY) { n.winner = -1; n.result = 'maxply'; }
    return n;
  }

  function resign(s) {
    const n = clone(s);
    n.winner = 1 - s.turn;
    n.result = 'resign';
    return n;
  }

  // 局面をそのまま保存・復元できる形に
  function replay(opts, moves) {
    let s = newGame(opts);
    for (const m of moves) {
      if (s.winner !== null) break;
      if (!legalMoves(s).includes(m)) break;
      s = apply(s, m);
    }
    return s;
  }

  global.Engine = {
    SIZE, N, MAX_PLY, FU, KY, KE, GI, KA, HI, KI, OU, PROMO, PROMOTE_BIT,
    SIDES, DIRS, PIECES, HAND_ORDER, STEP, SLIDE, HANDICAPS, HANDICAP_ORDER,
    inB, sideOf, typeOf, baseType, canPromoteType, inZone, deadEnd, pieceKanji, sqName,
    mFrom, mTo, mPromote, mDrop, encode, dropMove,
    genMoves, reachFrom, attacked, attackers, kingSq, inCheck, make, unmake, legalRaw, legalMoves,
    newGame, clone, posKey, moveText, apply, resign, replay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
