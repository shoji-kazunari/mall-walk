import * as THREE from 'three';
import { SECTIONS, PRODUCTS_PER_SECTION, buildCatalog } from './catalog.js';
import { makeRng, todaySeed } from './rng.js';
import { buildWorld, sectionAt, HALL } from './world.js';
import { Controls } from './controls.js';
import { drawProduct } from './art.js';

const EYE = 1.6;
const RADIUS = 0.3;
const WALK = 1.8;
const RUN = 4.5;
const REACH = 4.5; // 手に取れる距離

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const isTouch = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const BG = '#f3efe8';
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 30, 150);
scene.add(new THREE.HemisphereLight('#ffffff', '#cdbfa8', 2.2));
const sun = new THREE.DirectionalLight('#fff6e8', 1.1);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 220);

const seed = todaySeed();
const rng = makeRng(seed);
const catalog = buildCatalog(rng);
const world = buildWorld(scene, renderer, catalog, rng);

const player = { x: 0, z: HALL.halfL - 4, bob: 0 };
const controls = new Controls(canvas, { onPick: pick });

// ---- 当たり判定 ----
function blocked(x, z) {
  const b = world.bounds;
  if (x < b.x1 + RADIUS || x > b.x2 - RADIUS || z < b.z1 + RADIUS || z > b.z2 - RADIUS) return true;
  for (const c of world.colliders) {
    if (x > c.x1 - RADIUS && x < c.x2 + RADIUS && z > c.z1 - RADIUS && z < c.z2 + RADIUS) return true;
  }
  return false;
}

// ---- 手に取る ----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let panelOpen = false;
let resumeLock = false;

function pick(point) {
  if (point) ndc.set((point.x / innerWidth) * 2 - 1, -(point.y / innerHeight) * 2 + 1);
  else ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 40;
  const hit = raycaster.intersectObjects(world.productMeshes, false)[0];
  if (!hit) return;
  if (hit.distance > REACH) {
    toast('もう少し近づくと、手に取って見られます');
    return;
  }
  const mesh = hit.object;
  openPanel(catalog[mesh.userData.section][mesh.userData.productOf[hit.instanceId]]);
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
  : '<b>WASD・矢印キー</b>で歩く（Shiftで早歩き）／<b>マウス</b>で見回す<br>近くの商品を<b>クリック</b>すると手に取れます';

$('enter').addEventListener('click', () => {
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
  }
  camera.position.set(player.x, EYE + Math.sin(player.bob) * 0.025, player.z);
  camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ');

  const place = sectionAt(player.x, player.z);
  if (place !== lastPlace) {
    $('where').textContent = placeName(place);
    if (lastPlace !== null && place >= 0) toast(`${SECTIONS[place].name}売り場`);
    lastPlace = place;
  }
  drawMap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__mall = { camera, controls, player, world, catalog, openPanel };
