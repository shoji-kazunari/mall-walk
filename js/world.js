// 店内の3D空間を組み立てる。単位はメートル。
// 入口が +z 側、奥が -z 側。中央を貫く通り（メインどおり）の左右に売り場が5つずつ並ぶ。
// 見た目の手本は大型のおもちゃ専門店：白い天井と線状の照明、色付きの値札レール、
// フックに吊るしたブリスター、棚の端（エンド）のポスターとテレビ、ワイヤーかごの山積み、壁の上の在庫の箱。
import * as THREE from 'three';
import { SECTIONS, PRODUCTS_PER_SECTION } from './catalog.js';
import {
  makeAtlas, makeSignCanvas, makePosterCanvas, makePriceAtlas, makeBandCanvas, makeTvCanvas, makeWireCanvas,
  ATLAS_COLS, ATLAS_ROWS, PRICE_VARIANTS,
} from './art.js';

export const HALL = {
  halfW: 42,        // 側壁の x
  halfL: 66,        // 入口と奥の壁の z
  height: 6,        // 天井の高さ
  prom: 3,          // メインどおりの半幅
  secTop: 54,       // ここより入口側はエントランス広場
  secPitch: 23.2,   // 売り場ひとつの奥行き
  perSide: 5,
};

// 棚は子どもの目線より少し高い2m。見上げる感じが売り場の楽しさになる
export const GONDOLA = {
  depth: 1.2, height: 2.05, levels: [0.12, 0.6, 1.08, 1.56], maxItemH: 0.44,
  pegRows: [1.95, 1.5, 1.05], // 吊り下げフックの高さ
};
const WALL = {
  depth: 0.6, height: 3.0, levels: [0.12, 0.6, 1.08, 1.56, 2.04, 2.52], maxItemH: 0.44,
  pegRows: [2.9, 2.45, 2.0, 1.55, 1.1],
};
const ENDCAP_DEPTH = 0.45;
const RUNS = [[5.5, 20], [23, 37.5]]; // 売り場内の棚の列（|x| の範囲）。間が横の通路
const ROWS = 5;
const ROW_PITCH = 4.0; // 棚の奥行き1.2m＋通路2.8m
const PILLAR_X = [4.2, 21.5, 39.5];
const SIZE_SCALE = 1.35; // 商品の大きさ。棚の前を歩きながらでも絵柄と名前が読める大きさにする
const ITEM_GAP = 0.06;
const GROUP_GAP = 0.16;

const COLOR = {
  frame: '#f3f4f6', board: '#e4e7eb', kick: '#c3c8d0', pegboard: '#ece9e2', hook: '#9aa1aa',
  tag: '#ffffff', cardboard: '#c9a26f', pillar: '#f7f7f5',
};
const PLUSH_COLORS = ['#a8754c', '#d8b48a', '#f3efe6', '#f2a9c4', '#9fd0ef', '#ffe08a', '#a8d8a8', '#6b6b6b', '#c9a0dc', '#ffffff'];

export function sectionRect(si) {
  const side = si < HALL.perSide ? -1 : 1;
  const k = si % HALL.perSide;
  const z2 = HALL.secTop - HALL.secPitch * k;
  const z1 = z2 - HALL.secPitch;
  const xa = side * HALL.prom, xb = side * HALL.halfW;
  return { side, k, x1: Math.min(xa, xb), x2: Math.max(xa, xb), z1, z2, cz: (z1 + z2) / 2 };
}

export function sectionAt(x, z) {
  if (z > HALL.secTop) return -2; // エントランス
  if (Math.abs(x) < HALL.prom) return -1; // メインどおり
  for (let si = 0; si < SECTIONS.length; si++) {
    const r = sectionRect(si);
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return si;
  }
  return -1;
}

// 1枚のテクスチャを格子に区切り、インスタンスごとにどのマスを貼るかを aTile で選ぶ
function tiledMaterial(texture, cols, rows, basic = false) {
  const mat = basic ? new THREE.MeshBasicMaterial({ map: texture }) : new THREE.MeshLambertMaterial({ map: texture });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec2 aTile;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>\n  vMapUv = vMapUv * vec2(${(1 / cols).toFixed(6)}, ${(1 / rows).toFixed(6)}) + aTile;`,
    );
  };
  // three.js はシェーダーを関数の文字列で使い回すので、格子の大きさごとに区別させる
  mat.customProgramCacheKey = () => `tiled-${cols}x${rows}-${basic}`;
  return mat;
}

function canvasTexture(c, renderer) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function setInstance(mesh, i, x, y, z, rot, sx, sy, sz) {
  _p.set(x, y, z);
  _q.setFromAxisAngle(UP, rot);
  _s.set(sx, sy, sz);
  mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
}

// 底が y=0 の箱。パッケージの絵は正面(+z)だけに貼り、ほかの面は地の色1点を引き伸ばす
function productBox() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const uv = geo.attributes.uv;
  for (let v = 0; v < uv.count; v++) {
    if (v >= 16 && v < 20) continue; // 面の順は +x, -x, +y, -y, +z, -z。各4頂点
    uv.setXY(v, 0.03, 0.3);
  }
  return geo;
}

// 箱やブリスターなど、パッケージの絵を貼る商品。InstancedMesh 1つ＝1売り場
class ProductLayer {
  constructor() {
    this.items = [];
  }
  // card=true は吊り下げの台紙。正面からしか見ないので板1枚で描く（三角形の数を減らす）
  add(si, pi, x, y, z, w, h, d, rot, card = false) {
    this.items.push({ si, pi, x, y, z, w, h, d, rot, card });
  }
  build(scene, catalog, renderer) {
    const meshes = [];
    SECTIONS.forEach((sec, si) => {
      const mat = tiledMaterial(canvasTexture(makeAtlas(catalog[si]), renderer), ATLAS_COLS, ATLAS_ROWS);
      const mine = this.items.filter((it) => it.si === si);
      const boxes = mine.filter((it) => !it.card), cards = mine.filter((it) => it.card);
      const plane = new THREE.PlaneGeometry(1, 1);
      plane.translate(0, 0.5, 0);
      if (boxes.length) meshes.push(this.mesh(scene, productBox(), mat, boxes, si));
      if (cards.length) meshes.push(this.mesh(scene, plane, mat, cards, si));
    });
    return meshes;
  }
  mesh(scene, geo, mat, items, si) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const tiles = new Float32Array(items.length * 2);
    const productOf = new Uint8Array(items.length);
    items.forEach((it, i) => {
      setInstance(mesh, i, it.x, it.y, it.z, it.rot, it.w, it.h, it.d);
      // テクスチャは上から下へ並べて描いてあるが、UVのvは下が0なので行を反転させる
      tiles[i * 2] = (it.pi % ATLAS_COLS) / ATLAS_COLS;
      tiles[i * 2 + 1] = (ATLAS_ROWS - 1 - Math.floor(it.pi / ATLAS_COLS)) / ATLAS_ROWS;
      productOf[i] = it.pi;
    });
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
    mesh.computeBoundingSphere();
    mesh.userData.productAt = (i) => [si, productOf[i]];
    scene.add(mesh);
    return mesh;
  }
}

// ぬいぐるみ1体ぶんの形。球を組み合わせて1つの形状にまとめ、色はインスタンスごとに付ける。
// 頂点色で明るさを変えている（からだ0.78、はな先1.0、目は黒）。インスタンス色を 1/0.78 倍して元の色に戻す
const PLUSH_TONE = 0.78;
function plushGeometry() {
  const parts = [
    // [x, y, z, sx, sy, sz, 細かさ, 明るさ]
    [0, 0.3, 0, 0.36, 0.32, 0.3, 7, PLUSH_TONE], // からだ
    [0, 0.72, 0.02, 0.27, 0.25, 0.25, 7, PLUSH_TONE], // あたま
    [-0.19, 0.93, 0, 0.09, 0.09, 0.06, 5, PLUSH_TONE], // みみ
    [0.19, 0.93, 0, 0.09, 0.09, 0.06, 5, PLUSH_TONE],
    [0, 0.66, 0.24, 0.11, 0.08, 0.06, 5, 1], // はな先
    [-0.31, 0.38, 0.06, 0.09, 0.15, 0.09, 5, PLUSH_TONE], // うで
    [0.31, 0.38, 0.06, 0.09, 0.15, 0.09, 5, PLUSH_TONE],
    [-0.09, 0.77, 0.22, 0.032, 0.032, 0.02, 3, 0.03], // 目
    [0.09, 0.77, 0.22, 0.032, 0.032, 0.02, 3, 0.03],
    [0, 0.69, 0.3, 0.03, 0.022, 0.02, 3, 0.03], // はな
  ];
  const pos = [], nor = [], col = [], idx = [];
  parts.forEach(([x, y, z, sx, sy, sz, seg, tone]) => {
    const g = new THREE.SphereGeometry(1, seg, Math.max(3, seg - 2));
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(tone, tone, tone);
    g.index.array.forEach((v) => idx.push(v + base));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

// ぬいぐるみとボール（箱に入っていない商品）
class SoftLayer {
  constructor() {
    this.plushes = []; // {x, y, z, rot, s, color, owner}
    this.balls = [];
  }
  get count() {
    return this.plushes.length + this.balls.length;
  }
  plush(si, pi, color, x, y, z, s, rot) {
    this.plushes.push({ x, y, z, rot, s, color: new THREE.Color(color).multiplyScalar(1 / PLUSH_TONE), owner: [si, pi] });
  }
  ball(si, pi, color, x, y, z, r) {
    this.balls.push({ x, y: y + r, z, rot: 0, s: r, color: new THREE.Color(color), owner: [si, pi] });
  }
  build(scene) {
    const make = (geo, mat, list) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        setInstance(mesh, i, p.x, p.y, p.z, p.rot, p.s, p.s, p.s);
        mesh.setColorAt(i, p.color);
      });
      mesh.computeBoundingSphere();
      mesh.userData.productAt = (i) => list[i].owner;
      scene.add(mesh);
      return mesh;
    };
    return [
      make(plushGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), this.plushes),
      make(new THREE.SphereGeometry(1, 10, 7), new THREE.MeshLambertMaterial(), this.balls),
    ];
  }
}

// ポスターや価格POPのような板。1枚のテクスチャを格子に区切って使う
class PlaneLayer {
  constructor(w, h, cols, rows) {
    Object.assign(this, { w, h, cols, rows, items: [] });
  }
  add(tile, x, y, z, rot) {
    this.items.push({ tile, x, y, z, rot });
  }
  build(scene, texture) {
    const geo = new THREE.PlaneGeometry(this.w, this.h);
    const mesh = new THREE.InstancedMesh(geo, tiledMaterial(texture, this.cols, this.rows, true), this.items.length);
    const tiles = new Float32Array(this.items.length * 2);
    this.items.forEach((it, i) => {
      setInstance(mesh, i, it.x, it.y, it.z, it.rot, 1, 1, 1);
      tiles[i * 2] = (it.tile % this.cols) / this.cols;
      tiles[i * 2 + 1] = (this.rows - 1 - Math.floor(it.tile / this.cols)) / this.rows;
    });
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
}

// 棚板・柱などの什器。1つのInstancedMeshにまとめ、色だけインスタンスごとに変える
class FixtureLayer {
  constructor() {
    this.items = [];
  }
  box(x, y, z, sx, sy, sz, color) {
    this.items.push({ x, y, z, sx, sy, sz, color: new THREE.Color(color) });
  }
  build(scene) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), this.items.length);
    const m = new THREE.Matrix4();
    this.items.forEach((it, i) => {
      m.makeScale(it.sx, it.sy, it.sz);
      m.setPosition(it.x, it.y, it.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
}

// 棚の1面。背板の位置(ox, oz)から、面に沿って a 方向に u、手前（通路側）n 方向に out の座標で物を置く
function makeFace(ox, oz, ax, az, nx, nz, len) {
  return { ox, oz, ax, az, nx, nz, len, rot: Math.atan2(nx, nz) };
}
function onFace(f, u, out) {
  return [f.ox + f.ax * u + f.nx * out, f.oz + f.az * u + f.nz * out];
}

function signMesh(text, color, w, h, opts) {
  const tex = new THREE.CanvasTexture(makeSignCanvas(text, color, opts));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const g = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const back = front.clone();
  back.rotation.y = Math.PI;
  front.position.z = 0.01;
  back.position.z = -0.01;
  g.add(front, back);
  return g;
}

function floorTexture(base, line, tiles) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    const v = (i * 256) / tiles;
    ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(256, v); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildWorld(scene, renderer, catalog, rng) {
  const colliders = []; // {x1, z1, x2, z2, tall}
  const minimap = { gondolas: [], islands: [] };
  const products = new ProductLayer();
  const soft = new SoftLayer();
  const fx = new FixtureLayer();
  const pops = new PlaneLayer(0.26, 0.13, 1, PRICE_VARIANTS.length);
  const posters = SECTIONS.map(() => new PlaneLayer(1.2, 0.6, 1, 3));
  const { halfW, halfL, height } = HALL;

  // ---- 面に沿った置き方 ----
  const fxOn = (f, u, out, y, su, sout, sy, color) => {
    const [x, z] = onFace(f, u, out);
    const alongX = f.ax !== 0;
    fx.box(x, y, z, alongX ? su : sout, sy, alongX ? sout : su, color);
  };

  // 棚板の手前の色付き値札レールと、白い値札
  const rail = (f, y, depth, color) => {
    fxOn(f, f.len / 2, depth - 0.01, y - 0.0225, f.len, 0.02, 0.045, color);
    for (let u = 0.35; u < f.len - 0.2; u += 0.75) fxOn(f, u, depth + 0.003, y - 0.022, 0.07, 0.006, 0.032, COLOR.tag);
  };

  // 棚の1段に、端から箱を並べる。同じ商品を1〜2個ずつ、少し間を空けて置く
  const shelfBoxes = (f, si, y, depth, maxH) => {
    let u = 0.08;
    while (u < f.len - 0.08) {
      const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
      const p = catalog[si][pi];
      const w = p.size.w * SIZE_SCALE, h = Math.min(p.size.h * SIZE_SCALE, maxH), d = Math.min(p.size.d * 2.2, depth - 0.05);
      const facings = rng.int(1, 2);
      for (let k = 0; k < facings; k++) {
        if (u + w > f.len - 0.08) return;
        const [x, z] = onFace(f, u + w / 2, depth - d / 2 - 0.01);
        products.add(si, pi, x, y, z, w, h, d, f.rot);
        u += w + ITEM_GAP;
      }
      u += GROUP_GAP;
    }
  };

  // ぬいぐるみを棚に座らせる
  const shelfPlush = (f, si, y, depth, maxH) => {
    let u = 0.1;
    while (u < f.len - 0.1) {
      const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
      const s = Math.min(maxH, 0.3 + catalog[si][pi].size.h * 0.4);
      const w = s * 0.72;
      if (u + w > f.len - 0.1) return;
      const [x, z] = onFace(f, u + w / 2, depth - s * 0.32);
      soft.plush(si, pi, PLUSH_COLORS[pi % PLUSH_COLORS.length], x, y, z, s, f.rot + rng.range(-0.2, 0.2));
      u += w + 0.08;
    }
  };

  // フックに吊るしたブリスターパック。1本のフックに2枚ずつ前後に掛ける
  const pegRow = (f, si, hookY) => {
    let u = 0.1;
    while (u < f.len - 0.1) {
      const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
      const p = catalog[si][pi];
      const w = Math.min(0.28, Math.max(0.16, p.size.w * 0.6 + 0.06));
      const h = Math.min(0.36, Math.max(0.22, p.size.h * 0.75 + 0.08));
      if (u + w > f.len - 0.1) return;
      fxOn(f, u + w / 2, 0.13, hookY, 0.012, 0.26, 0.012, COLOR.hook);
      for (const out of [0.12, 0.2]) {
        const [x, z] = onFace(f, u + w / 2, out);
        products.add(si, pi, x, hookY - 0.03 - h, z, w, h, 0.03, f.rot, true);
      }
      u += w + 0.05;
    }
  };

  // 棚の1面に、売り場の陳列のしかたで商品を置く
  const stock = (f, si, spec, depth) => {
    const sec = SECTIONS[si];
    const levels = sec.display === 'peg' ? [spec.levels[0]] : spec.levels;
    levels.forEach((y) => {
      rail(f, y, depth, sec.color);
      if (sec.display === 'plush') shelfPlush(f, si, y, depth, spec.maxItemH);
      else shelfBoxes(f, si, y, depth, spec.maxItemH);
    });
    if (sec.display === 'peg') spec.pegRows.forEach((y) => pegRow(f, si, y));
  };

  // 棚の骨組み（背板・幅木・棚板）。両面の棚なら depth は片面ぶん
  const frame = (f, si, spec, depth, backColor) => {
    const peg = SECTIONS[si].display === 'peg';
    fxOn(f, f.len / 2, 0.012, spec.height / 2, f.len, 0.025, spec.height, peg ? COLOR.pegboard : backColor);
    fxOn(f, f.len / 2, depth / 2, 0.06, f.len, depth, 0.12, COLOR.kick);
    if (!peg) spec.levels.slice(1).forEach((y) => fxOn(f, f.len / 2, depth / 2, y - 0.0125, f.len, depth, 0.025, COLOR.board));
    fxOn(f, f.len / 2, depth / 2, spec.height + 0.01, f.len, depth, 0.02, COLOR.board);
  };

  // ---- 床・壁・天井 ----
  const floorTex = floorTexture('#efefec', '#e3e3df', 2);
  floorTex.repeat.set(halfW / 0.6, halfL / 0.6); // 60cm角のタイル
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // メインどおりはクリーム色の通路と青いライン
  const promMat = new THREE.MeshLambertMaterial({ color: '#f4e6c4' });
  const prom = new THREE.Mesh(new THREE.PlaneGeometry(HALL.prom * 2, halfL * 2), promMat);
  prom.rotation.x = -Math.PI / 2;
  prom.position.y = 0.003;
  scene.add(prom);
  for (const s of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.28, halfL * 2), new THREE.MeshLambertMaterial({ color: '#2f6fd0' }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(s * (HALL.prom - 0.14), 0.005, 0);
    scene.add(line);
  }

  const wallMat = new THREE.MeshLambertMaterial({ color: '#f6f6f4', emissive: '#5a5a58' });
  const addWall = (w, x, z, ry) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, height), wallMat);
    wall.position.set(x, height / 2, z);
    wall.rotation.y = ry;
    scene.add(wall);
  };
  addWall(halfL * 2, -halfW, 0, Math.PI / 2);
  addWall(halfL * 2, halfW, 0, -Math.PI / 2);
  addWall(halfW * 2, 0, -halfL, 0);
  addWall(halfW * 2, 0, halfL, Math.PI);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), new THREE.MeshBasicMaterial({ color: '#f1f1ef' }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  scene.add(ceiling);

  // 天井の照明。細長い光の線が奥まで平行に続く
  const lampPos = [];
  for (let x = -halfW + 3; x <= halfW - 3; x += 3) {
    for (let z = -halfL + 1; z + 6 <= halfL - 1; z += 7) lampPos.push([x, z + 3]);
  }
  const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lampPos.length);
  lampPos.forEach(([x, z], i) => {
    _m.makeRotationX(Math.PI / 2).setPosition(x, height - 0.025, z);
    lamps.setMatrixAt(i, _m);
  });
  scene.add(lamps);
  lampPos.forEach(([x, z]) => fx.box(x, height - 0.01, z, 0.24, 0.02, 6.1, '#d9dbde'));

  // 入口のガラス扉
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ color: '#cfe6f5' }));
  glass.position.set(0, 1.7, halfL - 0.02);
  glass.rotation.y = Math.PI;
  scene.add(glass);
  for (let x = -4.5; x <= 4.5; x += 2.25) fx.box(x, 1.7, halfL - 0.05, 0.08, 3.4, 0.08, '#9aa3ad');
  fx.box(0, 3.45, halfL - 0.05, 9.1, 0.12, 0.1, '#9aa3ad');

  // ---- 柱 ----
  for (let k = 0; k <= HALL.perSide; k++) {
    const z = HALL.secTop - HALL.secPitch * k;
    for (const px of PILLAR_X) for (const s of [-1, 1]) {
      const x = s * px;
      fx.box(x, height / 2, z, 0.8, height, 0.8, COLOR.pillar);
      fx.box(x, 0.1, z, 0.84, 0.2, 0.84, COLOR.kick);
      colliders.push({ x1: x - 0.4, z1: z - 0.4, x2: x + 0.4, z2: z + 0.4, tall: true });
    }
  }

  // ---- 売り場ごとの棚 ----
  const tvs = [];
  SECTIONS.forEach((sec, si) => {
    const r = sectionRect(si);
    const side = r.side;
    const hd = GONDOLA.depth / 2;
    for (let i = 0; i < ROWS; i++) {
      const zc = r.z1 + (HALL.secPitch - ((ROWS - 1) * ROW_PITCH + GONDOLA.depth)) / 2 + GONDOLA.depth / 2 + i * ROW_PITCH;
      RUNS.forEach(([a, b], ri) => {
        const xa = side * a, xb = side * b;
        const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb), len = x2 - x1;
        // 両面の棚。背板（中央）から手前へ半分ずつ
        const front = makeFace(x1, zc, 1, 0, 0, 1, len);
        const back = makeFace(x2, zc, -1, 0, 0, -1, len);
        frame(front, si, GONDOLA, hd, COLOR.frame);
        frame(back, si, GONDOLA, hd, COLOR.frame);
        stock(front, si, GONDOLA, hd);
        stock(back, si, GONDOLA, hd);

        // 両端のエンド。通路に向けて商品を並べ、上にポスター（メインどおり側のまん中の列はテレビ）
        for (const [xe, dir] of [[x1, -1], [x2, 1]]) {
          const ex = xe + dir * ENDCAP_DEPTH / 2;
          fx.box(ex, 0.06, zc, ENDCAP_DEPTH, 0.12, GONDOLA.depth, COLOR.kick);
          GONDOLA.levels.slice(1).forEach((y) => fx.box(ex, y - 0.0125, zc, ENDCAP_DEPTH, 0.025, GONDOLA.depth, COLOR.board));
          for (const s of [-1, 1]) fx.box(ex, GONDOLA.height / 2, zc + s * (hd + 0.02), ENDCAP_DEPTH, GONDOLA.height, 0.04, sec.color);
          fx.box(xe + dir * 0.012, GONDOLA.height / 2, zc, 0.025, GONDOLA.height, GONDOLA.depth, COLOR.frame);
          const end = makeFace(xe, zc + dir * hd, 0, -dir, dir, 0, GONDOLA.depth);
          GONDOLA.levels.forEach((y) => {
            rail(end, y, ENDCAP_DEPTH, sec.color);
            if (sec.display === 'plush') shelfPlush(end, si, y, ENDCAP_DEPTH, GONDOLA.maxItemH);
            else shelfBoxes(end, si, y, ENDCAP_DEPTH, GONDOLA.maxItemH);
          });
          const [px, pz] = onFace(end, GONDOLA.depth / 2, 0.05);
          const isTv = i === 2 && ri === 0 && dir === -side; // メインどおりに向いたエンド
          if (isTv) tvs.push({ si, x: px, z: pz, rot: end.rot });
          else posters[si].add(rng.int(0, 2), px, GONDOLA.height + 0.32, pz, end.rot);
          const [qx, qz] = onFace(end, 0.3, ENDCAP_DEPTH + 0.02);
          pops.add(rng.int(0, PRICE_VARIANTS.length - 1), qx, GONDOLA.levels[2] - 0.06, qz, end.rot);
        }

        const e = ENDCAP_DEPTH;
        colliders.push({ x1: x1 - e - 0.03, z1: zc - hd - 0.04, x2: x2 + e + 0.03, z2: zc + hd + 0.04 });
        minimap.gondolas.push({ x1: x1 - e, z1: zc - hd, x2: x2 + e, z2: zc + hd, si });
      });
    }

    // ---- 壁の高い棚と、その上の在庫の箱・帯看板 ----
    const wz1 = r.k === HALL.perSide - 1 ? -halfL + WALL.depth : r.z1;
    const walls = [side < 0
      ? makeFace(-halfW, wz1, 0, 1, 1, 0, r.z2 - wz1)
      : makeFace(halfW, r.z2, 0, -1, -1, 0, r.z2 - wz1)];
    if (r.k === HALL.perSide - 1) {
      // 奥の壁はいちばん奥の売り場が受け持つ
      const bx1 = side < 0 ? -halfW + WALL.depth : 0.6;
      const bx2 = side < 0 ? -0.6 : halfW - WALL.depth;
      walls.push(makeFace(bx1, -halfL, 1, 0, 0, 1, bx2 - bx1));
    }
    const bandTex = canvasTexture(makeBandCanvas(sec), renderer);
    bandTex.wrapS = THREE.RepeatWrapping;
    walls.forEach((f) => {
      frame(f, si, WALL, WALL.depth, COLOR.frame);
      stock(f, si, WALL, WALL.depth);
      const t = bandTex.clone();
      t.repeat.set(f.len / 5, 1);
      t.needsUpdate = true;
      const band = new THREE.Mesh(new THREE.PlaneGeometry(f.len, 0.42), new THREE.MeshBasicMaterial({ map: t }));
      const [bx, bz] = onFace(f, f.len / 2, WALL.depth + 0.02);
      band.position.set(bx, WALL.height + 0.21, bz);
      band.rotation.y = f.rot;
      scene.add(band);
      overstock(f, si);
    });

    // 吊り看板。遠くからでも売り場がわかるように
    const big = signMesh(sec.name, sec.color, 5.6, 1.3);
    big.position.set(side * 21.5, 4.3, r.cz);
    scene.add(big);
    for (const dx of [-2.4, 2.4]) fx.box(side * 21.5 + dx, (4.95 + height) / 2, r.cz, 0.03, height - 4.95, 0.03, '#888');
  });

  // 壁の棚の上に、在庫の箱を天井近くまで積む
  function overstock(f, si) {
    let u = 0.1;
    while (u < f.len - 0.4) {
      const w = rng.range(0.55, 1.05);
      if (u + w > f.len - 0.1) break;
      let y = WALL.height + 0.02;
      const layers = rng.next() < 0.6 ? 2 : 1;
      for (let l = 0; l < layers; l++) {
        const h = rng.range(0.45, 0.8);
        const d = 0.55;
        const [x, z] = onFace(f, u + w / 2, d / 2 + 0.02);
        if (rng.next() < 0.3) fxOn(f, u + w / 2, d / 2 + 0.02, y + h / 2, w - 0.02, d, h, COLOR.cardboard);
        else products.add(si, rng.int(0, PRODUCTS_PER_SECTION - 1), x, y, z, w - 0.02, h, d, f.rot);
        y += h;
      }
      u += w + rng.range(0.0, 0.08);
    }
  }

  // ---- メインどおりの島陳列：ワイヤーかごの山盛りと、箱の山積み ----
  const wireTex = canvasTexture(makeWireCanvas(), renderer);
  wireTex.wrapS = wireTex.wrapT = THREE.RepeatWrapping;
  const wireMat = new THREE.MeshLambertMaterial({ map: wireTex, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  const bin = (cx, cz, fill) => {
    const BX = 1.2, BZ = 1.0, BH = 0.8;
    const sides = [
      [BX, cx, cz + BZ / 2, 0], [BX, cx, cz - BZ / 2, 0],
      [BZ, cx + BX / 2, cz, Math.PI / 2], [BZ, cx - BX / 2, cz, Math.PI / 2],
    ];
    sides.forEach(([w, x, z, ry]) => {
      const t = wireTex.clone();
      t.repeat.set(w / 0.4, BH / 0.4);
      t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, BH), wireMat.clone());
      m.material.map = t;
      m.position.set(x, BH / 2 + 0.06, z);
      m.rotation.y = ry;
      scene.add(m);
    });
    fx.box(cx, 0.04, cz, BX, 0.08, BZ, '#e8e8e8');
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) fx.box(cx + dx * BX / 2, (BH + 0.06) / 2, cz + dz * BZ / 2, 0.03, BH + 0.06, 0.03, '#f4f4f4');
    fill(cx, cz, BX, BZ, BH);
  };
  const plushPile = (si) => (cx, cz, BX, BZ, BH) => {
    for (let layer = 0; layer < 4; layer++) {
      const n = layer < 2 ? 12 : layer === 2 ? 8 : 4;
      for (let k = 0; k < n; k++) {
        const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
        const shrink = 1 - layer * 0.18;
        const x = cx + rng.range(-BX / 2 + 0.18, BX / 2 - 0.18) * shrink;
        const z = cz + rng.range(-BZ / 2 + 0.16, BZ / 2 - 0.16) * shrink;
        soft.plush(si, pi, PLUSH_COLORS[pi % PLUSH_COLORS.length], x, 0.08 + layer * 0.22, z, rng.range(0.3, 0.42), rng.range(0, Math.PI * 2));
      }
    }
  };
  const ballPile = (si) => (cx, cz, BX, BZ) => {
    for (let layer = 0; layer < 5; layer++) {
      const n = 18 - layer * 3;
      for (let k = 0; k < n; k++) {
        const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
        const r = rng.range(0.1, 0.16);
        const shrink = 1 - layer * 0.12;
        soft.ball(si, pi, catalog[si][pi].art.bg, cx + rng.range(-BX / 2 + r, BX / 2 - r) * shrink, 0.08 + layer * 0.17, cz + rng.range(-BZ / 2 + r, BZ / 2 - r) * shrink, r);
      }
    }
  };
  const PLUSH_SI = SECTIONS.findIndex((s) => s.display === 'plush');
  const BALL_SI = SECTIONS.findIndex((s) => s.icon === 'ball');
  for (let k = 0; k < HALL.perSide; k++) {
    const cz = HALL.secTop - HALL.secPitch * (k + 0.5);
    const kind = k % 3;
    if (kind === 2) {
      // 箱の山積み
      const sis = [k, k + HALL.perSide];
      const T = 2.0, TH = 0.5;
      fx.box(0, TH / 2, cz, T, TH, T, '#ffffff');
      fx.box(0, 0.08, cz, T + 0.06, 0.16, T + 0.06, SECTIONS[sis[0]].color);
      const tiers = [[3, 0.62, 0.34], [2, 0.54, 0.32], [1, 0.46, 0.3]];
      let y = TH;
      tiers.forEach(([n, cell, h]) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const si = sis[(i + j + n) % 2];
          const x = (i - (n - 1) / 2) * cell, z = cz + (j - (n - 1) / 2) * cell;
          products.add(si, rng.int(0, PRODUCTS_PER_SECTION - 1), x, y, z, cell * 0.94, h, cell * 0.94, rng.int(0, 3) * Math.PI / 2);
        }
        y += h;
      });
    } else {
      const fill = kind === 0 ? plushPile(PLUSH_SI) : ballPile(BALL_SI);
      bin(0, cz - 0.55, fill);
      bin(0, cz + 0.55, fill);
    }
    for (const dz of [-1.12, 1.12]) {
      fx.box(0, 0.65, cz + dz, 0.02, 1.3, 0.02, '#999');
      pops.add(rng.int(0, PRICE_VARIANTS.length - 1), 0, 1.35, cz + dz + Math.sign(dz) * 0.012, dz > 0 ? 0 : Math.PI);
    }
    colliders.push({ x1: -1.05, z1: cz - 1.15, x2: 1.05, z2: cz + 1.15, tall: true });
    minimap.islands.push({ x: 0, z: cz, size: 2.0 });
  }

  // ---- エントランスの横断幕 ----
  const welcome = signMesh('おもちゃのひろば', '#e5483b', 10, 2.0, { sub: 'ゆっくり見ていってね', width: 1024, height: 204 });
  welcome.position.set(0, 4.4, HALL.secTop + 2);
  scene.add(welcome);
  for (const dx of [-4.5, 4.5]) fx.box(dx, (5.4 + height) / 2, HALL.secTop + 2, 0.03, height - 5.4, 0.03, '#888');

  // ---- まとめて組み立てる ----
  fx.build(scene);
  pops.build(scene, canvasTexture(makePriceAtlas(), renderer));
  posters.forEach((layer, si) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 768;
    const ctx = c.getContext('2d');
    for (let v = 0; v < 3; v++) ctx.drawImage(makePosterCanvas(SECTIONS[si], catalog[si], v), 0, v * 256);
    layer.build(scene, canvasTexture(c, renderer));
  });
  tvs.forEach((tv) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.66, 0.06), new THREE.MeshLambertMaterial({ color: '#222' })));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.97, 0.58), new THREE.MeshBasicMaterial({ map: canvasTexture(makeTvCanvas(SECTIONS[tv.si], catalog[tv.si]), renderer) }));
    screen.position.z = 0.031;
    g.add(screen);
    g.position.set(tv.x, GONDOLA.height + 0.36, tv.z);
    g.rotation.y = tv.rot;
    scene.add(g);
  });
  const pickables = [...products.build(scene, catalog, renderer), ...soft.build(scene)];

  const bounds = {
    x1: -halfW + WALL.depth, x2: halfW - WALL.depth,
    z1: -halfL + WALL.depth, z2: halfL,
  };
  return { colliders, pickables, bounds, minimap, productCount: products.items.length + soft.count };
}
