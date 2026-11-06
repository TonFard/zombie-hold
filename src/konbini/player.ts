import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Ray, Vector3, type Texture } from 'three';
import { blobShadow } from './fx';
import { B, RigActor } from '../render/actors/rig';
import { SOLDIER_JOINTS, soldierBody } from '../render/actors/soldiers';
import { STORE, type Solid, type World } from './ctx';

/**
 * 玩家：用游戏里的角色模型（团队死斗的士兵，不带枪）。
 * - V 切换第一人称 / 第三人称（第三人称镜头会被墙挡住、自动拉近）
 * - WASD 移动、Shift 跑、Ctrl/C 蹲、空格跳；能走上路缘石、店门口的台阶
 * - 碰撞：胶囊近似成竖直的圆柱，和所有 AABB 做水平推出 + 落地检测
 */
const RADIUS = 0.28;
const HEIGHT = 1.7;
const EYE = 1.58;
const STEP = 0.32;
const GRAV = 18;

export class Player {
  readonly pos = new Vector3(1, 0.15, 5.2);
  readonly vel = new Vector3();
  yaw = Math.PI; // 朝 -Z（看着店）
  pitch = -0.05;
  third = true;
  crouch = 0;
  private onGround = true;
  private walkPhase = 0;
  private speed = 0;
  private camDist = 3.2;
  readonly actor: RigActor;
  private readonly umbrella: Group;
  private readonly ray = new Ray();
  private readonly blob: Mesh;

  constructor(
    private readonly W: World,
    ramp: Texture,
  ) {
    const geo = soldierBody(0, 1);
    void ramp;
    const matte = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
    const glow = new MeshBasicMaterial({ vertexColors: true });
    this.actor = new RigActor(geo, { matte, metal, glow }, SOLDIER_JOINTS, matte);
    for (const m of this.actor.meshes) {
      // 不投实时影（阴影贴图是静态的，只画一次）；脚下用一块软的接触阴影代替
      m.castShadow = false;
      m.frustumCulled = false;
    }
    W.add(this.actor.group);
    this.blob = blobShadow(0.42);
    W.add(this.blob);
    // 透明雨伞：挂在右手骨上
    const uk = W.kit();
    uk.cyl(0.008, 0.008, 0.85, 6, {}, 0xe8e8e8);
    uk.torus(0.04, 0.008, { y: 0, x: 0.04 }, 0x333333, { arc: Math.PI });
    const top = uk.build('umbrellaStick');
    const canopy = new Group();
    const ck = W.kit();
    // 伞面：8 根伞骨 + 半透明的伞布（这里用浅色不透明的薄锥，近看更干净）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ck.tube([new Vector3(0, 0.85, 0), new Vector3(Math.cos(a) * 0.45, 0.72, Math.sin(a) * 0.45), new Vector3(Math.cos(a) * 0.52, 0.62, Math.sin(a) * 0.52)], 0.005, 0xaaaaaa);
    }
    ck.cyl(0.02, 0.55, 0.25, 16, { y: 0.62 }, 0xe8f2ff, { open: true });
    canopy.add(ck.build('canopy'));
    canopy.traverse((o) => {
      const m = (o as { material?: MeshStandardMaterial }).material;
      if (m) {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.45;
        c.depthWrite = false;
        (o as unknown as { material: MeshStandardMaterial }).material = c;
      }
    });
    this.umbrella = new Group();
    this.umbrella.add(top, canopy);
    this.umbrella.visible = false;
    W.add(this.umbrella);
  }

  /** 地面 / 物体顶面高度：脚下 (x, z) 处、不高于 maxY 的最高支撑面 */
  private support(x: number, z: number, maxY: number): number {
    let best = -5;
    for (const s of this.W.solids.list) {
      if (!s.on) continue;
      if (x + RADIUS * 0.6 < s.minx || x - RADIUS * 0.6 > s.maxx || z + RADIUS * 0.6 < s.minz || z - RADIUS * 0.6 > s.maxz) continue;
      if (s.maxy <= maxY && s.maxy > best) best = s.maxy;
    }
    return best;
  }

  /** 水平方向推出：和每个盒子比，脚底以上 STEP 到头顶之间有重叠就推开 */
  private collide(): void {
    const p = this.pos;
    const h = HEIGHT - this.crouch * 0.6;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const s of this.W.solids.list) {
        if (!s.on) continue;
        if (s.maxy <= p.y + STEP || s.miny >= p.y + h) continue;
        if (!this.overlap(s)) continue;
        // 最近点推出（圆 vs 矩形）
        const cx = Math.max(s.minx, Math.min(p.x, s.maxx));
        const cz = Math.max(s.minz, Math.min(p.z, s.maxz));
        let dx = p.x - cx;
        let dz = p.z - cz;
        let d = Math.hypot(dx, dz);
        if (d < 1e-5) {
          // 圆心在盒子里面：往最近的边推
          const opts: Array<[number, number, number]> = [
            [p.x - s.minx, -1, 0],
            [s.maxx - p.x, 1, 0],
            [p.z - s.minz, 0, -1],
            [s.maxz - p.z, 0, 1],
          ];
          let m = opts[0] as [number, number, number];
          for (const o of opts) if (o[0] < m[0]) m = o;
          p.x += m[1] * (m[0] + RADIUS);
          p.z += m[2] * (m[0] + RADIUS);
          moved = true;
          continue;
        }
        if (d < RADIUS) {
          dx /= d;
          dz /= d;
          p.x += dx * (RADIUS - d);
          p.z += dz * (RADIUS - d);
          // 撞墙后速度沿墙方向保留
          const vn = this.vel.x * dx + this.vel.z * dz;
          if (vn < 0) {
            this.vel.x -= vn * dx;
            this.vel.z -= vn * dz;
          }
          moved = true;
          d = RADIUS;
        }
      }
      if (!moved) break;
    }
  }

  private overlap(s: Solid): boolean {
    const p = this.pos;
    const cx = Math.max(s.minx, Math.min(p.x, s.maxx));
    const cz = Math.max(s.minz, Math.min(p.z, s.maxz));
    return (p.x - cx) ** 2 + (p.z - cz) ** 2 < RADIUS * RADIUS;
  }

  get indoor(): boolean {
    const p = this.pos;
    return p.x > STORE.x0 && p.x < STORE.x1 && p.z > STORE.z0 && p.z < STORE.z1 && p.y < STORE.ceil;
  }

  update(dt: number, input: { fwd: number; side: number; run: boolean; crouch: boolean; jump: boolean }): void {
    const want = input.crouch ? 1 : 0;
    this.crouch += Math.sign(want - this.crouch) * Math.min(Math.abs(want - this.crouch), dt * 6);
    const max = input.run && !input.crouch ? 4.6 : input.crouch ? 1.2 : 2.2;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // 朝向约定：yaw = 0 看 +Z
    let wx = sy * input.fwd + cy * input.side;
    let wz = cy * input.fwd - sy * input.side;
    const l = Math.hypot(wx, wz);
    if (l > 1) {
      wx /= l;
      wz /= l;
    }
    const acc = this.onGround ? 14 : 3;
    this.vel.x += (wx * max - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wz * max - this.vel.z) * Math.min(1, acc * dt);
    if (input.jump && this.onGround) {
      this.vel.y = 5.2;
      this.onGround = false;
    }
    this.vel.y -= GRAV * dt;
    const p = this.pos;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    this.collide();
    p.y += this.vel.y * dt;
    // 落地 / 上台阶
    const ground = this.support(p.x, p.z, p.y + STEP);
    if (p.y <= ground + 0.001) {
      if (ground - p.y > 0.01 && this.onGround) p.y += Math.min(ground - p.y, dt * 4); // 平滑上台阶
      else p.y = ground;
      if (p.y < ground - STEP * 0.5) p.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (p.y - ground > 0.05 && this.vel.y <= 0 && this.onGround && p.y - ground < STEP) {
      // 下台阶：贴地
      p.y = ground;
      this.vel.y = 0;
    } else this.onGround = p.y - ground < 0.01;
    // 头顶：撞到东西就停止上升
    const head = p.y + HEIGHT - this.crouch * 0.6;
    for (const s of this.W.solids.list) {
      if (!s.on || this.vel.y <= 0) continue;
      if (s.miny > head - 0.1 && s.miny < head + 0.05 && this.overlap(s)) this.vel.y = 0;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * this.speed * 3.2;
    this.W.player.set(p.x, p.y, p.z);
    this.pose(dt);
  }

  /** 走路、跑步、蹲下、撑伞的姿势 */
  private pose(dt: number): void {
    const a = this.actor;
    const g = a.group;
    g.position.copy(this.pos);
    this.blob.position.set(this.pos.x, this.pos.y + 0.01, this.pos.z);
    g.rotation.set(0, this.yaw, 0);
    a.resetPose();
    const bone = (i: number) => a.bone(i);
    const move = Math.min(1, this.speed / 2.2);
    const run = Math.max(0, Math.min(1, (this.speed - 2.4) / 2));
    const ph = this.walkPhase;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    const c = this.crouch;
    const amp = 0.55 + run * 0.35;
    bone(B.legUL).rotation.x = sn * amp * move - 1.1 * c;
    bone(B.legUR).rotation.x = -sn * amp * move - 1.1 * c;
    bone(B.legLL).rotation.x = Math.max(0, -cs) * (0.9 + run * 0.6) * move + 1.7 * c;
    bone(B.legLR).rotation.x = Math.max(0, cs) * (0.9 + run * 0.6) * move + 1.7 * c;
    bone(B.pelvis).position.y = a.pelvisBaseY - 0.04 * move * (0.5 - 0.5 * Math.cos(2 * ph)) - 0.42 * c;
    bone(B.chest).rotation.x = 0.05 + run * 0.2 + c * 0.3;
    bone(B.head).rotation.x = -this.pitch * 0.5 - run * 0.15;
    // 手臂前后摆；撑伞时右手举到胸前
    bone(B.armUL).rotation.x = -sn * (0.45 + run * 0.6) * move;
    bone(B.armLL).rotation.x = -0.25 - run * 0.9;
    if (this.W.holdingUmbrella) {
      bone(B.armUR).rotation.set(-1.0, 0.35, 0.1);
      bone(B.armLR).rotation.set(-0.9, 0, 0);
    } else {
      bone(B.armUR).rotation.x = sn * (0.45 + run * 0.6) * move;
      bone(B.armLR).rotation.x = -0.25 - run * 0.9;
    }
    // 第一人称时把头藏起来（不然镜头在脑袋里）
    const fp = !this.third;
    bone(B.head).scale.setScalar(fp ? 0.001 : 1);
    // 伞跟着右手
    this.umbrella.visible = this.W.holdingUmbrella;
    if (this.umbrella.visible) {
      g.updateMatrixWorld(true);
      const hand = bone(B.propR);
      hand.getWorldPosition(this.umbrella.position);
      this.umbrella.position.y -= 0.12;
      this.umbrella.rotation.set(0, this.yaw, 0);
    }
    void dt;
  }

  /** 摆好镜头：第一人称在眼睛；第三人称在肩后，被墙挡住就拉近 */
  placeCamera(cam: PerspectiveCamera, dt: number): void {
    const eye = new Vector3(this.pos.x, this.pos.y + EYE - this.crouch * 0.55, this.pos.z);
    const dir = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    if (!this.third) {
      // 走路时镜头轻微上下
      eye.y += Math.sin(this.walkPhase * 2) * 0.025 * Math.min(1, this.speed / 2);
      cam.position.copy(eye).addScaledVector(dir, 0.12);
      cam.lookAt(eye.clone().addScaledVector(dir, 10));
      return;
    }
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = eye.clone().addScaledVector(right, -0.35).add(new Vector3(0, 0.12, 0));
    const back = dir.clone().negate();
    this.ray.set(pivot, back);
    let want = 3.2;
    for (const s of this.W.solids.list) {
      if (!s.on) continue;
      const t = rayHit(this.ray, s);
      if (t !== null && t < want) want = Math.max(0.4, t - 0.2);
    }
    // 拉近也要平滑（以前 20 倍速几乎是瞬间跳，走过货架端头时整个画面一跳一跳）
    this.camDist += (want - this.camDist) * Math.min(1, dt * (want < this.camDist ? 9 : 3));
    cam.position.copy(pivot).addScaledVector(back, this.camDist);
    cam.lookAt(pivot.clone().addScaledVector(dir, 6));
    // 人离镜头太近就隐藏（不然挡住画面）
    this.actor.group.visible = this.camDist > 0.7;
  }
}

function rayHit(r: Ray, s: Solid): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const o = r.origin;
  const d = r.direction;
  const ax: Array<[number, number, number, number]> = [
    [o.x, d.x, s.minx, s.maxx],
    [o.y, d.y, s.miny, s.maxy],
    [o.z, d.z, s.minz, s.maxz],
  ];
  for (const [oo, dd, a, b] of ax) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < a || oo > b) return null;
      continue;
    }
    let t0 = (a - oo) / dd;
    let t1 = (b - oo) / dd;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  // 起点就在盒子里（例如站在柜台旁边）不算
  return tmin > 0 ? tmin : null;
}
