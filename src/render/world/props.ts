import { Rng } from '../../game/core/rng';
import type { Prop, WallStyle } from '../../game/world/types';
import type { Builder } from '../kit';
import { buildGeneratorCore, generator, workbench } from './props/base';
import { barrier, canopy, chunk, crate, pillar, pump, rack, rubble } from './props/clutter';
import { barrel, fence, lamp, sandbag } from './props/street';
import { container } from './props/containers';
import { tree } from './props/nature';
import { car } from './props/vehicles';
import { doorframe, wall } from './props/walls';

/**
 * 地图道具的几何体入口。每类道具在 props/ 下各自的文件里建模：局部坐标系长边沿 X，厚度沿 Z，
 * 原点在底面中心，外层统一用 push() 摆到世界位置。
 */

export { buildGeneratorCore };

/** trimWalls：这些风格的墙体由写实贴图负责，程序这边只建窗、钢柱、铁丝网等细节 */
export function buildProp(b: Builder, p: Prop, trimWalls: ReadonlySet<WallStyle> = new Set()): void {
  const rng = new Rng(((p.x0 * 73856093) ^ (p.y0 * 19349663) ^ 0x9e3779b9) >>> 0);
  switch (p.kind) {
    case 'wall':
      return wall(b, p, rng, trimWalls.has(p.style ?? 'compound'));
    case 'doorframe':
      return doorframe(b, p);
    case 'container':
      return container(b, p, rng);
    case 'car':
      return car(b, p, rng);
    case 'tree':
      return tree(b, p, rng);
    case 'crate':
      return crate(b, p, rng);
    case 'barrier':
      return barrier(b, p);
    case 'pump':
      return pump(b, p, rng);
    case 'pillar':
      return pillar(b, p);
    case 'canopy':
      return canopy(b, p);
    case 'rack':
      return rack(b, p, rng);
    case 'rubble':
      return rubble(b, p, rng);
    case 'chunk':
      return chunk(b, p, rng);
    case 'lamp':
      return lamp(b, p);
    case 'barrel':
      return barrel(b, p, rng);
    case 'sandbag':
      return sandbag(b, p, rng);
    case 'fence':
      return fence(b, p, rng);
    case 'generator':
      return generator(b, p);
    case 'workbench':
      return workbench(b, p);
    case 'pallet':
      return crate(b, { ...p, h: Math.min(p.h ?? 0.9, 0.9) }, rng);
    case 'dumpster':
      return container(b, { ...p, h: p.h ?? 1.3 }, rng);
    case 'scrapbox':
      return;
  }
}
