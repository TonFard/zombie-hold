import {
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';
import { Rng } from '../../game/core/rng';
import { TURRETS, isTurret } from '../../game/data/structures';
import type { Structure } from '../../game/entities/structure';
import type { Game } from '../../game/sim';
import { GRID_H, GRID_W, HALF_H, HALF_W } from '../../game/world/grid';
import type { Effects } from '../fx/effects';
import { makeBarricade, makeSpikes, makeTurret, makeTurretOf, type Parts } from './models-structures';

interface Entry {
  s: Structure;
  root: Group;
  seed: number;
  state: number;
  body?: Group;
  parts?: Parts;
  /** 出现时的"砰"一下 */
  pop: number;
  /** 受击抖动 */
  shake: number;
  /** 头顶血条：底 + 填充（填充用 center 锚在左边，按比例缩放） */
  barBg: Sprite;
  barFill: Sprite;
  /** 最近一次受击后的秒数：刚挨打时血条更显眼 */
  hitT: number;
}

/** 血条离地高度、宽度 */
const BAR_Y: Record<string, number> = { barricade: 1.55, turret: 1.5, spikes: 0.7, hmg: 1.6, flamer: 1.5, mortar: 1.7 };
const BAR_W = 0.9;
const BAR_H = 0.09;
/** 多远以内显示满血建筑的血条（受损的建筑更远也显示） */
const BAR_NEAR = 9;
const BAR_FAR = 34;

const _white = new Color(0xffffff);

const GHOST_H: Record<string, number> = { barricade: 1.25, turret: 1.0, spikes: 0.4, hmg: 1.1, flamer: 1.0, mortar: 1.2 };

/** 建筑的画面：模型、受损状态、炮塔转向、放置预览、可建造区域提示 */
export class StructureViews {
  private readonly entries = new Map<number, Entry>();
  private readonly off: Array<() => void> = [];
  private readonly rng = new Rng(31337);

  // 放置预览
  private readonly ghost = new Group();
  private readonly ghostPlane: Mesh;
  private readonly ghostEdges: LineSegments;
  private readonly ghostRing: Mesh;
  private readonly zoneOverlay: Mesh;
  private ghostKind = '';
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
    private readonly fx: Effects,
  ) {
    // ---- 预览 ----
    this.ghostPlane = new Mesh(new PlaneGeometry(0.96, 0.96), new MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    this.ghostPlane.rotation.x = -Math.PI / 2;
    this.ghostPlane.position.y = 0.04;
    this.ghostEdges = new LineSegments(new EdgesGeometry(new BoxGeometry(0.96, 1, 0.96)), new LineBasicMaterial({ color: 0x66ffaa, transparent: true, opacity: 0.9, toneMapped: false }));
    this.ghostRing = new Mesh(new RingGeometry(0.994, 1, 72), new MeshBasicMaterial({ color: 0x6fd0e8, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: 2 }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.position.y = 0.05;
    this.ghost.add(this.ghostPlane, this.ghostEdges, this.ghostRing);
    this.ghost.visible = false;
    scene.add(this.ghost);

    // ---- 可建造区域提示：一张 80×80 的小贴图，建造模式下盖在地面上 ----
    const c = document.createElement('canvas');
    c.width = GRID_W;
    c.height = GRID_H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(GRID_W, GRID_H);
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const on = game.grid.buildable[i] === 1;
      img.data[i * 4] = 90;
      img.data[i * 4 + 1] = 200;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = on ? 16 : 0;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    this.zoneOverlay = new Mesh(new PlaneGeometry(GRID_W, GRID_H), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.zoneOverlay.rotation.x = -Math.PI / 2;
    this.zoneOverlay.position.y = 0.03;
    this.zoneOverlay.visible = false;
    scene.add(this.zoneOverlay);

    const e = game.events;
    this.off.push(
      e.on('structureAdded', (s) => this.add(s)),
      e.on('structureRemoved', ({ structure, destroyed }) => this.remove(structure, destroyed)),
      e.on('structureDamaged', ({ structure }) => {
        const en = this.entries.get(structure.id);
        if (!en) return;
        en.shake = 0.18;
        en.hitT = 0;
        const x = structure.cx - HALF_W + 0.5;
        const z = structure.cy - HALF_H + 0.5;
        this.fx.chips(x, z, isTurret(structure.kind) ? [1.6, 1.5, 1.3] : [0.7, 0.5, 0.3], 3, 0.7);
      }),
      e.on('turretShot', (t) => {
        const kind = game.structures.get(t.id)?.kind ?? 'turret';
        if (kind === 'flamer') this.fx.flame(t.x0, t.z0, t.x1, t.z1);
        else if (kind === 'mortar') this.fx.mortarLaunch(t.x0, t.z0);
        else this.fx.turretFire(t.x0, t.z0, t.x1, t.z1);
      }),
      e.on('repaired', (r) => this.fx.chips(r.x, r.z, [0.5, 1.8, 2.2], 6, 0.5)),
    );
    for (const s of game.structures.values()) this.add(s);
  }

  private add(s: Structure): void {
    const root = new Group();
    root.position.set(s.cx - HALF_W + 0.5, 0, s.cy - HALF_H + 0.5);
    const seed = (s.cx * 131 + s.cy * 17) | 0;
    root.rotation.y = s.kind === 'barricade' ? this.rng.range(-0.06, 0.06) : 0;
    const bg = new Sprite(new SpriteMaterial({ color: 0x05080b, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    const fill = new Sprite(new SpriteMaterial({ color: 0x7ad04a, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    bg.scale.set(BAR_W + 0.04, BAR_H + 0.04, 1);
    fill.scale.set(BAR_W, BAR_H, 1);
    const y = BAR_Y[s.kind] ?? 1.5;
    bg.position.set(root.position.x, y, root.position.z);
    fill.position.copy(bg.position);
    bg.renderOrder = 40;
    fill.renderOrder = 41;
    bg.visible = fill.visible = false;
    this.scene.add(bg, fill);
    const en: Entry = { s, root, seed, state: -1, pop: 0.22, shake: 0, barBg: bg, barFill: fill, hitT: 99 };
    if (isTurret(s.kind)) {
      const parts = s.kind === 'turret' ? makeTurret() : makeTurretOf(s.kind);
      root.add(parts.base);
      if (parts.head) root.add(parts.head);
      en.parts = parts;
    } else if (s.kind === 'spikes') {
      const parts = makeSpikes();
      root.add(parts.base);
      if (parts.blades) root.add(parts.blades);
      en.parts = parts;
    }
    this.scene.add(root);
    this.entries.set(s.id, en);
    this.fx.dust(root.position.x, root.position.z, 8);
  }

  private remove(s: Structure, destroyed: boolean): void {
    const en = this.entries.get(s.id);
    if (!en) return;
    this.scene.remove(en.root, en.barBg, en.barFill);
    en.barBg.material.dispose();
    en.barFill.material.dispose();
    this.entries.delete(s.id);
    const { x, z } = en.root.position;
    if (destroyed) {
      this.fx.chips(x, z, isTurret(s.kind) ? [1.4, 1.3, 1.2] : [0.8, 0.6, 0.35], isTurret(s.kind) ? 22 : 16, 1.3);
      this.fx.dust(x, z, 12);
    } else {
      this.fx.dust(x, z, 6);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.game.player;
    const build = this.game.buildMode;
    for (const en of this.entries.values()) {
      const { s, root } = en;
      this.updateBar(en, dt, Math.hypot(root.position.x - p.x, root.position.z - p.z), build);
      // 出现动画
      if (en.pop > 0) {
        en.pop = Math.max(0, en.pop - dt);
        const k = 1 - en.pop / 0.22;
        root.scale.setScalar(k < 1 ? 0.6 + 0.55 * Math.sin(k * Math.PI * 0.5) - 0.15 * Math.sin(k * Math.PI) : 1);
      } else if (root.scale.x !== 1) root.scale.setScalar(1);

      // 受击抖动
      if (en.shake > 0) {
        en.shake = Math.max(0, en.shake - dt);
        const a = en.shake * 0.35;
        root.position.x = s.cx - HALF_W + 0.5 + Math.sin(this.time * 90) * a * 0.12;
        root.position.z = s.cy - HALF_H + 0.5 + Math.cos(this.time * 83) * a * 0.12;
      }

      if (s.kind === 'barricade') {
        const f = s.hp / s.maxHp;
        const state = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
        if (state !== en.state) {
          if (en.body) root.remove(en.body);
          en.body = makeBarricade(en.seed, state);
          root.add(en.body);
          // 掉一级木板时溅点木屑
          if (en.state >= 0) this.fx.chips(root.position.x, root.position.z, [0.8, 0.6, 0.35], 8, 1);
          en.state = state;
        }
      } else if (isTurret(s.kind) && en.parts?.head) {
        en.parts.head.rotation.y = s.aim;
        // 开火后坐力：炮管缩回再弹出
        const k = Math.max(0, 1 - s.sinceShot / 0.09);
        en.parts.head.position.set(-Math.sin(s.aim) * 0.07 * k, 0, -Math.cos(s.aim) * 0.07 * k);
      } else if (s.kind === 'spikes' && en.parts?.blades) {
        // 踩中时刺猛地往上顶一下
        const k = Math.max(0, 1 - s.sinceShot / 0.18);
        en.parts.blades.scale.y = 1 + k * 0.25;
      }
    }
    this.updateGhost();
  }

  /**
   * 头顶血条：受损的建筑在 BAR_FAR 米内都显示（刚挨打时更亮），满血的只在走近或建造模式下显示。
   * 不做深度测试：隔着墙也能看见自己的防线还剩多少血
   */
  private updateBar(en: Entry, dt: number, d: number, build: boolean): void {
    en.hitT += dt;
    const f = Math.max(0, Math.min(1, en.s.hp / en.s.maxHp));
    const hurt = f < 0.999;
    const show = (hurt && d < BAR_FAR) || build || d < BAR_NEAR;
    en.barBg.visible = en.barFill.visible = show && f > 0;
    if (!show) return;
    // 远处稍微放大一点，保证屏幕上看得清
    const k = 1 + Math.max(0, d - 8) * 0.025;
    en.barBg.scale.set((BAR_W + 0.04) * k, (BAR_H + 0.04) * k, 1);
    en.barFill.scale.set(Math.max(0.001, BAR_W * f) * k, BAR_H * k, 1);
    // 左对齐：填充的锚点放在"底条左边缘"对应的位置
    en.barFill.center.set(0.5 / Math.max(0.001, f), 0.5);
    const c = en.barFill.material.color;
    if (f > 0.6) c.setHex(0x7ad04a);
    else if (f > 0.3) c.setHex(0xf0b83a);
    else c.setHex(0xe8553f);
    // 刚挨打：亮一下
    const flash = Math.max(0, 1 - en.hitT / 0.25);
    if (flash > 0) c.lerp(_white, flash * 0.6);
    const a = hurt || build ? 1 : Math.max(0, 1 - (d - BAR_NEAR + 3) / 3);
    en.barFill.material.opacity = a;
    en.barBg.material.opacity = 0.75 * a;
  }

  private updateGhost(): void {
    const g = this.game;
    this.zoneOverlay.visible = g.buildMode;
    if (!g.buildMode || !g.player.alive) {
      this.ghost.visible = false;
      return;
    }
    const c = g.buildCursor;
    this.ghost.visible = true;
    this.ghost.position.set(c.cx - HALF_W + 0.5, 0, c.cy - HALF_H + 0.5);
    const ok = c.valid;
    const col = new Color(ok ? 0x44ff88 : 0xff4a3a);
    (this.ghostPlane.material as MeshBasicMaterial).color.copy(col);
    (this.ghostPlane.material as MeshBasicMaterial).opacity = 0.32 + 0.12 * Math.sin(this.time * 6);
    (this.ghostEdges.material as LineBasicMaterial).color.copy(col);
    if (this.ghostKind !== g.buildKind) {
      this.ghostKind = g.buildKind;
      const h = GHOST_H[g.buildKind] ?? 1;
      this.ghostEdges.geometry.dispose();
      this.ghostEdges.geometry = new EdgesGeometry(new BoxGeometry(0.96, h, 0.96));
      this.ghostEdges.position.y = h / 2;
    }
    // 炮塔：显示射程圈（按种类缩放）
    const k = g.buildKind;
    this.ghostRing.visible = isTurret(k);
    if (isTurret(k)) this.ghostRing.scale.setScalar(TURRETS[k].range);
  }

  dispose(): void {
    for (const f of this.off) f();
    for (const en of this.entries.values()) {
      this.scene.remove(en.root, en.barBg, en.barFill);
      en.barBg.material.dispose();
      en.barFill.material.dispose();
    }
    this.entries.clear();
    this.scene.remove(this.ghost, this.zoneOverlay);
  }
}
