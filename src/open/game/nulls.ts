import type { ArsenalApi, FxApi, HordeApi, RaidersApi, WeatherApi } from './api';

/**
 * 三个模块的「空实现」：模块自己起不来（加载失败、构造时报错）时用它顶上，别的模块和整个页面照常运行。
 */

export function nullWeather(): WeatherApi {
  return {
    kind: 'clear',
    rain: 0,
    snow: 0,
    wet: 0,
    cover: 0,
    temp: 12,
    wind: 0.2,
    label: () => '晴 12℃',
    update: () => {},
    set: () => {},
    setQuality: () => {},
  };
}

export function nullHorde(): HordeApi {
  return {
    count: 0,
    grip: 0,
    ambient: true,
    passive: false,
    update: () => {},
    raycast: () => null,
    damage: () => false,
    blast: () => 0,
    near: () => 0,
    addPrey: () => {},
    removePrey: () => {},
    spawnAt: () => -1,
    spotAround: () => false,
    countTag: () => 0,
    clearTag: () => {},
    melee: () => 0,
    noise: () => {},
    setQuality: () => {},
    save: () => null,
    load: () => {},
  };
}

export function nullRaiders(): RaidersApi {
  return {
    count: 0,
    ambient: true,
    update: () => {},
    raycast: () => null,
    damage: () => false,
    melee: () => 0,
    blast: () => 0,
    noise: () => {},
    spawn: () => -1,
    remove: () => {},
    clearTag: () => {},
    setSide: () => {},
    list: () => 0,
    onBitten: null,
    setQuality: () => {},
    save: () => null,
    load: () => {},
  };
}

export const nullFx: FxApi = { impact: () => {}, blood: () => {}, tracer: () => {}, blast: () => {} };

export function nullArsenal(): ArsenalApi {
  return {
    lookScale: 1,
    freeAmmo: false,
    claws: false,
    fx: nullFx,
    shotAt: () => {},
    held: () => [null, null],
    using: false,
    use: (_item, _seconds, done) => {
      done();
      return true;
    },
    throwGrenade: () => {},
    armed: false,
    update: () => {},
    view: () => {},
    key: () => false,
    wheel: () => {},
    giveGun: () => null,
    giveMelee: () => null,
    strip: () => {},
    returnLoans: () => {},
    save: () => null,
    load: () => {},
  };
}
