import * as THREE from 'three';
import { SECTIONS, PRODUCTS_PER_SECTION, buildCatalog } from './catalog.js';
import { makeRng, todaySeed } from './rng.js';
import { buildWorld, sectionAt, HALL, GONDOLA } from './world.js';
import { Controls } from './controls.js';
import { drawProduct } from './art.js';
import { makeAvatar } from './avatar.js';
import { Bgm } from './audio.js';

const EYE = 1.35; // 子どものころの目線。棚を少し見上げるくらい
const BOB = 0.008; // 歩くときの上下の揺れ（大きいと酔う）
const TPS_DIST = 3.0; // 三人称のときのカメラと自分の距離
const TPS_HEIGHT = 2.5; // 三人称のカメラの高さ。棚(2.05m)より上から見下ろす
const RADIUS = 0.3;
const WALK = 2.7;
const RUN = 6.5;
const REACH = 4.5; // 手に取れる距離

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const isTouch = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const BG = '#f2f2f0';
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 25, 120);
scene.add(new THREE.HemisphereLight('#ffffff', '#d6d4cf', 2.3));
const sun = new THREE.DirectionalLight('#ffffff', 1.0);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 220);

const seed = todaySeed();
const rng = makeRng(seed);
const catalog = buildCatalog(rng);
const world = buildWorld(scene, renderer, catalog, rng);

const player = { x: 0, z: HALL.halfL - 4, bob: 0, walk: 0 };
const controls = new Controls(canvas, { onPick: pick });
const avatar = makeAvatar();
avatar.visible = false;
scene.add(avatar);
const bgm = new Bgm();
let tps = false;

// ---- 当たり判定 ----
function blocked(x, z) {
  const b = world.bounds;
  if (x < b.x1 + RADIUS || x > b.x2 - RADIUS || z < b.z1 + RADIUS || z > b.z2 - RADIUS) return true;
  for (const c of world.colliders) {
    if (x > c.x1 - RADIUS && x < c.x2 + RADIUS && z > c.z1 - RADIUS && z < c.z2 + RADIUS) return true;
  }
  return false;
}

// 三人称のカメラが柱や壁にめり込まないよう、自分からカメラへの線上で手前に寄せる
function camBlocked(x, z, y) {
  const b = world.bounds, r = 0.2;
  if (x < b.x1 + r || x > b.x2 - r || z < b.z1 + r || z > b.z2 - r) return true;
  for (const c of world.colliders) {
    if (!c.tall && y > GONDOLA.height + 0.15) continue;
    if (x > c.x1 - r && x < c.x2 + r && z > c.z1 - r && z < c.z2 + r) return true;
  }
  return false;
}

// ---- 手に取る ----
const raycaster = new THREE.Raycaster();
const head = new THREE.Vector3();
const ndc = new THREE.Vector2();
let panelOpen = false;
let resumeLock = false;

function pick(point) {
  if (point) ndc.set((point.x / innerWidth) * 2 - 1, -(point.y / innerHeight) * 2 + 1);
  else ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 40;
  const hit = raycaster.intersectObjects(world.pickables, false)[0];
  if (!hit) return;
  head.set(player.x, EYE, player.z);
  if (hit.point.distanceTo(head) > REACH) {
    toast('もう少し近づくと、手に取って見られます');
    return;
  }
  const [si, pi] = hit.object.userData.productAt(hit.instanceId);
  openPanel(catalog[si][pi]);
}

const panelArt = $('panel-art');
function openPanel(p) {
  const sec = SECTIONS[p.section];
  const ctx = panelArt.getContext('2d');
  ctx.clearRect(0, 0, panelArt.width, panelArt.height);
  drawProduct(ctx, p, 0, 0, panelArt.width);
  $('panel-section').textContent = `${sec.name}売り場`;
  $('panel-section').style.background = sec.color;
  $('panel-name').textContent = p.name;
  $('panel-maker').textContent = p.maker;
  $('panel-price').textContent = p.priceLabel;
  $('panel-desc').textContent = p.desc;
  $('panel-age').textContent = p.age === 0 ? '0さいから' : `${p.age}さい以上`;
  resumeLock = controls.locked;
  controls.unlock();
  controls.enabled = false;
  controls.reset();
  panelOpen = true;
  $('panel').classList.add('on');
}

function closePanel() {
  $('panel').classList.remove('on');
  panelOpen = false;
  controls.enabled = true;
  if (resumeLock) controls.lock();
}
$('panel-close').addEventListener('click', closePanel);
$('panel').addEventListener('click', (e) => { if (e.target.id === 'panel') closePanel(); });
addEventListener('keydown', (e) => {
  if (panelOpen && (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter')) closePanel();
});

// ---- 表示 ----
let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

function placeName(si) {
  if (si === -2) return 'エントランス';
  if (si === -1) return 'メインどおり';
  return `${SECTIONS[si].name}売り場`;
}

// ミニマップ。売り場の色分けと棚の並びを一度だけ描いておき、毎フレームは現在地だけ重ねる
const map = $('map');
const mapBase = document.createElement('canvas');
const MAP_W = 120, MAP_H = Math.round(MAP_W * HALL.halfL / HALL.halfW);
const mapDpr = Math.min(devicePixelRatio, 2);
map.width = mapBase.width = MAP_W * mapDpr;
map.height = mapBase.height = MAP_H * mapDpr;
map.style.width = `${MAP_W}px`;
map.style.height = `${MAP_H}px`;
const toMap = (x, z) => [((x + HALL.halfW) / (HALL.halfW * 2)) * map.width, ((z + HALL.halfL) / (HALL.halfL * 2)) * map.height];
{
  const ctx = mapBase.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(0, 0, map.width, map.height);
  world.minimap.gondolas.forEach((g) => {
    const [x1, y1] = toMap(g.x1, g.z1), [x2, y2] = toMap(g.x2, g.z2);
    ctx.fillStyle = SECTIONS[g.si].color;
    ctx.fillRect(x1, y1, x2 - x1, Math.max(1, y2 - y1));
  });
  world.minimap.islands.forEach((it) => {
    const [x1, y1] = toMap(it.x - it.size / 2, it.z - it.size / 2), [x2, y2] = toMap(it.x + it.size / 2, it.z + it.size / 2);
    ctx.fillStyle = '#999';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  });
}
function drawMap() {
  const ctx = map.getContext('2d');
  ctx.drawImage(mapBase, 0, 0);
  const [px, py] = toMap(player.x, player.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-controls.yaw);
  const s = 5 * mapDpr;
  ctx.fillStyle = 'rgba(30,120,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, s * 4, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
  ctx.fill();
  ctx.fillStyle = '#1e78ff';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- 入店・一時停止 ----
const start = $('start');
const d = new Date();
$('today').textContent = `${d.getMonth() + 1}月${d.getDate()}日の品ぞろえ：${SECTIONS.length}売り場・${SECTIONS.length * PRODUCTS_PER_SECTION}種類・棚に${world.productCount.toLocaleString('ja-JP')}個`;
$('howto').innerHTML = isTouch
  ? '画面の<b>左側をなぞる</b>と歩く／<b>右側をなぞる</b>と見回す<br>近くの商品を<b>タップ</b>すると手に取れます'
  : '<b>WASD・矢印キー</b>で歩く（Shiftで早歩き）／<b>マウス</b>で見回す<br>近くの商品を<b>クリック</b>すると手に取れます<br><b>V</b>で視点の切りかえ／<b>C</b>で商品カード／<b>M</b>でBGM';

function toggleView() {
  tps = !tps;
  avatar.visible = tps;
  $('btn-view').textContent = tps ? '三人称' : '一人称';
  toast(tps ? '三人称の視点' : '一人称の視点');
}
function toggleBgm() {
  const on = bgm.toggle();
  $('btn-bgm').textContent = on ? 'BGM オン' : 'BGM オフ';
  $('btn-bgm').classList.toggle('off', !on);
}
function toggleHolo() {
  holoOn = !holoOn;
  $('btn-holo').textContent = holoOn ? 'カード オン' : 'カード オフ';
  $('btn-holo').classList.toggle('off', !holoOn);
}
$('btn-view').addEventListener('click', toggleView);
$('btn-holo').addEventListener('click', toggleHolo);
$('btn-bgm').addEventListener('click', toggleBgm);
addEventListener('keydown', (e) => {
  if (!controls.enabled) return;
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyM') toggleBgm();
  if (e.code === 'KeyC') toggleHolo();
});

$('enter').addEventListener('click', () => {
  bgm.start();
  start.classList.remove('on');
  $('enter').textContent = 'つづける';
  controls.enabled = true;
  controls.lock();
});
document.addEventListener('pointerlockchange', () => {
  if (!controls.locked && controls.enabled && !panelOpen) {
    controls.enabled = false;
    controls.reset();
    start.classList.add('on');
  }
  $('crosshair').classList.toggle('on', controls.locked);
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// 自分の後ろ上から見下ろす。上下の見回しはカメラの高さで表す
function placeTpsCamera() {
  avatar.position.set(player.x, 0, player.z);
  avatar.rotation.y = controls.yaw;
  avatar.userData.animate(player.bob, player.walk);
  const sy = Math.sin(controls.yaw), cy = Math.cos(controls.yaw);
  const y = Math.max(1.2, Math.min(4.2, TPS_HEIGHT - controls.pitch * 2));
  let dist = TPS_DIST;
  for (let d = 0.3; d <= TPS_DIST; d += 0.1) {
    if (camBlocked(player.x + sy * d, player.z + cy * d, y)) {
      dist = Math.max(0.3, d - 0.2);
      break;
    }
  }
  camera.position.set(player.x + sy * dist, y, player.z + cy * dist);
  camera.lookAt(player.x - sy * 2.5, 1.0 + controls.pitch * 2.5, player.z - cy * 2.5);
}

// ---- 空中の商品カード ----
// 商品の上に、空中に投影したようなカードを浮かべる。箱の絵だけでは何かわからないので、絵を大きく見せる。
// 出すのは、HOLO_RANGE以内で、こちらを向いていて、画面に映っている商品から数枚だけ。遠いカードほど小さく。
// 画面上で重なったら、遠い方のカードを上へずらし、それでも収まらなければ隠す（毎フレーム並べ直す）
const HOLO_MAX = isTouch ? 4 : 6;
const HOLO_RANGE = 14;
const HOLO_CELL = 2;
const HOLO_BEAM = 22; // カードから商品へ下ろす光の線の長さ(px)
let holoOn = true;
const holoGrid = new Map();
world.spots.forEach((s, i) => {
  const key = `${Math.floor(s.x / HOLO_CELL)},${Math.floor(s.z / HOLO_CELL)}`;
  if (!holoGrid.has(key)) holoGrid.set(key, []);
  holoGrid.get(key).push(i);
});
const holoCards = Array.from({ length: HOLO_MAX }, () => {
  const el = document.createElement('div');
  el.className = 'holo';
  // 名前はパッケージの絵に描いてあるので、カードには絵と値段だけを出す
  el.innerHTML = '<canvas width="256" height="256"></canvas><div class="p"></div>';
  $('holo').appendChild(el);
  const card = { el, spot: null, w: 0, h: 0 };
  el.addEventListener('click', () => {
    if (card.spot && controls.enabled) openPanel(catalog[card.spot.si][card.spot.pi]);
  });
  return card;
});
const _v = new THREE.Vector3();
let holoNext = 0;
const holoScale = (dist) => Math.max(0.55, Math.min(1, 4 / dist));

function chooseSpots() {
  const R = Math.ceil(HOLO_RANGE / HOLO_CELL);
  const cx = Math.floor(player.x / HOLO_CELL), cz = Math.floor(player.z / HOLO_CELL);
  const found = [];
  for (let gx = cx - R; gx <= cx + R; gx++) for (let gz = cz - R; gz <= cz + R; gz++) {
    for (const i of holoGrid.get(`${gx},${gz}`) || []) {
      const s = world.spots[i];
      const dx = s.x - player.x, dz = s.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > HOLO_RANGE || dist < 0.3) continue;
      if (!s.omni && Math.sin(s.rot) * -dx + Math.cos(s.rot) * -dz <= 0) continue; // 向こうを向いている
      _v.set(s.x, s.y, s.z).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 0.85 || _v.y < -0.8 || _v.y > 0.6) continue;
      found.push({ s, score: dist * 0.5 + Math.abs(_v.x) * 3, px: (_v.x * 0.5 + 0.5) * innerWidth });
    }
  }
  found.sort((a, b) => a.score - b.score);
  const picked = [], seen = new Set();
  for (const f of found) {
    const id = f.s.si * 1000 + f.s.pi;
    if (seen.has(id)) continue;
    // 同じあたりの商品ばかりにならないよう、画面の横位置を少し散らす
    if (picked.some((p) => Math.abs(p.px - f.px) < innerWidth * 0.08)) continue;
    seen.add(id);
    picked.push(f);
    if (picked.length === HOLO_MAX) break;
  }
  return picked.map((f) => f.s);
}

function updateHolo(now) {
  const show = holoOn && controls.enabled && !panelOpen;
  if (show && now > holoNext) {
    holoNext = now + 250;
    const next = chooseSpots();
    // いま出ているカードはそのまま残し、空いたカードに新しい商品を割り当てる
    const keep = new Set(next);
    holoCards.forEach((c) => { if (c.spot && !keep.has(c.spot)) c.spot = null; });
    next.forEach((s) => {
      if (holoCards.some((c) => c.spot === s)) return;
      const c = holoCards.find((card) => !card.spot);
      if (!c) return;
      const p = catalog[s.si][s.pi];
      c.spot = s;
      const ctx = c.el.querySelector('canvas').getContext('2d');
      ctx.clearRect(0, 0, 256, 256);
      drawProduct(ctx, p, 0, 0, 256);
      c.el.title = p.name;
      c.el.querySelector('.p').textContent = p.priceLabel;
      c.w = c.h = 0;
    });
  }
  // 近いカードから順に置き、先に置いたカードと重なるなら上へずらす
  const live = [];
  holoCards.forEach((c, i) => {
    c.el.classList.remove('on');
    if (!show || !c.spot) return;
    _v.set(c.spot.x, c.spot.y + 0.08, c.spot.z).project(camera);
    if (_v.z > 1) return;
    if (!c.w) {
      c.w = c.el.offsetWidth || 200;
      c.h = c.el.offsetHeight || 240;
    }
    const k = holoScale(Math.hypot(c.spot.x - player.x, c.spot.z - player.z));
    const px = (_v.x * 0.5 + 0.5) * innerWidth;
    const py = (-_v.y * 0.5 + 0.5) * innerHeight + Math.sin(now / 600 + i * 1.7) * 3;
    live.push({ c, k, px, py, w: c.w * k, h: c.h * k });
  });
  live.sort((a, b) => b.k - a.k);
  const placed = [];
  const GAP = 8;
  live.forEach((it) => {
    const x1 = it.px - it.w / 2, x2 = it.px + it.w / 2;
    let bottom = it.py - HOLO_BEAM * it.k;
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((p) => x1 < p.x2 + GAP && x2 > p.x1 - GAP && bottom - it.h < p.bottom + GAP && bottom > p.top - GAP);
      if (!hit) break;
      bottom = hit.top - GAP;
    }
    const top = bottom - it.h;
    const blocked = placed.some((p) => x1 < p.x2 + GAP && x2 > p.x1 - GAP && top < p.bottom + GAP && bottom > p.top - GAP);
    if (blocked || top < 8) return; // 置ける場所がない
    placed.push({ x1, x2, top, bottom });
    const c = it.c;
    // 縮めるときはカードの下辺の中央を基準にする（CSSの transform-origin と合わせる）
    c.el.style.transform = `translate(${(it.px - c.w / 2).toFixed(1)}px, ${(bottom - c.h).toFixed(1)}px) scale(${it.k.toFixed(3)})`;
    c.el.style.setProperty('--beam', `${((it.py - bottom) / it.k).toFixed(1)}px`);
    c.el.style.zIndex = String(Math.round(it.k * 100));
    c.el.classList.add('on');
  });
}

// ---- ループ ----
let last = performance.now();
let lastPlace = null;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (controls.enabled) {
    const inp = controls.input();
    controls.turn(inp.turn * 1.8 * dt, 0);
    const speed = (inp.run ? RUN : WALK) * dt;
    const fx = -Math.sin(controls.yaw), fz = -Math.cos(controls.yaw);
    const dx = (fx * inp.f + -fz * inp.s) * speed;
    const dz = (fz * inp.f + fx * inp.s) * speed;
    if (dx && !blocked(player.x + dx, player.z)) player.x += dx;
    if (dz && !blocked(player.x, player.z + dz)) player.z += dz;
    const moving = Math.hypot(dx, dz);
    player.bob = moving ? player.bob + moving * 5.5 : player.bob * 0.9;
    player.walk += ((moving > 0 ? 1 : 0) - player.walk) * Math.min(1, dt * 10);
  }
  if (tps) placeTpsCamera();
  else {
    camera.position.set(player.x, EYE + Math.sin(player.bob) * BOB, player.z);
    camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ');
  }

  const place = sectionAt(player.x, player.z);
  if (place !== lastPlace) {
    $('where').textContent = placeName(place);
    if (lastPlace !== null && place >= 0) toast(`${SECTIONS[place].name}売り場`);
    lastPlace = place;
  }
  updateHolo(now);
  drawMap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__mall = { camera, controls, player, world, catalog, openPanel, bgm, renderer };
