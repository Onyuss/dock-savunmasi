import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { metalMaterial } from './textures.js';

// Blender'da betikle üretilen modeller (tools/build_models.py → assets/models/*.glb).
// Malzemeler adlarına göre oyunun dokulu malzemeleriyle değiştirilir;
// köşelere pişirilmiş gölge (AO) köşe renginde gelir ve malzemeyle çarpılır.

const ao = { vertexColors: true };
const MATS = {
  Frame: metalMaterial({ cols: 2, rows: 2, color: [126, 131, 134], grime: 0.6, rust: 0.12, scratches: 1, seed: 41, size: 256, roughness: 0.45 }, { metalness: 0.75, bump: 1.3 }),
  Dark: metalMaterial({ cols: 1, rows: 2, color: [70, 74, 77], grime: 0.5, rust: 0.1, seed: 42, size: 256 }, { metalness: 0.7 }),
  Gun: metalMaterial({ cols: 1, rows: 4, color: [112, 116, 118], grime: 0.7, rivets: false, scratches: 1, seed: 43, size: 256, roughness: 0.4 }, { metalness: 0.8, bump: 1.6 }),
  Stripe: metalMaterial({ cols: 1, rows: 1, color: [140, 145, 148], stripes: true, grime: 0.6, seed: 44, size: 256 }, { metalness: 0.6 }),
  Black: new THREE.MeshStandardMaterial({ color: 0x1c1d1e, metalness: 0.5, roughness: 0.5 }),
  Brass: new THREE.MeshStandardMaterial({ color: 0xa27a3c, metalness: 0.9, roughness: 0.32 }),
  Chain: new THREE.MeshStandardMaterial({ color: 0x18191a, metalness: 0.75, roughness: 0.42 }),
  Cloth: new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.95 }),
  Skin: new THREE.MeshStandardMaterial({ color: 0x8a6650, roughness: 0.8 }),
  Rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0.1, roughness: 0.75 }),
  Screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.45) }),
  Head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.6, 3.2) }),
  Orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.25) }),
  Red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.2, 0.1) }),
  Green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 0.8) }),
};
for (const m of Object.values(MATS)) if (m.isMeshStandardMaterial) Object.assign(m, ao);

function prepare(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material && o.material.name || '').replace(/\.\d+$/, '');
    const mat = MATS[name];
    if (mat) o.material = mat;
    if (!o.geometry.attributes.color && o.material.vertexColors) o.material = o.material.clone(), o.material.vertexColors = false;
  });
  return scene;
}

export const models = {};

export async function loadModels() {
  const loader = new GLTFLoader();
  const [apu, turret] = await Promise.all([
    loader.loadAsync('assets/models/apu.glb'),
    loader.loadAsync('assets/models/turret.glb'),
  ]);
  models.apu = prepare(apu.scene);
  models.turret = prepare(turret.scene);
  return models;
}
