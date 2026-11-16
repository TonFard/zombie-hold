import type { ZombieKind } from './zombies';

/**
 * 僵尸情报：图鉴页和局内「第一次遇到」的提示卡共用。
 * tags = 一眼能看完的两三个词；ability = 它会干什么；counter = 怎么对付。数字都对着 zombies.ts 写的，改数值时一起改
 */
export interface ZombieIntel {
  tags: string[];
  ability: string;
  counter: string;
}

export const ZOMBIE_INTEL: Record<ZombieKind, ZombieIntel> = {
  walker: { tags: ['成群'], ability: '最常见的感染者。走得慢，但一来就是一群', counter: '打头最省子弹，别让它们围上来' },
  runner: { tags: ['速度快', '血薄'], ability: '冲得很快、咬得也快，第 2 夜起出现', counter: '血很薄，先把它点掉；路障能把它拦在外面' },
  bloater: { tags: ['血厚', '死后爆酸'], ability: '死的时候爆出一滩酸液，站在里面会一直掉血', counter: '别贴着打，隔远一点打死；等酸液散了再过去' },
  breaker: { tags: ['戴头盔', '专拆建筑'], ability: '直奔路障和炮塔，拆建筑的伤害是别的僵尸的三倍', counter: '头盔让爆头只剩七成效果；在它摸到路障之前集火' },
  spitter: { tags: ['远程', '留酸池'], ability: '隔着 11 米吐酸，落地留下一滩酸池', counter: '打头就是打破喉咙上的酸囊，一枪毙命' },
  screamer: { tags: ['给尸群加速', '优先击杀'], ability: '尖叫让 8 米内的僵尸加速四成', counter: '血很薄、头更脆，听到尖叫先找它' },
  crawler: { tags: ['钻路障', '只追人'], ability: '贴着地爬，能从路障底下钻过去，只追人', counter: '站着平射子弹会从它头顶飞过去：压低枪口打' },
  armored: { tags: ['肉盾', '正面钢板'], ability: '正面挂着钢板，从正面打身体只有四成伤害', counter: '打头、绕到背后或者用爆炸；钢板打够了会掉下来' },
  leaper: { tags: ['飞扑', '跳过路障'], ability: '路障拦不住它，隔着 3–8 米会直接扑到你身上', counter: '它蹲下蓄力时打它能打断；落地以后会缓一下' },
  splitter: { tags: ['分裂'], ability: '打身体打死会裂成 3 只小爬行者', counter: '爆头或者炸死才干净' },
  gasser: { tags: ['毒气', '可引爆'], ability: '贴近了会被毒气熏着掉血，死后留一团毒雾', counter: '用火烧死或者炸死，毒气会爆燃，反过来炸伤一片僵尸' },
  colossus: { tags: ['首领', '冲锋', '弱点：胸口'], ability: '冲锋前地上有红线；半血以后狂暴，还会往远处砸碎石（看地上的红圈）', counter: '躲开冲锋，趁它冲完硬直打胸口发光的核心，三倍伤害' },
  reaper: { tags: ['首领', '钩子', '横扫'], ability: '甩钩子把人拽到身前，马上接一刀横扫；半血以后叫来奔袭者', counter: '地上出现一条红线就往旁边闪；被拽过去立刻往后退出扇形' },
  brood: { tags: ['首领', '孵化', '酸弹'], ability: '背上的卵囊不停孵出爬行者，还会往远处吐酸弹（看地上的绿圈）', counter: '绕到背后打卵囊：伤害更高，打爆一个少孵一只' },
  siren: { tags: ['首领', '尖啸', '飞扑'], ability: '仰头蓄力后尖啸，被叫中会走不动；会远远扑过来砸地，半血以后叫来一群奔袭者', counter: '看到它仰头就躲到墙后面；别站在它扑过来的落点上' },
};
