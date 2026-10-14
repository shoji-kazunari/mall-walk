// 店内の3D空間を組み立てる。単位はメートル。
// 入口が +z 側、奥が -z 側。中央を貫く広い通り（メインどおり）の左右に売り場が5つずつ並ぶ。
import * as THREE from 'three';
import { SECTIONS, PRODUCTS_PER_SECTION } from './catalog.js';
import { makeAtlas, makeSignCanvas, ATLAS_GRID } from './art.js';

export const HALL = {
  halfW: 46,        // 側壁の x
  halfL: 66,        // 入口と奥の壁の z
  height: 10,       // 天井の高さ。見上げたときの広さはここで決まる
  prom: 5,          // メインどおりの半幅
  secTop: 54,       // ここより入口側はエントランス広場
  secPitch: 23.2,   // 売り場ひとつの奥行き
  perSide: 5,
};

const GONDOLA = { depth: 1.2, height: 1.45, levels: [0.12, 0.56, 1.0], maxItemH: 0.38 };
const WALL_SHELF = { depth: 0.6, height: 3.1, levels: [0.12, 0.62, 1.12, 1.62, 2.12, 2.62], maxItemH: 0.44 };
const RUNS = [[7.5, 22], [25, 39.5]]; // 売り場内の棚の列（|x| の範囲）。間が横の通路
const ROWS = 5;
const ROW_PITCH = 3.6;
const PILLAR_X = [6.2, 23.5, 42.5];

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

// 商品の箱。InstancedMesh 1つ＝1売り場。各インスタンスがテクスチャの何番目を貼るかを aTile で持つ
function makeProductMaterial(texture) {
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec2 aTile;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>\n  vMapUv = vMapUv * ${(1 / ATLAS_GRID).toFixed(6)} + aTile;`,
    );
  };
  return mat;
}

class ProductLayer {
  constructor() {
    this.items = []; // {si, pi, x, y, z, w, h, d, rot}
  }
  add(si, pi, x, y, z, w, h, d, rot) {
    this.items.push({ si, pi, x, y, z, w, h, d, rot });
  }
  build(scene, catalog, renderer) {
    const meshes = [];
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const bySection = SECTIONS.map(() => []);
    this.items.forEach((it) => bySection[it.si].push(it));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    bySection.forEach((items, si) => {
      const tex = new THREE.CanvasTexture(makeAtlas(catalog[si]));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, maxAniso);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const tiles = new Float32Array(items.length * 2);
      const mesh = new THREE.InstancedMesh(geo, makeProductMaterial(tex), items.length);
      const productOf = new Uint8Array(items.length);
      items.forEach((it, i) => {
        pos.set(it.x, it.y, it.z);
        q.setFromAxisAngle(up, it.rot);
        scl.set(it.w, it.h, it.d);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        // テクスチャは上から下へ並べて描いてあるが、UVのvは下が0なので行を反転させる
        tiles[i * 2] = (it.pi % ATLAS_GRID) / ATLAS_GRID;
        tiles[i * 2 + 1] = (ATLAS_GRID - 1 - Math.floor(it.pi / ATLAS_GRID)) / ATLAS_GRID;
        productOf[i] = it.pi;
      });
      geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
      mesh.computeBoundingSphere();
      mesh.userData = { section: si, productOf };
      scene.add(mesh);
      meshes.push(mesh);
    });
    return meshes;
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

// 1段の棚に、左端から商品を詰めていく。同じ商品を2〜3個ずつ並べると売り場らしくなる
function fillShelf(rng, layer, si, catalog, from, to, place, maxH, maxD) {
  let cur = from;
  while (cur < to) {
    const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
    const p = catalog[si][pi];
    const w = p.size.w, h = Math.min(p.size.h, maxH), d = Math.min(p.size.d * 2.2, maxD);
    const facings = rng.int(1, 3);
    for (let f = 0; f < facings; f++) {
      if (cur + w > to) return;
      place(pi, cur + w / 2, w, h, d);
      cur += w + 0.025;
    }
    cur += 0.02;
  }
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
  ctx.lineWidth = 3;
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
  const colliders = []; // {x1, z1, x2, z2}
  const minimap = { gondolas: [], islands: [] };
  const products = new ProductLayer();
  const fx = new FixtureLayer();
  const { halfW, halfL, height } = HALL;

  // ---- 床・壁・天井 ----
  const floorTex = floorTexture('#efe7da', '#e0d5c4', 2);
  floorTex.repeat.set(halfW, halfL); // 1マス=1m
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const promTex = floorTexture('#d9c3a3', '#c9b08c', 1);
  promTex.repeat.set(HALL.prom, halfL);
  const prom = new THREE.Mesh(new THREE.PlaneGeometry(HALL.prom * 2, halfL * 2), new THREE.MeshLambertMaterial({ map: promTex }));
  prom.rotation.x = -Math.PI / 2;
  prom.position.y = 0.003;
  scene.add(prom);

  const wallMat = new THREE.MeshLambertMaterial({ color: '#f4f1ec', emissive: '#5a5650' });
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

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), new THREE.MeshBasicMaterial({ color: '#e6e4e0' }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  scene.add(ceiling);

  // 天井の照明。等間隔に並んだ光が遠くへ続くことで奥行きが出る
  const lampGeo = new THREE.PlaneGeometry(2.4, 0.32);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fffdf4' });
  const lampPos = [];
  for (let x = -halfW + 4; x <= halfW - 4; x += 4) {
    if (Math.abs(x) < HALL.prom + 1) continue;
    for (let z = -halfL + 3; z <= halfL - 3; z += 6) lampPos.push([x, z]);
  }
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPos.length);
  const lm = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  lampPos.forEach(([x, z], i) => {
    lm.setPosition(x, height - 0.02, z);
    lamps.setMatrixAt(i, lm);
  });
  scene.add(lamps);

  // メインどおりの真上は天窓
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(HALL.prom * 1.6, halfL * 2 - 4), new THREE.MeshBasicMaterial({ color: '#dff0ff' }));
  sky.rotation.x = Math.PI / 2;
  sky.position.y = height - 0.01;
  scene.add(sky);
  for (let z = -halfL + 2; z <= halfL - 2; z += 4) fx.box(0, height - 0.15, z, HALL.prom * 1.7, 0.25, 0.18, '#c8ccd2');

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
      fx.box(x, height / 2, z, 0.8, height, 0.8, '#f7f5f1');
      fx.box(x, 2.4, z, 0.84, 0.3, 0.84, '#c9ced6');
      colliders.push({ x1: x - 0.4, z1: z - 0.4, x2: x + 0.4, z2: z + 0.4 });
    }
  }

  // ---- 売り場ごとの棚 ----
  SECTIONS.forEach((sec, si) => {
    const r = sectionRect(si);
    const side = r.side;
    for (let i = 0; i < ROWS; i++) {
      const zc = r.z1 + (HALL.secPitch - ((ROWS - 1) * ROW_PITCH + GONDOLA.depth)) / 2 + GONDOLA.depth / 2 + i * ROW_PITCH;
      for (const [a, b] of RUNS) {
        const xa = side * a, xb = side * b;
        const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb), xm = (x1 + x2) / 2, len = x2 - x1;
        const hd = GONDOLA.depth / 2;
        fx.box(xm, 0.06, zc, len, 0.12, GONDOLA.depth, '#7f8794');
        fx.box(xm, GONDOLA.height / 2, zc, len, GONDOLA.height, 0.05, '#f1efe9');
        GONDOLA.levels.slice(1).forEach((y) => fx.box(xm, y - 0.0125, zc, len, 0.025, GONDOLA.depth, '#dde1e6'));
        fx.box(xm, GONDOLA.height + 0.01, zc, len, 0.02, GONDOLA.depth * 0.5, '#dde1e6');
        for (const ex of [x1, x2]) fx.box(ex, 0.8, zc, 0.05, 1.6, GONDOLA.depth + 0.04, sec.color);
        colliders.push({ x1: x1 - 0.03, z1: zc - hd - 0.02, x2: x2 + 0.03, z2: zc + hd + 0.02 });
        minimap.gondolas.push({ x1, z1: zc - hd, x2, z2: zc + hd, si });

        for (const face of [1, -1]) {
          GONDOLA.levels.forEach((y) => {
            fillShelf(rng, products, si, catalog, x1 + 0.08, x2 - 0.08, (pi, x, w, h, d) => {
              products.add(si, pi, x, y, zc + face * (hd - d / 2 - 0.01), w, h, d, face > 0 ? 0 : Math.PI);
            }, GONDOLA.maxItemH, hd - 0.05);
          });
        }
      }
    }

    // 側壁の高い棚
    const wx = side * (halfW - WALL_SHELF.depth / 2);
    const wz1 = si % HALL.perSide === HALL.perSide - 1 ? -halfL + WALL_SHELF.depth : r.z1;
    const wzm = (wz1 + r.z2) / 2, wlen = r.z2 - wz1;
    fx.box(side * (halfW - 0.025), WALL_SHELF.height / 2, wzm, 0.05, WALL_SHELF.height, wlen, '#f1efe9');
    fx.box(wx, 0.06, wzm, WALL_SHELF.depth, 0.12, wlen, '#7f8794');
    WALL_SHELF.levels.slice(1).forEach((y) => fx.box(wx - side * 0.02, y - 0.0125, wzm, WALL_SHELF.depth, 0.025, wlen, '#dde1e6'));
    fx.box(wx - side * 0.29, WALL_SHELF.height + 0.25, wzm, 0.04, 0.5, wlen, sec.color);
    WALL_SHELF.levels.forEach((y) => {
      fillShelf(rng, products, si, catalog, wz1 + 0.05, r.z2 - 0.05, (pi, z, w, h, d) => {
        products.add(si, pi, side * (halfW - 0.02 - d / 2), y, z, w, h, d, -side * Math.PI / 2);
      }, WALL_SHELF.maxItemH, WALL_SHELF.depth - 0.06);
    });

    // 奥の壁の棚（いちばん奥の売り場が受け持つ）
    if (r.k === HALL.perSide - 1) {
      const bz = -halfL + WALL_SHELF.depth / 2;
      const bx1 = side < 0 ? -halfW + WALL_SHELF.depth : 0.6;
      const bx2 = side < 0 ? -0.6 : halfW - WALL_SHELF.depth;
      fx.box((bx1 + bx2) / 2, WALL_SHELF.height / 2, -halfL + 0.025, bx2 - bx1, WALL_SHELF.height, 0.05, '#f1efe9');
      fx.box((bx1 + bx2) / 2, 0.06, bz, bx2 - bx1, 0.12, WALL_SHELF.depth, '#7f8794');
      WALL_SHELF.levels.slice(1).forEach((y) => fx.box((bx1 + bx2) / 2, y - 0.0125, bz + 0.02, bx2 - bx1, 0.025, WALL_SHELF.depth, '#dde1e6'));
      fx.box((bx1 + bx2) / 2, WALL_SHELF.height + 0.25, bz + 0.29, bx2 - bx1, 0.5, 0.04, sec.color);
      WALL_SHELF.levels.forEach((y) => {
        fillShelf(rng, products, si, catalog, bx1 + 0.05, bx2 - 0.05, (pi, x, w, h, d) => {
          products.add(si, pi, x, y, -halfL + d / 2 + 0.02, w, h, d, 0);
        }, WALL_SHELF.maxItemH, WALL_SHELF.depth - 0.06);
      });
    }

    // 吊り看板。遠くからでも売り場がわかるよう高く大きく
    const big = signMesh(sec.name, sec.color, 7, 1.75);
    big.position.set(side * 23.5, 5.6, r.cz);
    scene.add(big);
    for (const dx of [-3, 3]) fx.box(side * 23.5 + dx, (5.6 + 0.875 + height) / 2, r.cz, 0.03, height - 5.6 - 0.875, 0.03, '#888');
    // メインどおりから横を向いたときに見える看板
    const side2 = signMesh(sec.name, sec.color, 5, 1.0);
    side2.position.set(side * 7.4, 2.4, r.cz);
    side2.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(side2);
    fx.box(side * 7.4, 1.75, r.cz, 0.06, 0.3, 0.06, '#888');
  });

  // ---- メインどおりの島陳列。左右の売り場から目玉を集めて山積みにする ----
  for (let k = 0; k < HALL.perSide; k++) {
    const cz = HALL.secTop - HALL.secPitch * (k + 0.5);
    const sis = [k, k + HALL.perSide];
    const T = 2.4, TH = 0.5;
    fx.box(0, TH / 2, cz, T, TH, T, '#ffffff');
    fx.box(0, 0.08, cz, T + 0.06, 0.16, T + 0.06, SECTIONS[sis[0]].color);
    colliders.push({ x1: -T / 2 - 0.05, z1: cz - T / 2 - 0.05, x2: T / 2 + 0.05, z2: cz + T / 2 + 0.05 });
    minimap.islands.push({ x: 0, z: cz, size: T });
    const tiers = [[3, 0.72, 0.32], [2, 0.6, 0.3], [1, 0.5, 0.28]];
    let y = TH;
    tiers.forEach(([n, cell, h]) => {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const si = sis[(i + j + n) % 2];
        const pi = rng.int(0, PRODUCTS_PER_SECTION - 1);
        const x = (i - (n - 1) / 2) * cell, z = cz + (j - (n - 1) / 2) * cell;
        products.add(si, pi, x, y, z, cell * 0.94, h, cell * 0.94, rng.int(0, 3) * Math.PI / 2);
      }
      y += h;
    });
  }

  // ---- エントランスの横断幕 ----
  const welcome = signMesh('おもちゃのひろば', '#e5483b', 12, 2.6, { sub: 'ゆっくり見ていってね', width: 1024, height: 224 });
  welcome.position.set(0, 6.4, HALL.secTop + 2);
  scene.add(welcome);
  for (const dx of [-5.5, 5.5]) fx.box(dx, (6.4 + 1.3 + height) / 2, HALL.secTop + 2, 0.03, height - 6.4 - 1.3, 0.03, '#888');

  fx.build(scene);
  const productMeshes = products.build(scene, catalog, renderer);

  const bounds = {
    x1: -halfW + WALL_SHELF.depth, x2: halfW - WALL_SHELF.depth,
    z1: -halfL + WALL_SHELF.depth, z2: halfL,
  };
  return { colliders, productMeshes, bounds, minimap, productCount: products.items.length };
}
