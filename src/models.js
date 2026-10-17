import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { metalMaterial, pbrMaterial } from './textures.js';

// Blender'da betikle üretilen modeller (tools/build_models.py → assets/models/*.glb).
// Malzemeler adlarına göre oyunun dokulu malzemeleriyle değiştirilir;
// köşelere pişirilmiş gölge (AO) köşe renginde gelir ve malzemeyle çarpılır.

const ao = { vertexColors: true };
const MATS = {
  // Gri askeri boya; köşelerde ve altta pas lekeleri, kir, çizikler
  Frame: metalMaterial({ cols: 2, rows: 2, color: [120, 124, 126], grime: 0.9, rust: 0.75, scratches: 1, seed: 41, roughness: 0.5 }, { metalness: 0.6, bump: 1.4 }),
  Gun: metalMaterial({ cols: 1, rows: 3, color: [96, 99, 100], grime: 0.9, rust: 0.6, rivets: false, scratches: 1, seed: 43, roughness: 0.45 }, { metalness: 0.7, bump: 1.6 }),
  Stripe: metalMaterial({ cols: 1, rows: 1, color: [124, 128, 130], stripes: true, grime: 0.8, rust: 0.6, seed: 44, size: 256 }, { metalness: 0.5 }),
  // Koyu mekanik parçalar: Poly Haven'ın gerçek pas dokusu
  Dark: pbrMaterial('rusty_metal_sheet', { repeat: [0.6, 0.6], metalness: 0.55, color: 0x77746e }),
  Black: pbrMaterial('rusty_metal_02', { repeat: [0.8, 0.8], metalness: 0.5, color: 0x3a3836 }),
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
