/* coop_rules.js — 双人同屏合作的规则层：纯逻辑，不碰 DOM、不碰网络，浏览器和 Node 都能跑(window.COOP_RULES / module.exports)。
   房主、玩家两端用同一套 step()：房主用它「判定」，玩家用它「推演」房主广播来的事件；将来做合作地图求解器也直接复用它。

   ── 规范坐标 ──
   全局状态永远按「横屏(iPad)」的行列(r,c)存；竖屏设备只在显示和输入两处转置(toXsb / 方向互换)，状态本身不转置。
   方向用字母 U/D/L/R(和单机的 moveLog 同一套)。箱子用下标当身份(id)，推一步坐标变、id 不变。

   ── 合作关卡 XSB ──
   # 墙   空格 地板   . 目标   $ 箱子   * 目标上的箱子
   @ 1 号(房主)   + 1 号站在目标上   & 2 号(玩家)   % 2 号站在目标上
   要求：整张图的非墙格互相连通(显示时以本机角色为起点判断「地图内部」，不连通的区域会被当成空白)。 */
(function (root) {
'use strict';

const DIRS = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
const key = (r, c) => r + ',' + c;

/* 解析 XSB → 状态。不合法(缺 1 号/2 号/目标)返回 null */
function fromXsb(xsb) {
  const rows = String(xsb).split('\n');
  const G = { w: 0, h: rows.length, walls: new Set(), targets: new Set(), boxes: [], p: [null, null], d: ['D', 'D'], v: 0, moves: 0 };
  rows.forEach((row, r) => {
    G.w = Math.max(G.w, row.length);
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '#') { G.walls.add(key(r, c)); continue; }
      if (ch === '.' || ch === '*' || ch === '+' || ch === '%') G.targets.add(key(r, c));
      if (ch === '$' || ch === '*') G.boxes.push([r, c]);
      if (ch === '@' || ch === '+') G.p[0] = [r, c];
      if (ch === '&' || ch === '%') G.p[1] = [r, c];
    }
  });
  if (!G.p[0] || !G.p[1] || !G.targets.size) return null;
  return G;
}

function boxAt(G, r, c) { for (let i = 0; i < G.boxes.length; i++) if (G.boxes[i][0] === r && G.boxes[i][1] === c) return i; return -1; }
function playerAt(G, r, c, except) { for (let i = 0; i < 2; i++) if (i !== except && G.p[i][0] === r && G.p[i][1] === c) return i; return -1; }
function isWall(G, r, c) { return r < 0 || c < 0 || r >= G.h || c >= G.w || G.walls.has(key(r, c)); }

/* 走一步。dry=true 只试探不改状态。
   规则：不穿墙；推箱的方向上有墙/箱子/人就推不动；可以把对方角色推开一格(v1.37)：对方身后那一格是空地才推得动(对方前进一格、我补到他原来的格子)，身后是墙/箱子就推不动(why='player')，不会连环推也不会顺带推箱子。
   「两人同时朝对方按、互相推」由 coop.js 的房主在时间窗内判定，不在这里(这里一次只算一个人的一步)。
   成功：{ok:true, to:[r,c], push:被推箱子的id或-1, bto:箱子新坐标或null, pp:被推角色的下标或-1, pto:被推角色新坐标或null}；失败：{ok:false, why:'wall'|'player'|'box'|'boxplayer'|'bad'}
   非 dry 时：更新位置/朝向，moves 和 v(同步序号)各 +1 */
function step(G, pi, d, dry) {
  const dv = DIRS[d];
  if (!dv || (pi !== 0 && pi !== 1)) return { ok: false, why: 'bad' };
  const nr = G.p[pi][0] + dv[0], nc = G.p[pi][1] + dv[1];
  if (isWall(G, nr, nc)) return { ok: false, why: 'wall' };
  const o = playerAt(G, nr, nc, pi); // 前面是对方角色：身后空着就把他推开一格
  let pto = null;
  if (o >= 0) {
    const pr = nr + dv[0], pc = nc + dv[1];
    if (isWall(G, pr, pc) || boxAt(G, pr, pc) >= 0) return { ok: false, why: 'player' };
    pto = [pr, pc];
  }
  const b = boxAt(G, nr, nc);
  let bto = null;
  if (b >= 0) {
    const br = nr + dv[0], bc = nc + dv[1];
    if (isWall(G, br, bc) || boxAt(G, br, bc) >= 0) return { ok: false, why: 'box' };
    if (playerAt(G, br, bc, pi) >= 0) return { ok: false, why: 'boxplayer' };
    bto = [br, bc];
  }
  if (!dry) {
    if (b >= 0) G.boxes[b] = bto;
    if (o >= 0) G.p[o] = pto;
    G.p[pi] = [nr, nc]; G.d[pi] = d; G.moves++; G.v++;
  }
  return { ok: true, to: [nr, nc], push: b, bto, pp: o, pto };
}

/* 转身(没走成：撞墙/推不动/被人挡)：只改朝向，序号 +1(朝向是快照的一部分，每次可见的变化都占一个序号)，步数不加 */
function face(G, pi, d) {
  if (!DIRS[d] || (pi !== 0 && pi !== 1)) return false;
  G.d[pi] = d; G.v++;
  return true;
}

function solved(G) {
  const at = new Set(G.boxes.map((b) => key(b[0], b[1])));
  for (const t of G.targets) if (!at.has(t)) return false;
  return true;
}

/* ---- 快照(整盘状态，几十~一百多字节)：房主定期广播、玩家重连/发现跑偏时用来对齐 ---- */
function snapshot(G) {
  return { v: G.v, n: G.moves, p: G.p.map((q, i) => [q[0], q[1], G.d[i]]), b: G.boxes.map((b) => [b[0], b[1]]) };
}
function validSnap(G, s) { // 来自网络/本地存档的快照：形状和范围都查一遍，坏的直接丢
  if (!s || typeof s !== 'object' || !Number.isInteger(s.v) || s.v < 0 || !Number.isInteger(s.n) || s.n < 0) return false;
  if (!Array.isArray(s.p) || s.p.length !== 2 || !Array.isArray(s.b) || s.b.length !== G.boxes.length) return false;
  const okCell = (r, c) => Number.isInteger(r) && Number.isInteger(c) && !isWall(G, r, c);
  for (const q of s.p) if (!Array.isArray(q) || !okCell(q[0], q[1]) || !(q[2] in DIRS)) return false;
  if (s.p[0][0] === s.p[1][0] && s.p[0][1] === s.p[1][1]) return false;
  const seen = new Set();
  for (const b of s.b) { if (!Array.isArray(b) || !okCell(b[0], b[1])) return false; const k = key(b[0], b[1]); if (seen.has(k)) return false; seen.add(k); }
  return true;
}
function same(G, s) { // 状态(位置/箱子/朝向)是否和快照一致；不比 v
  for (let i = 0; i < 2; i++) if (G.p[i][0] !== s.p[i][0] || G.p[i][1] !== s.p[i][1] || G.d[i] !== s.p[i][2]) return false;
  for (let i = 0; i < G.boxes.length; i++) if (G.boxes[i][0] !== s.b[i][0] || G.boxes[i][1] !== s.b[i][1]) return false;
  return G.moves === s.n;
}
function load(G, s) {
  G.v = s.v; G.moves = s.n;
  G.p = s.p.map((q) => [q[0], q[1]]); G.d = s.p.map((q) => q[2]);
  G.boxes = s.b.map((b) => [b[0], b[1]]);
}

/* ---- 显示用：把规范状态转成「本机视角」的单机 XSB(只含墙/目标/箱子/本机角色 @，同伴由 coop.js 另画) ----
   tr=true(竖屏设备)：行列互换。互换是沿对角线翻转，对推箱子的规则没有影响。 */
function toXsb(G, me, tr) {
  const H = tr ? G.w : G.h, W = tr ? G.h : G.w;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  const put = (r, c, ch) => { const vr = tr ? c : r, vc = tr ? r : c; g[vr][vc] = ch; };
  const get = (r, c) => g[tr ? c : r][tr ? r : c];
  G.walls.forEach((k) => { const [r, c] = k.split(',').map(Number); if (r < G.h && c < G.w) put(r, c, '#'); });
  G.targets.forEach((k) => { const [r, c] = k.split(',').map(Number); put(r, c, '.'); });
  G.boxes.forEach((b) => put(b[0], b[1], get(b[0], b[1]) === '.' ? '*' : '$'));
  const m = G.p[me];
  put(m[0], m[1], get(m[0], m[1]) === '.' ? '+' : '@');
  return g.map((row) => row.join('')).join('\n');
}

const SWAP = { U: 'L', L: 'U', D: 'R', R: 'D' }; // 转置时方向互换(上↔左、下↔右)，互换两次回到原样，所以「规范→本机」和「本机→规范」是同一张表
const WORD = { U: 'up', D: 'down', L: 'left', R: 'right' };
const LETTER = { up: 'U', down: 'D', left: 'L', right: 'R' };
function toView(d, tr) { return WORD[tr ? SWAP[d] : d]; }   // 规范方向字母 → 本机方向词(up/down/left/right，单机核心用的)
function fromView(word, tr) { const l = LETTER[word]; return tr ? SWAP[l] : l; } // 本机方向词 → 规范方向字母

/* 地图体检(出新图时用)：非墙格是否全部连通；返回 {ok, boxes, targets} */
function check(xsb) {
  const G = fromXsb(xsb);
  if (!G) return { ok: false, why: 'parse' };
  const seen = new Set([key(G.p[0][0], G.p[0][1])]), st = [G.p[0]];
  while (st.length) { const [r, c] = st.pop(); for (const dv of Object.values(DIRS)) { const nr = r + dv[0], nc = c + dv[1], k = key(nr, nc); if (isWall(G, nr, nc) || seen.has(k)) continue; seen.add(k); st.push([nr, nc]); } }
  const reach = (p) => seen.has(key(p[0], p[1]));
  const boxesOk = G.boxes.every(reach), targetsOk = [...G.targets].every((k) => seen.has(k));
  return { ok: reach(G.p[1]) && boxesOk && targetsOk && G.boxes.length >= G.targets.size, boxes: G.boxes.length, targets: G.targets.size, w: G.w, h: G.h };
}

const API = { DIRS, fromXsb, step, face, solved, snapshot, validSnap, same, load, toXsb, toView, fromView, check, boxAt, playerAt };
root.COOP_RULES = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
