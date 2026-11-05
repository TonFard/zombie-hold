import { CanvasTexture, LinearFilter, type Material, NoColorSpace, type Object3D, type Mesh, type WebGLProgramParametersWithUniforms } from 'three';
import { GRID_H, GRID_W, HALF_H, HALF_W } from '../../game/world/grid';
import type { MapData } from '../../game/world/types';

/**
 * 烘焙的世界光照遮罩：一张贴图覆盖整张地图（每米 4 像素），所有受光材质按世界坐标 xz 查一次。
 *   R = 环境光遮蔽：墙脚、墙角、家具 / 车 / 箱子底下压暗（地面上看得最明显），越靠近障碍越暗
 *   G = 室内程度：0 室外 → 1 屋里深处；门窗附近模糊过渡。屋里的天空光、环境反射乘 (1 − 0.8·G)
 * 只在加载时算一次，每像素多一次贴图采样——低配也开得起，代替实时 SSAO 和逐像素的室内判断。
 * 高度方向：遮蔽只作用在离地 1.2 米以内（墙脚暗、墙顶不暗），室内遮罩只作用在屋顶以下。
 */

const PPM = 4;
const W = GRID_W * PPM;
const H = GRID_H * PPM;

export interface BakedLight {
  texture: CanvasTexture;
  /** 给材质打补丁：在受光计算里乘上遮罩 */
  patch(m: Material): void;
  /** 给一棵对象树里所有受光材质打补丁 */
  patchTree(root: Object3D): void;
  dispose(): void;
}

export function bakeLight(map: MapData): BakedLight {
  const g = map.grid;
  // ---- R：环境光遮蔽。先画"障碍格"的二值图，再模糊两次（近处强、远处弱）
  const solid = document.createElement('canvas');
  solid.width = W;
  solid.height = H;
  const sctx = solid.getContext('2d') as CanvasRenderingContext2D;
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, W, H);
  sctx.fillStyle = '#fff';
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const i = cy * GRID_W + cx;
      if (!g.solid[i]) continue;
      // 细障碍（树干、灯杆）只占中间一小块
      const post = g.post[i] as number;
      if (post > 0) {
        const r = Math.max(1, post * PPM);
        sctx.beginPath();
        sctx.arc((cx + 0.5) * PPM, (cy + 0.5) * PPM, r, 0, Math.PI * 2);
        sctx.fill();
      } else sctx.fillRect(cx * PPM, cy * PPM, PPM, PPM);
    }
  }
  const blur = (src: HTMLCanvasElement, px: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(src, 0, 0);
    return c;
  };
  const aoNear = blur(solid, 1.5).getContext('2d')!.getImageData(0, 0, W, H).data;
  const aoFar = blur(solid, 5).getContext('2d')!.getImageData(0, 0, W, H).data;

  // ---- G：室内程度。raw = 屋里（外墙以内）为 1；soft = 房子外扩一格填满、门窗处挖空后模糊，
  // 门窗附近变暗 → 室内程度降低（光从门窗透进来一两米），墙本身不漏光
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    return [c, ctx] as const;
  };
  const [, rctx] = mk();
  const [softC, fctx] = mk();
  rctx.fillStyle = fctx.fillStyle = '#fff';
  for (const h of map.houses) {
    if (h.roof !== 'flat') continue;
    rctx.fillRect((h.x0 + 1) * PPM, (h.y0 + 1) * PPM, (h.x1 - h.x0 - 2) * PPM, (h.y1 - h.y0 - 2) * PPM);
    fctx.fillRect((h.x0 - 1) * PPM, (h.y0 - 1) * PPM, (h.x1 - h.x0 + 2) * PPM, (h.y1 - h.y0 + 2) * PPM);
  }
  fctx.fillStyle = '#000';
  for (const p of map.props) {
    if (p.house === undefined) continue;
    const opening = p.kind === 'window' || (p.kind === 'doorframe' && p.variant !== 9);
    if (opening) fctx.fillRect((p.x0 - 0.5) * PPM, (p.y0 - 0.5) * PPM, (p.x1 - p.x0 + 1) * PPM, (p.y1 - p.y0 + 1) * PPM);
  }
  const raw = rctx.getImageData(0, 0, W, H).data;
  const soft = blur(softC, 5).getContext('2d')!.getImageData(0, 0, W, H).data;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d') as CanvasRenderingContext2D;
  const img = octx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    // 遮蔽：近距离的贡献大，远距离的给一层柔和的底
    const occ = Math.min(1, ((aoNear[k] as number) / 255) * 0.55 + ((aoFar[k] as number) / 255) * 0.45);
    img.data[k] = Math.round(255 * (1 - 0.7 * occ));
    // 室内：只在屋里有值；门窗附近按模糊值降低，最低留 30%（门口一两米外还是偏暗的）
    const inside = (raw[k] as number) > 127;
    img.data[k + 1] = inside ? Math.round(255 * Math.max(0.3, (soft[k] as number) / 255)) : 0;
    img.data[k + 2] = 0;
    img.data[k + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const texture = new CanvasTexture(out);
  texture.colorSpace = NoColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;

  const roofs = map.houses.filter((h) => h.roof === 'flat');
  const roofH = roofs.length ? Math.max(...roofs.map((h) => h.h)) : 3;
  const uniforms = {
    uBaked: { value: texture },
    uBakedMap: { value: [1 / GRID_W, 1 / GRID_H, HALF_W, HALF_H] as [number, number, number, number] },
    uRoofH: { value: roofH },
  };

  const patched = new WeakSet<Material>();
  const patch = (m: Material): void => {
    const sm = m as Material & { isMeshStandardMaterial?: boolean; isMeshPhysicalMaterial?: boolean };
    if (!sm.isMeshStandardMaterial || patched.has(m)) return;
    patched.add(m);
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
      prev.call(m, sh, r);
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBakedPos;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
{
  vec4 bp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    bp = instanceMatrix * bp;
  #endif
  vBakedPos = ( modelMatrix * bp ).xyz;
}`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBakedPos;
uniform sampler2D uBaked;
uniform vec4 uBakedMap;
uniform float uRoofH;`,
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
{
  vec2 buv = vec2( ( vBakedPos.x + uBakedMap.z ) * uBakedMap.x, ( vBakedPos.z + uBakedMap.w ) * uBakedMap.y );
  vec2 bk = texture2D( uBaked, buv ).rg;
  // 遮蔽只在离地 1.2 米以内，越高越弱
  float aoK = mix( bk.r, 1.0, smoothstep( 0.0, 1.2, vBakedPos.y ) );
  // 室内：屋顶以下才算；屋里的间接光（天空 + 环境反射）压到 20%
  float inK = bk.g * ( 1.0 - smoothstep( uRoofH - 0.2, uRoofH + 0.1, vBakedPos.y ) );
  float indirect = aoK * ( 1.0 - 0.8 * inK );
  reflectedLight.indirectDiffuse *= indirect;
  reflectedLight.indirectSpecular *= indirect;
}`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|baked`;
    m.needsUpdate = true;
  };

  const api: BakedLight = {
    texture,
    patch,
    patchTree(root) {
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) api.patch(mm);
      });
    },
    dispose() {
      texture.dispose();
    },
  };
  return api;
}
