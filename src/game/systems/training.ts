import type { ZombieKind } from '../data/zombies';
import type { Game } from '../sim';

/** 靶子离玩家起点的距离（米） */
export const TRAINING_RANGES = [10, 20, 30, 45];
/** 打死后多久原地复活（秒） */
export const RESPAWN_DELAY = 2;

interface Slot {
  x: number;
  z: number;
  kind: ZombieKind;
  id: number;
  /** 死了以后的倒计时，< 0 = 活着 */
  wait: number;
}

/** 训练场：在玩家起点前方一排排不会动的靶子，打死 2 秒后原地复活；不刷怪、不结算 */
export class Training {
  readonly slots: Slot[] = [];
  /** 统计：命中、爆头命中、击杀、爆头击杀、最近一次命中的距离 */
  readonly stats = { hits: 0, headHits: 0, kills: 0, headKills: 0, lastDist: 0, lastHead: false };

  /** 射击位：地图南边那条贯穿东西的空地（第 76 行），靶子沿 +X 往东排 */
  readonly standX: number;
  readonly standZ: number;

  constructor(private readonly g: Game) {
    const gr = g.grid;
    this.standX = gr.centerX(3);
    this.standZ = gr.centerZ(76);
    for (const d of TRAINING_RANGES) {
      for (const off of [-1, 0, 1]) {
        const x = this.standX + d;
        const z = this.standZ + off * 1.2;
        if (gr.isBlocked(gr.cellX(x), gr.cellY(z))) continue;
        this.slots.push({ x, z, kind: d >= 30 && off === 0 ? 'breaker' : 'walker', id: -1, wait: 0 });
      }
    }
  }

  /** 进入训练场：阶段改成 training，摆出所有靶子 */
  start(): void {
    const g = this.g;
    g.run.phase = 'training';
    g.invulnerablePlayer = true;
    g.invulnerableCore = true;
    g.player.x = this.standX;
    g.player.z = this.standZ;
    g.player.yaw = Math.PI / 2;
    g.input.aimX = this.standX + 10;
    g.input.aimZ = this.standZ;
    g.events.emit('phase', { phase: 'training', night: 0 });
    g.events.emit('banner', { text: '训练场', sub: '靶子在 10 / 20 / 30 / 45 米。按 Esc 回大厅' });
    for (const s of this.slots) this.spawn(s);
    const p = g.player;
    g.events.on('zombieHit', ({ zombie, head }) => {
      this.stats.hits++;
      if (head) this.stats.headHits++;
      this.stats.lastDist = Math.hypot(zombie.x - p.x, zombie.z - p.z);
      this.stats.lastHead = head;
    });
    g.events.on('zombieDied', ({ head }) => {
      this.stats.kills++;
      if (head) this.stats.headKills++;
    });
  }

  private spawn(s: Slot): void {
    const z = this.g.spawnZombie(s.kind, s.x, s.z);
    if (!z) return;
    z.dummy = true;
    // 面朝玩家
    z.yaw = Math.atan2(this.g.player.x - z.x, this.g.player.z - z.z);
    s.id = z.id;
    s.wait = -1;
  }

  update(dt: number): void {
    const g = this.g;
    for (const s of this.slots) {
      if (s.wait < 0) {
        const z = g.zombies.find((q) => q.id === s.id && q.alive);
        if (!z) s.wait = RESPAWN_DELAY;
        else {
          // 钉在原地：击退和玩家挤过去都推不动
          z.x = s.x;
          z.z = s.z;
          z.kbx = z.kbz = 0;
        }
        continue;
      }
      s.wait -= dt;
      if (s.wait <= 0) this.spawn(s);
    }
  }

  /** 活着的靶子数 */
  alive(): number {
    return this.slots.filter((s) => s.wait < 0).length;
  }
}
