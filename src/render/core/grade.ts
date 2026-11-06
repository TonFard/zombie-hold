import { ClampToEdgeWrapping, Data3DTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

/**
 * 调色（M19）：程序生成的 3D LUT（32³），不读 .cube 文件——两套（白天 / 夜晚）按昼夜混合。
 *   白天：末日偏暖——压一点饱和度、高光偏暖黄、暗部偏青绿（「最后生还者」那种褪色的暖调）
 *   夜晚：偏冷——暗部压蓝、整体饱和度更低，月光下的颜色都发灰
 * 在色调映射（OutputPass）之后作用在显示空间上，所有画质都开（一次 3D 纹理采样，几乎没有成本）。
 */
export const LUT_SIZE = 32;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 把一个显示空间的颜色调一下；t = 0 白天、1 夜晚 */
function grade(r: number, g: number, b: number, t: number): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 饱和度：白天 0.82、夜晚 0.62
  const sat = 0.82 - 0.2 * t;
  r = lum + (r - lum) * sat;
  g = lum + (g - lum) * sat;
  b = lum + (b - lum) * sat;
  // 分离色调：暗部偏冷（白天青绿、夜晚蓝），高光偏暖（夜里减弱）
  const sh = 1 - Math.min(1, lum * 2.2);
  const hi = Math.max(0, lum * 1.6 - 0.6);
  r += -0.035 * sh * (1 + t) + 0.05 * hi * (1 - 0.7 * t);
  g += 0.012 * sh * (1 - t) + 0.03 * hi * (1 - 0.7 * t);
  b += 0.03 * sh * (1 + 1.5 * t) - 0.03 * hi * (1 - 0.7 * t);
  // 轻微的 S 曲线（对比），夜里更平一点
  const k = 0.12 * (1 - 0.5 * t);
  const s = (v: number) => v + k * (v - 0.5) * (1 - Math.abs(2 * v - 1));
  return [clamp01(s(r)), clamp01(s(g)), clamp01(s(b))];
}

export function makeGradeLut(t: number): Data3DTexture {
  const N = LUT_SIZE;
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const [r, g, b] = grade(x / (N - 1), y / (N - 1), z / (N - 1), t);
        const i = (x + y * N + z * N * N) * 4;
        data[i] = Math.round(r * 255);
        data[i + 1] = Math.round(g * 255);
        data[i + 2] = Math.round(b * 255);
        data[i + 3] = 255;
      }
    }
  }
  const tex = new Data3DTexture(data, N, N, N);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** 测试用：一个颜色经过调色之后是什么（sim / 单元检查） */
export const gradeColor = grade;
