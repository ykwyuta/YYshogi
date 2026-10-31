/*
 * うごきがみえる将棋 — 画面表示と操作
 */
(function () {
  'use strict';
  const E = window.Engine;
  const AI = window.AI;
  const P = E.PIECES;
  const $ = id => document.getElementById(id);
  const STORE = 'yyshogi.v1';

  const app = {
    G: null,
    states: [],         // states[k] = k 手目のあとの局面（まった用）
    moves: [],
    mode: 'cpu',        // 'cpu' | 'two'
    human: [true, false],
    level: 'easy',
    handicap: 'none',
    flip: false,        // 後手を下に表示する
    sel: null,          // {kind:'board', sq} | {kind:'hand', side, t} | {kind:'look', sq}
    legal: [],
    targets: new Map(), // 選択中の駒の行き先 → 指し手の配列
    hint: null,
    busy: false,
    token: 0,           // 新しいゲームやまったで、古い CPU の思考結果を捨てるため
    anim: null,
    settings: { guide: true, danger: true, furi: true, sound: true },
  };

  const cells = [];

  // ---------- 保存 ----------

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        settings: app.settings,
        game: { mode: app.mode, human: app.human, level: app.level, handicap: app.handicap, flip: app.flip, moves: app.moves },
      }));
    } catch (e) { /* 保存できない環境でも遊べる */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // ---------- 駒の絵 ----------

  // 駒の絵（100×100）。down = 下向き（相手側）。文字は読みやすいよう常に正立させる
  function pieceSVG(t, side, down, opts) {
    opts = opts || {};
    const pc = P[t];
    const promoted = t > E.OU;
    const guide = opts.guide !== undefined ? opts.guide : app.settings.guide;
    let g = '<polygon class="koma" points="50,13 74,22 80,87 20,87 26,22"/>';
    if (guide) g += markers(t);
    const rot = down ? ' transform="rotate(180 50 50)"' : '';
    const kanji = E.pieceKanji(t, side);
    const furi = opts.furi !== false;
    const ky = down ? 54 : 50;
    let txt = `<text class="kj${promoted ? ' red' : ''}" x="50" y="${ky}">${kanji}</text>`;
    if (furi) {
      const nm = pc.name;
      const fit = nm.length > 3 ? ` textLength="${Math.min(46, nm.length * 10)}" lengthAdjust="spacingAndGlyphs"` : '';
      txt += `<text class="furi" x="50" y="${down ? 30 : 76}"${fit}>${nm}</text>`;
    }
    return `<svg class="pc s${side}${down ? ' down' : ''}" viewBox="0 0 100 100" aria-hidden="true"><g${rot}>${g}</g>${txt}</svg>`;
  }

  // うごきマーク：● = 1マス、▲ = どこまでも、○ = ジャンプ（駒が上を向いた向きで描く）
  function markers(t) {
    const pc = P[t];
    let h = '';
    for (let d = 0; d < 8; d++) {
      const bit = 1 << d;
      const r = d % 2 ? 55 : 42;
      const rot = `rotate(${d * 45} 50 50)`;
      if (pc.slide & bit) h += `<path class="mk" d="M50,${50 - r - 6}l7,10h-14z" transform="${rot}"/>`;
      else if (pc.step & bit) h += `<circle class="mk" cx="50" cy="${50 - r}" r="5.5" transform="${rot}"/>`;
    }
    if (pc.jump) h += '<circle class="mk-jump" cx="25" cy="8" r="5"/><circle class="mk-jump" cx="75" cy="8" r="5"/>';
    return h;
  }

  // 5×5 の「うごきの図」
  function diagramSVG(t, side, down) {
    const pc = P[t];
    const f = down ? -1 : 1;
    let h = '';
    for (let i = 0; i <= 5; i++) h += `<path class="dg-line" d="M${i * 20},0V100M0,${i * 20}H100"/>`;
    const cell = (x, y, cls) => `<rect class="${cls}" x="${x * 20 + 1}" y="${y * 20 + 1}" width="18" height="18" rx="3"/>`;
    let marks = '';
    for (let d = 0; d < 8; d++) {
      const bit = 1 << d;
      const dx = E.DIRS[d][0] * f, dy = E.DIRS[d][1] * f;
      if (pc.slide & bit) {
        for (let k = 1; k <= 2; k++) h += cell(2 + dx * k, 2 + dy * k, 'dg-slide');
        const x2 = 50 + dx * 46, y2 = 50 + dy * 46;
        marks += `<path class="dg-arrow" d="M${50 + dx * 12},${50 + dy * 12}L${x2 - dx * 4},${y2 - dy * 4}"/>`;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI;
        marks += `<path class="dg-head" d="M0,-5L8,0L0,5z" transform="translate(${x2 - dx * 3} ${y2 - dy * 3}) rotate(${ang})"/>`;
      } else if (pc.step & bit) {
        h += cell(2 + dx, 2 + dy, 'dg-step');
        marks += `<circle class="dg-dot" cx="${50 + dx * 20}" cy="${50 + dy * 20}" r="5"/>`;
      }
    }
    if (pc.jump) {
      for (const dx of [-1, 1]) {
        h += cell(2 + dx, 2 - 2 * f, 'dg-step');
        marks += `<circle class="dg-ring" cx="${50 + dx * 20}" cy="${50 - 40 * f}" r="5"/>`;
      }
    }
    h += `<rect class="dg-center" x="41" y="41" width="18" height="18" rx="3"/>`;
    h += `<text class="dg-kj${t > E.OU ? ' red' : ''}" x="50" y="51">${E.pieceKanji(t, side)}</text>`;
    return `<svg class="diagram s${side}" viewBox="-2 -2 104 104" aria-hidden="true">${h}${marks}</svg>`;
  }

  // ---------- 初期化 ----------

  function init() {
    const board = $('board');
    for (let v = 0; v < E.N; v++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.v = v;
      board.appendChild(c);
      cells.push(c);
    }
    board.addEventListener('click', e => {
      const c = e.target.closest('.cell');
      if (c) onCell(viewToSq(+c.dataset.v));
    });
    for (const id of ['player-top', 'player-bottom']) {
      $(id).addEventListener('click', e => {
        const b = e.target.closest('.hand-pc');
        if (b) onHand(+b.dataset.side, +b.dataset.t);
      });
    }

    $('btn-menu').addEventListener('click', () => { $('btn-resign').disabled = !canResign(); $('dlg-menu').showModal(); });
    $('btn-guide').addEventListener('click', () => $('dlg-guide').showModal());
    $('btn-hint').addEventListener('click', onHint);
    $('btn-undo').addEventListener('click', onUndo);

    $('dlg-menu').addEventListener('close', () => {
      const v = $('dlg-menu').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'howto') $('dlg-howto').showModal();
      else if (v === 'guide') $('dlg-guide').showModal();
      else if (v === 'settings') openSettings();
      else if (v === 'resign') onResign();
    });
    const fNew = $('dlg-new').querySelector('form');
    fNew.addEventListener('change', syncNewForm);
    $('dlg-new').addEventListener('close', () => {
      if ($('dlg-new').returnValue !== 'ok') return;
      const order = fNew.order.value === 'random' ? (Math.random() < 0.5 ? 'first' : 'second') : fNew.order.value;
      startGame({ mode: fNew.mode.value, level: fNew.level.value, order, handicap: fNew.handicap.value });
    });
    $('dlg-settings').addEventListener('close', () => {
      const f = $('dlg-settings').querySelector('form');
      for (const k of Object.keys(app.settings)) app.settings[k] = f[k].checked;
      applySettings();
      save();
      render();
    });
    $('dlg-result').addEventListener('close', () => {
      const v = $('dlg-result').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'undo') onUndo();
    });
    $('dlg-promote').addEventListener('close', () => {
      const v = $('dlg-promote').returnValue;
      const pend = app.pendingPromo;
      app.pendingPromo = null;
      if (!pend || (v !== 'yes' && v !== 'no')) return;
      commit(pend.find(m => E.mPromote(m) === (v === 'yes')));
    });
    // 「なりますか？」は外側をタップしても閉じない（選ぶまで待つ）
    $('dlg-promote').addEventListener('cancel', e => e.preventDefault());

    const sel = $('sel-handicap');
    sel.innerHTML = E.HANDICAP_ORDER.map(k => `<option value="${k}">${E.HANDICAPS[k].name}</option>`).join('');

    fillGuide();
    new ResizeObserver(() => {
      const w = $('board').clientWidth / 9;
      document.body.classList.toggle('roomy', w >= 46);
    }).observe($('board'));

    const saved = load();
    if (saved && saved.settings) Object.assign(app.settings, saved.settings);
    applySettings();
    const g = saved && saved.game;
    if (g && Array.isArray(g.moves)) {
      app.mode = g.mode === 'two' ? 'two' : 'cpu';
      app.human = g.human || [true, false];
      app.level = AI.LEVELS[g.level] ? g.level : 'easy';
      app.handicap = E.HANDICAPS[g.handicap] ? g.handicap : 'none';
      app.flip = !!g.flip;
      rebuild(g.moves);
      renderLabels();
      render();
      if (app.G.winner === null) proceed();
    } else {
      startGame({ mode: 'cpu', level: 'easy', order: 'first', handicap: 'none' }, true);
      openNew(true);
    }
  }

  function applySettings() {
    document.body.classList.toggle('no-furi', !app.settings.furi);
  }

  function openSettings() {
    const f = $('dlg-settings').querySelector('form');
    for (const k of Object.keys(app.settings)) f[k].checked = app.settings[k];
    $('dlg-settings').showModal();
  }

  function openNew(first) {
    const f = $('dlg-new').querySelector('form');
    f.mode.value = app.mode;
    f.level.value = app.level;
    f.handicap.value = app.handicap;
    $('welcome').hidden = !first;
    $('btn-new-cancel').hidden = !!first;
    syncNewForm();
    $('dlg-new').showModal();
  }
  function syncNewForm() {
    const f = $('dlg-new').querySelector('form');
    const cpu = f.mode.value === 'cpu';
    f.querySelectorAll('.cpu-only').forEach(el => { el.hidden = !cpu; });
    $('hc-legend').textContent = cpu ? 'ハンデ（CPU の こまを へらす）' : 'ハンデ（あか の こまを へらす）';
  }

  function fillGuide() {
    const card = t => `<div class="g-item">${pieceSVG(t, 0, false, { guide: true, furi: false })}` +
      `<div class="g-body"><div class="g-head"><b>${P[t].kanji}</b><small>${P[t].name}</small></div><p>${P[t].desc}</p></div>${diagramSVG(t, 0, false)}</div>`;
    $('guide-base').innerHTML = [E.OU, E.HI, E.KA, E.KI, E.GI, E.KE, E.KY, E.FU].map(card).join('');
    $('guide-promo').innerHTML = [14, 13, 12, 11, 10, 9].map(card).join('');
  }

  function startGame(o, silent) {
    app.token++;
    app.busy = false;
    app.mode = o.mode;
    app.level = o.level || 'easy';
    app.handicap = o.handicap || 'none';
    if (o.mode === 'cpu') {
      app.human = o.order === 'second' ? [false, true] : [true, false];
      app.flip = o.order === 'second';
    } else {
      app.human = [true, true];
      app.flip = false;
    }
    rebuild([]);
    $('kifu').innerHTML = '';
    renderLabels();
    save();
    render();
    if (!silent) proceed();
  }

  function gameOpts() {
    // ハンデは CPU 側（ふたりで遊ぶときは後手）から駒を減らす
    const hs = app.mode === 'cpu' ? (app.human[0] ? 1 : 0) : 1;
    return { handicap: app.handicap, handicapSide: hs };
  }

  function rebuild(moves) {
    let s = E.newGame(gameOpts());
    app.states = [s];
    app.moves = [];
    for (const m of moves) {
      if (s.winner !== null || !E.legalMoves(s).includes(m)) break;
      s = E.apply(s, m);
      app.states.push(s);
      app.moves.push(m);
    }
    app.G = s;
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(s);
  }

  // ---------- 盤の向き ----------

  function viewToSq(v) { return app.flip ? 80 - v : v; }
  function sqToView(sq) { return app.flip ? 80 - sq : sq; }
  function bottomSide() { return app.flip ? 1 : 0; }
  function isDown(side) { return side !== bottomSide(); }

  function renderLabels() {
    let f = '', r = '';
    for (let v = 0; v < 9; v++) {
      const x = app.flip ? 8 - v : v;
      f += `<span>${9 - x}</span>`;
      r += `<span>${'一二三四五六七八九'[app.flip ? 8 - v : v]}</span>`;
    }
    $('files').innerHTML = f;
    $('ranks').innerHTML = r;
  }

  // ---------- 状態の問い合わせ ----------

  function humanTurn() { return app.G.winner === null && app.human[app.G.turn] && !app.busy; }
  function canResign() { return app.G.winner === null && app.human[app.G.turn] && !app.busy && app.G.ply > 0; }

  function playerName(side) {
    if (app.mode === 'two') return side === 0 ? 'あお' : 'あか';
    return app.human[side] ? 'あなた' : 'CPU';
  }

  function computeTargets() {
    app.targets = new Map();
    const sel = app.sel;
    if (!sel || !humanTurn()) return;
    for (const m of app.legal) {
      const ok = sel.kind === 'board' ? E.mFrom(m) === sel.sq : sel.kind === 'hand' && sel.side === app.G.turn && E.mDrop(m) === sel.t;
      if (!ok) continue;
      const to = E.mTo(m);
      if (!app.targets.has(to)) app.targets.set(to, []);
      app.targets.get(to).push(m);
    }
  }

  const pieceValue = t => (t === E.OU ? 99999 : AI.VAL[t]);

  // b の sq にいる駒が、相手に取られて損をしそうか（ただ取られる／安い駒と交換になる）
  function inDanger(b, sq) {
    const p = b[sq];
    if (!p) return false;
    const side = E.sideOf(p), t = E.typeOf(p);
    const atk = E.attackers(b, sq, 1 - side);
    if (!atk.length) return false;
    if (t === E.OU) return true;
    const def = E.attackers(b, sq, side);
    if (!def.length) return true;
    let min = Infinity;
    for (const a of atk) {
      const at = E.typeOf(b[a]);
      if (at !== E.OU) min = Math.min(min, pieceValue(at));
    }
    return min < pieceValue(t);
  }

  function dangerAfter(m) {
    const b = app.G.board.slice(), h = app.G.hands.slice();
    E.make(b, h, app.G.turn, m);
    return inDanger(b, E.mTo(m));
  }

  // ---------- 描画 ----------

  function render() {
    computeTargets();
    renderBoard();
    renderPlayers();
    renderStatus();
    renderInfo();
    renderKifu();
    $('btn-hint').disabled = !humanTurn();
    $('btn-undo').disabled = !canUndo();
  }

  function renderBoard() {
    const G = app.G;
    const sel = app.sel;
    const look = new Set();
    let zoneSide = -1;
    if (sel && sel.kind === 'look') for (const sq of E.reachFrom(G.board, sel.sq)) look.add(sq);
    if (sel && sel.kind === 'board' && humanTurn()) {
      const t = E.typeOf(G.board[sel.sq]);
      if (E.canPromoteType(t)) zoneSide = G.turn;
    }
    const kingInCheck = G.inCheck ? E.kingSq(G.board, G.turn) : -1;
    const showDanger = app.settings.danger && humanTurn();
    const hintFrom = app.hint !== null && E.mFrom(app.hint) < 81 ? E.mFrom(app.hint) : -1;
    const hintTo = app.hint !== null ? E.mTo(app.hint) : -1;
    for (let sq = 0; sq < E.N; sq++) {
      const c = cells[sqToView(sq)];
      const y = (sq / 9) | 0, x = sq % 9;
      const cls = ['cell'];
      const p = G.board[sq];
      if (G.last && (G.last.from === sq || G.last.to === sq)) cls.push(G.last.to === sq ? 'last-to' : 'last-from');
      if (sel && (sel.kind === 'board' || sel.kind === 'look') && sel.sq === sq) cls.push('sel');
      if (zoneSide >= 0 && E.inZone(zoneSide, y)) cls.push('zone');
      if (sq === kingInCheck) cls.push('check');
      if (sq === hintFrom) cls.push('hint-from');
      if (sq === hintTo) cls.push('hint-to');
      let badge = '';
      const tg = app.targets.get(sq);
      if (tg) {
        cls.push(p ? 'tgt cap' : 'tgt');
        if (showDanger && tg.every(dangerAfter)) badge = '<span class="badge warn">!</span>';
      } else if (look.has(sq)) {
        cls.push('look');
      }
      if (!tg && p && showDanger && E.sideOf(p) === G.turn && inDanger(G.board, sq) && E.typeOf(p) !== E.OU) {
        badge = '<span class="badge hang">!</span>';
      }
      if ((x === 2 || x === 5) && (y === 2 || y === 5)) cls.push('star');
      c.className = cls.join(' ');
      c.innerHTML = (p ? pieceSVG(E.typeOf(p), E.sideOf(p), isDown(E.sideOf(p))) : '') + badge;
    }
  }

  function renderPlayers() {
    const G = app.G;
    const bs = bottomSide();
    for (const [id, side] of [['player-bottom', bs], ['player-top', 1 - bs]]) {
      const el = $(id);
      const active = G.turn === side && G.winner === null;
      el.className = `player s${side}${active ? ' active' : ''}${id === 'player-top' ? ' top' : ''}`;
      let h = `<div class="pname"><b><i class="dot s${side}"></i>${playerName(side)}</b><small>${E.SIDES[side].name}</small></div><div class="hand">`;
      let any = false;
      for (const t of E.HAND_ORDER) {
        const n = G.hands[side * 8 + t];
        if (!n) continue;
        any = true;
        const on = app.sel && app.sel.kind === 'hand' && app.sel.side === side && app.sel.t === t;
        const hinted = app.hint !== null && E.mDrop(app.hint) === t && G.turn === side;
        h += `<button type="button" class="hand-pc${on ? ' on' : ''}${hinted ? ' hinted' : ''}" data-side="${side}" data-t="${t}" aria-label="${P[t].kanji} ${n}まい">` +
          `${pieceSVG(t, side, isDown(side))}${n > 1 ? `<span class="cnt">${n}</span>` : ''}</button>`;
      }
      if (!any) h += '<span class="empty">もちごま なし</span>';
      el.innerHTML = h + '</div>';
    }
  }

  function renderStatus() {
    const G = app.G;
    const el = $('status');
    let cls = 's' + G.turn, text;
    const who = playerName(G.turn);
    if (G.winner !== null) {
      cls = 'end';
      text = G.winner === -1 ? 'ひきわけ' : `${playerName(G.winner)}の かち！`;
      text += '　<small>「メニュー」から あたらしく はじめられるよ</small>';
    } else if (!app.human[G.turn]) {
      cls += ' think';
      text = 'CPU が かんがえ中<span class="dots"><i></i><i></i><i></i></span>';
    } else if (G.inCheck) {
      cls += ' check';
      text = `<b>王手（おうて）！</b> ${app.mode === 'two' ? who + 'の ' : ''}王さまが ねらわれているよ。まもろう！`;
    } else if (app.hint !== null) {
      cls += ' hint';
      text = `ヒント：<b>${E.moveText(G, app.hint)}</b> が おすすめ！ ひかっている ところを タッチしてね`;
    } else if (app.sel && app.sel.kind === 'hand' && humanTurn()) {
      text = `${P[app.sel.t].kanji}（${P[app.sel.t].name}）を おく ところを えらんでね`;
    } else if (app.sel && app.sel.kind === 'board' && humanTurn()) {
      text = app.targets.size ? '<span class="lg lg-dot"></span> の ところに うごかせるよ' : 'この こまは いま うごかせないよ';
    } else {
      text = app.mode === 'two' ? `<b>${who}</b>の ばんだよ` : '<b>あなたの ばん</b>だよ。うごかす こまを タッチしてね';
    }
    el.className = 'status ' + cls;
    const last = G.last ? `<span class="lastmv">${playerName(G.last.side)}：${G.kifu[G.kifu.length - 1]}</span>` : '';
    el.innerHTML = `<span class="msg">${text}</span>${last}`;
  }

  function renderInfo() {
    const G = app.G;
    const info = $('info');
    const sel = app.sel;
    let t = 0, side = 0, where = '';
    if (sel && (sel.kind === 'board' || sel.kind === 'look')) {
      const p = G.board[sel.sq];
      if (p) { t = E.typeOf(p); side = E.sideOf(p); where = E.sqName(sel.sq); }
    } else if (sel && sel.kind === 'hand') {
      t = sel.t; side = sel.side; where = 'もちごま';
    }
    if (!t) {
      info.innerHTML =
        '<div class="tips"><p class="tip-main">こまを タッチすると、うごける ところが ひかるよ。</p>' +
        '<ul class="legend">' +
        '<li><span class="lg lg-dot"></span> うごける</li>' +
        '<li><span class="lg lg-cap"></span> あいての こまが とれる</li>' +
        `<li><span class="lg lg-warn">!</span> とられちゃうかも</li>` +
        '<li><span class="lg lg-look"></span> あいての こまが いける ところ</li>' +
        '</ul></div>';
      return;
    }
    const pc = P[t];
    const mine = app.human[side] && (app.mode === 'two' ? side === G.turn : true);
    const owner = app.mode === 'two' ? `${playerName(side)}の こま` : (mine ? 'あなたの こま' : 'CPU の こま');
    let extra = '';
    if (sel.kind === 'look' || !mine) extra = '<p class="note look">オレンジの ところに うごけるよ。きを つけて！</p>';
    else if (E.canPromoteType(t)) extra = `<p class="note">あいての じんちに はいると なれるよ → <b class="red">${P[t + E.PROMO].kanji}</b>（${P[t + E.PROMO].name}）</p>`;
    if (sel.kind === 'hand' && mine) extra = '<p class="note">あいている ところに おけるよ（打つ）。</p>';
    info.innerHTML =
      `<div class="card s${side}"><div class="card-pc">${pieceSVG(t, side, isDown(side), { guide: false, furi: false })}</div>` +
      `<div class="card-body"><div class="card-head"><b>${pc.kanji}</b><span class="yomi">${pc.name}</span>` +
      `<span class="owner s${side}">${owner}</span><span class="where">${where}</span></div>` +
      `<p class="desc">${pc.desc}</p>${extra}</div>` +
      `<div class="card-dg">${diagramSVG(t, side, isDown(side))}</div></div>`;
  }

  function renderKifu() {
    const ol = $('kifu');
    const k = app.G.kifu;
    if (ol.children.length > k.length) ol.innerHTML = '';
    for (let i = ol.children.length; i < k.length; i++) {
      const li = document.createElement('li');
      li.textContent = k[i];
      li.className = 's' + (i % 2);
      ol.appendChild(li);
    }
  }

  // ---------- 演出 ----------

  function animateMove() {
    const a = app.anim;
    app.anim = null;
    if (!a) return;
    const toCell = cells[sqToView(a.to)];
    const svg = toCell.querySelector('svg.pc');
    if (!svg) return;
    let from = null;
    if (a.from >= 0) from = cells[sqToView(a.from)].getBoundingClientRect();
    else {
      const handEl = $(a.side === bottomSide() ? 'player-bottom' : 'player-top').querySelector('.hand');
      if (handEl) from = handEl.getBoundingClientRect();
    }
    const r = toCell.getBoundingClientRect();
    if (!from) return;
    const dx = from.left + from.width / 2 - (r.left + r.width / 2);
    const dy = from.top + from.height / 2 - (r.top + r.height / 2);
    svg.style.transition = 'none';
    svg.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
    svg.style.zIndex = 5;
    svg.getBoundingClientRect();
    svg.style.transition = '';
    svg.style.transform = '';
    if (a.promote) setTimeout(() => toCell.classList.add('promo-flash'), 260);
    if (a.capture) setTimeout(() => toCell.classList.add('cap-flash'), 200);
  }

  let toastTimer = 0;
  function toast(html, cls) {
    const el = $('toast');
    el.innerHTML = html;
    el.className = 'toast show ' + (cls || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 1800);
  }

  let actx = null;
  function tone(freq, start, dur, type, vol) {
    const t0 = actx.currentTime + start;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol || 0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return o;
  }
  function sound(kind) {
    if (!app.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      if (kind === 'move') {
        const o = tone(900, 0, 0.09, 'triangle', 0.3);
        o.frequency.exponentialRampToValueAtTime(160, actx.currentTime + 0.08);
      } else if (kind === 'check') {
        tone(660, 0.05, 0.15, 'square', 0.08); tone(880, 0.2, 0.2, 'square', 0.08);
      } else if (kind === 'win') {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3, 'triangle', 0.22));
      } else if (kind === 'lose') {
        [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.35, 'sine', 0.2));
      }
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }

  function confetti() {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#2563eb', '#dc2626', '#f59e0b', '#16a34a', '#a855f7'];
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      box.appendChild(s);
    }
    setTimeout(() => { box.innerHTML = ''; }, 3600);
  }

  // ---------- 操作 ----------

  function onCell(sq) {
    const G = app.G;
    const tg = app.targets.get(sq);
    if (tg && humanTurn()) return tryMove(tg);
    const p = G.board[sq];
    if (!p) {
      app.sel = null;
    } else if (app.sel && (app.sel.kind === 'board' || app.sel.kind === 'look') && app.sel.sq === sq) {
      app.sel = null;
    } else if (humanTurn() && E.sideOf(p) === G.turn) {
      app.sel = { kind: 'board', sq };
    } else {
      app.sel = { kind: 'look', sq };
    }
    render();
  }

  function onHand(side, t) {
    const same = app.sel && app.sel.kind === 'hand' && app.sel.side === side && app.sel.t === t;
    app.sel = same ? null : { kind: 'hand', side, t };
    render();
  }

  function tryMove(ms) {
    if (ms.length > 1) {
      // 成る・成らないを選べる
      app.pendingPromo = ms;
      const m = ms[0];
      const from = E.mFrom(m);
      const t = E.typeOf(app.G.board[from]);
      const side = app.G.turn;
      const choice = (v, tt, label) =>
        `<button type="submit" value="${v}" class="promo-btn${v === 'yes' ? ' primary' : ''}">` +
        `<span class="pp">${pieceSVG(tt, side, false, { guide: false, furi: false })}</span>${diagramSVG(tt, side, false)}` +
        `<b>${label}</b><small>${P[tt].kanji}（${P[tt].name}）</small></button>`;
      $('promo-choices').innerHTML = choice('yes', t + E.PROMO, 'なる！') + choice('no', t, 'ならない');
      $('dlg-promote').showModal();
      return;
    }
    const m = ms[0];
    if (E.mPromote(m)) {
      const t = E.typeOf(app.G.board[E.mFrom(m)]);
      toast(`<b class="red">${P[t + E.PROMO].kanji}</b> に なった！`, 'promo');
    }
    commit(m);
  }

  function commit(m) {
    const prev = app.G;
    const G = E.apply(prev, m);
    app.states.push(G);
    app.moves.push(m);
    app.G = G;
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(G);
    app.anim = { from: G.last.from, to: G.last.to, side: prev.turn, promote: G.last.promote, capture: G.last.captured };
    save();
    render();
    animateMove();
    sound('move');
    if (G.last.captured) {
      const name = app.human[prev.turn] && app.mode === 'cpu' ? '' : `${playerName(prev.turn)}が `;
      toast(`${name}<b>${P[G.last.capturedRaw].kanji}</b> を とった！`, 'cap');
    } else if (G.last.promote && !app.human[prev.turn]) {
      toast(`CPU の こまが <b class="red">${P[G.last.piece + E.PROMO].kanji}</b> に なった`, 'promo');
    }
    if (G.winner !== null) return finish();
    if (G.inCheck) {
      setTimeout(() => sound('check'), 120);
      toast('<b>王手！</b>', 'check');
    }
    proceed();
  }

  function onHint() {
    if (!humanTurn()) return;
    const G = app.G;
    const btn = $('btn-hint');
    btn.disabled = true;
    btn.classList.add('busy');
    const tk = app.token;
    think(G, 'hint').then(m => {
      btn.classList.remove('busy');
      if (tk !== app.token || app.G !== G || m === null) { render(); return; }
      app.hint = m;
      app.sel = E.mDrop(m) ? { kind: 'hand', side: G.turn, t: E.mDrop(m) } : { kind: 'board', sq: E.mFrom(m) };
      render();
    });
  }

  function canUndo() {
    if (app.G.result === 'resign') return true;
    if (!app.moves.length) return false;
    if (app.mode === 'two') return true;
    return undoTarget() >= 0;
  }
  // まったで戻る先（人が指す番の局面のうち、いまより前で一番新しいもの）
  function undoTarget() {
    for (let k = app.moves.length - 1; k >= 0; k--) {
      if (app.human[k % 2]) return k;
    }
    return -1;
  }

  function onUndo() {
    if (app.G.result === 'resign') {
      // こうさんを取り消して、その局面から続ける
      app.G = app.states[app.states.length - 1];
      app.legal = E.legalMoves(app.G);
      save();
      render();
      return proceed();
    }
    if (!canUndo()) return;
    const k = app.mode === 'two' ? app.moves.length - 1 : undoTarget();
    app.token++;
    app.busy = false;
    app.moves.length = k;
    app.states.length = k + 1;
    app.G = app.states[k];
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(app.G);
    save();
    render();
    toast('1手 もどしたよ');
    proceed();
  }

  function onResign() {
    if (!canResign()) return;
    if (!confirm('こうさん しますか？')) return;
    app.G = E.resign(app.G); // states には積まない（まったで こうさん前に戻れる）
    app.legal = [];
    save();
    render();
    finish();
  }

  // ---------- CPU ----------

  let worker = null, workerOK = typeof Worker !== 'undefined', reqId = 0;
  const pending = new Map();
  function runLocal(job) {
    setTimeout(() => job.resolve(AI.think(job.G.board, job.G.hands, job.G.turn, job.level)), 30);
  }
  function getWorker() {
    if (!workerOK) return null;
    if (!worker) {
      try {
        worker = new Worker('js/worker.js');
        worker.onmessage = e => {
          const job = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (job) job.resolve(e.data.move);
        };
        worker.onerror = () => {
          // file:// などで Worker が使えないときは画面側で考える
          workerOK = false;
          worker = null;
          for (const job of pending.values()) runLocal(job);
          pending.clear();
        };
      } catch (e) {
        workerOK = false;
        worker = null;
      }
    }
    return worker;
  }
  function think(G, level) {
    return new Promise(resolve => {
      const job = { G, level, resolve };
      const w = getWorker();
      if (!w) return runLocal(job);
      const id = ++reqId;
      pending.set(id, job);
      w.postMessage({ id, board: Array.from(G.board), hands: Array.from(G.hands), turn: G.turn, level });
    });
  }

  function proceed() {
    const G = app.G;
    if (G.winner !== null || app.human[G.turn]) return;
    app.busy = true;
    render();
    const tk = app.token;
    const t0 = Date.now();
    think(G, app.level).then(m => {
      if (tk !== app.token || app.G !== G) return;
      setTimeout(() => {
        if (tk !== app.token || app.G !== G) return;
        app.busy = false;
        if (m === null) return render();
        commit(m);
      }, Math.max(0, 700 - (Date.now() - t0)));
    });
  }

  function finish() {
    const G = app.G;
    app.busy = false;
    render();
    let title, text;
    const solo = app.mode === 'cpu';
    const reason = {
      mate: '王さまを つかまえた（つみ）',
      nomove: 'あいてが もう うごけなく なった',
      resign: 'あいてが こうさんした',
      perpetual: '王手を かけつづけて おなじ かたちに なった（れんぞく王手の 千日手は、王手を かけた ほうの まけ）',
    }[G.result] || '';
    let cls = '';
    if (G.winner === -1) {
      title = 'ひきわけ';
      text = G.result === 'sennichite' ? 'おなじ かたちが 4かい でたので ひきわけ（千日手）だよ。' : 'てすうが おおく なったので ひきわけ だよ。';
    } else if (solo) {
      const won = app.human[G.winner];
      title = won ? 'かったよ！ おめでとう！' : 'まけちゃった…';
      cls = won ? 'win' : 'lose';
      if (won) text = G.result === 'resign' ? 'CPU が こうさん したよ。' : `${reason}よ！ すごい！`;
      else text = G.result === 'resign' ? 'こうさん したよ。また ちょうせん してね！' : '王さまが つかまっちゃった。「まった」で もどって やりなおせるよ！';
      if (G.result === 'perpetual') text = reason + '。';
      sound(won ? 'win' : 'lose');
      if (won) confetti();
    } else {
      title = `${playerName(G.winner)}の かち！`;
      cls = 'win';
      text = G.result === 'resign' ? `${playerName(1 - G.winner)}が こうさん したよ。` : `${reason}よ！`;
      if (G.result === 'perpetual') text = reason + '。';
      sound('win');
      confetti();
    }
    $('result-title').textContent = title;
    $('result-title').className = cls;
    $('result-text').textContent = text;
    $('btn-result-undo').hidden = !canUndo();
    setTimeout(() => { if (!document.querySelector('dialog[open]')) $('dlg-result').showModal(); }, 700);
  }

  window.ShogiApp = app; // デバッグ用
  document.addEventListener('DOMContentLoaded', init);
})();
