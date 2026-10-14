// 三人称視点のときに映る自分。子どもくらいの背丈（約1.3m）
import * as THREE from 'three';

function part(geo, color, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

// 腕や脚は付け根で回したいので、付け根を原点にしたグループに入れる
function limb(w, h, color, x, y) {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  const geo = new THREE.BoxGeometry(w, h, w);
  geo.translate(0, -h / 2, 0);
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })));
  return g;
}

export function makeAvatar() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legL = limb(0.15, 0.55, '#3d5fa8', -0.1, 0.58);
  const legR = limb(0.15, 0.55, '#3d5fa8', 0.1, 0.58);
  const armL = limb(0.11, 0.45, '#f2c8a0', -0.27, 1.02);
  const armR = limb(0.11, 0.45, '#f2c8a0', 0.27, 1.02);
  body.add(legL, legR, armL, armR);
  body.add(part(new THREE.BoxGeometry(0.42, 0.5, 0.26), '#e5483b', 0, 0.82, 0));
  body.add(part(new THREE.SphereGeometry(0.2, 20, 14), '#f2c8a0', 0, 1.24, 0));
  const cap = part(new THREE.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#f0c22e', 0, 1.27, 0);
  const brim = part(new THREE.BoxGeometry(0.28, 0.03, 0.16), '#f0c22e', 0, 1.28, -0.2);
  body.add(cap, brim);
  // 背中のリュック。後ろから見て向きがわかるように
  body.add(part(new THREE.BoxGeometry(0.32, 0.36, 0.14), '#2f9b7a', 0, 0.86, 0.19));

  // phase: 歩いた距離に比例して進む位相。amount: 0（止まる）〜1（歩く）
  root.userData.animate = (phase, amount) => {
    const s = Math.sin(phase) * 0.6 * amount;
    legL.rotation.x = s;
    legR.rotation.x = -s;
    armL.rotation.x = -s * 0.8;
    armR.rotation.x = s * 0.8;
    body.position.y = Math.abs(Math.cos(phase)) * 0.03 * amount;
  };
  return root;
}
