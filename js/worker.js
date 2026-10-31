/*
 * うごきがみえる将棋 — CPU の思考を別スレッドで動かす（画面が固まらないように）
 */
/* global importScripts, AI */
importScripts('rules.js', 'ai.js');
self.onmessage = e => {
  const { id, board, hands, turn, level } = e.data;
  const move = AI.think(Int8Array.from(board), Int8Array.from(hands), turn, level);
  self.postMessage({ id, move });
};
