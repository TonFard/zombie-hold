import { Color } from 'three';

/**
 * 天气给各个材质用的共享 uniform：地面、草、树、房子的着色器里引用同一个对象，weather.ts 每帧改 value。
 *   snow 0–1 积雪有多厚（朝上的面变白）· wet 0–1 地面有多湿（颜色变深、变光滑）
 *   rain 0–1 现在雨有多大（积水上的涟漪用；雨停了地面还湿着的时候它是 0）· time 秒（涟漪的动画，到 128 回绕）
 *   sky 现在天有多亮、什么颜色（线性空间；积水、湿路面映出来的就是它——环境贴图是张晴天的全景，阴雨天不能用）
 */
export const WX = {
  snow: { value: 0 },
  wet: { value: 0 },
  rain: { value: 0 },
  time: { value: 0 },
  sky: { value: new Color(0.4, 0.48, 0.58) },
};

/** 积雪的颜色（线性空间）。比真雪暗：太阳直射时不能亮过光晕的阈值，不然整片雪地都在发光 */
export const SNOW_RGB = 'vec3(0.6, 0.645, 0.71)';
