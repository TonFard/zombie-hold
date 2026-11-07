import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;

const scene = new Scene();
scene.background = new Color('#66717d');
const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(22, 15, 25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 5;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI * 0.49;

const hemi = new AmbientLight(0xc4cbd4, 1.15);
const sun = new DirectionalLight(0xffe4c2, 2.4);
sun.position.set(-18, 28, 16);
// The first exported blockout has very large flat slabs with tiny contact
// details; realtime shadow acne on those wide faces creates moiré bands.
// Blender renders provide the reviewed soft shadows until proper baked AO is ready.
sun.castShadow = false;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(hemi, sun);

const root = new Group();
scene.add(root);
const loader = new GLTFLoader();
let originalMaterials = new Map<Mesh, MeshStandardMaterial | MeshStandardMaterial[]>();
let whiteMaterials = new Map<Mesh, MeshStandardMaterial | MeshStandardMaterial[]>();
let whiteMode = false;
let litMode = true;
let autoRotate = false;
let doorOpen = false;
let doorPanels: Array<{ node: Object3D; x: number; direction: number; travel: number }> = [];
let doorProgress = 0;
let targetDoorProgress = 0;

loader.load(
  '/konbini/post-outbreak.glb',
  (gltf) => {
    root.add(gltf.scene);
    gltf.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        if (mats.every((mat) => mat instanceof MeshStandardMaterial)) {
          originalMaterials.set(obj, obj.material as MeshStandardMaterial | MeshStandardMaterial[]);
        }
      }
    });
    frameAsset(gltf.scene);
    findDoorPanels(gltf.scene);
    status.textContent = '';
    status.style.display = 'none';
    document.querySelector<HTMLButtonElement>('#door')!.disabled = doorPanels.length === 0;
    if (!doorPanels.length) document.querySelector<HTMLButtonElement>('#door')!.title = '此模型没有可移动的推拉门部件';
  },
  undefined,
  (error) => {
    console.error('Post-outbreak GLB failed to load', error);
    status.textContent = '场景模型未能载入，请检查 assets 生成结果';
  },
);

function frameAsset(asset: Group): void {
  const bounds = new Box3().setFromObject(asset);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const max = Math.max(size.x, size.y, size.z);
  // Focus the store entrance and keep only part of the road in frame. Framing
  // the entire site bounds made the shop too small against the empty roadway.
  const entrance = asset.getObjectByName('Door_Left_Panel');
  const target = entrance ? entrance.getWorldPosition(new Vector3()).setY(1.65) : new Vector3(center.x, center.y * 0.35, center.z);
  controls.target.copy(target);
  camera.position.set(target.x + 7.5, target.y + 6.0, target.z - 17.0);
  camera.near = Math.max(0.03, max / 1000);
  camera.far = max * 18;
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(3.5, size.x * 0.24);
  controls.maxDistance = max * 3;
  sun.target.position.copy(target);
  sun.shadow.camera.left = -max;
  sun.shadow.camera.right = max;
  sun.shadow.camera.top = max;
  sun.shadow.camera.bottom = -max;
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

function findDoorPanels(asset: Group): void {
  const nodes: Object3D[] = [];
  asset.traverse((obj) => {
    if ((obj.name.toLowerCase().includes('door') || obj.name.includes('门')) &&
      (obj.name.toLowerCase().includes('panel') || obj.name.toLowerCase().includes('leaf') || obj.name.includes('扇'))) {
      nodes.push(obj);
    }
  });
  const unique = [...new Set(nodes)];
  if (unique.length >= 2) {
    doorPanels = unique.slice(0, 2).map((node, index) => {
      const bounds = new Box3().setFromObject(node);
      const width = bounds.getSize(new Vector3()).x;
      const closed = typeof node.userData.closed_x === 'number' ? node.userData.closed_x as number : node.position.x;
      const open = typeof node.userData.open_x === 'number' ? node.userData.open_x as number : closed + (index === 0 ? -1 : 1) * width * 0.48;
      return { node, x: closed, direction: Math.sign(open - closed) || (index === 0 ? -1 : 1), travel: Math.max(0.1, Math.abs(open - closed)) };
    });
  }
}

function setWhiteModel(enabled: boolean): void {
  whiteMode = enabled;
  for (const [mesh, original] of originalMaterials) {
    if (enabled) {
      let whites = whiteMaterials.get(mesh);
      if (!whites) {
        const source = Array.isArray(original) ? original : [original];
        const made = source.map(() => new MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.92, metalness: 0 }));
        whites = Array.isArray(original) ? made : made[0];
        whiteMaterials.set(mesh, whites);
      }
      mesh.material = whites;
    } else {
      mesh.material = original;
    }
  }
  const button = document.querySelector<HTMLButtonElement>('#white')!;
  button.classList.toggle('active', enabled);
  renderer.shadowMap.needsUpdate = true;
}

function setLighting(enabled: boolean): void {
  litMode = enabled;
  hemi.intensity = enabled ? 1.15 : 1.8;
  sun.intensity = enabled ? 2.4 : 0.65;
  sun.color.set(enabled ? '#ffe4c2' : '#cad8ff');
  scene.background = new Color(enabled ? '#66717d' : '#141b2a');
  renderer.toneMappingExposure = enabled ? 1.05 : 0.9;
  const button = document.querySelector<HTMLButtonElement>('#light')!;
  button.classList.toggle('active', enabled);
  renderer.shadowMap.needsUpdate = true;
}

function setDoor(open: boolean): void {
  doorOpen = open;
  targetDoorProgress = open ? 1 : 0;
  const button = document.querySelector<HTMLButtonElement>('#door')!;
  button.textContent = open ? '关门' : '开门';
  button.classList.toggle('active', open);
}

document.querySelector<HTMLButtonElement>('#white')!.addEventListener('click', () => setWhiteModel(!whiteMode));
document.querySelector<HTMLButtonElement>('#light')!.addEventListener('click', () => setLighting(!litMode));
document.querySelector<HTMLButtonElement>('#door')!.addEventListener('click', () => setDoor(!doorOpen));
document.querySelector<HTMLButtonElement>('#spin')!.addEventListener('click', (event) => {
  autoRotate = !autoRotate;
  (event.currentTarget as HTMLButtonElement).classList.toggle('active', autoRotate);
});

const raycaster = new Raycaster();
const pointer = new Vector2();
canvas.addEventListener('click', (event) => {
  if (doorPanels.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const doorNodes = doorPanels.map(({ node }) => node);
  const hits = raycaster.intersectObjects(doorNodes, true);
  if (hits.length) setDoor(!doorOpen);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let previous = performance.now();
function animate(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  controls.update();
  if (autoRotate) root.rotation.y += dt * 0.18;
  if (doorPanels.length) {
    doorProgress += (targetDoorProgress - doorProgress) * Math.min(1, dt * 4.5);
    for (const panel of doorPanels) panel.node.position.x = panel.x + panel.direction * panel.travel * doorProgress;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
