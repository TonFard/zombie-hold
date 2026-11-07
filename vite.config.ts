import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 开发时改了任何文件都整页刷新，不做热替换：游戏状态、视角模型缓存、音频都从头建一遍，
 * 不会出现"新代码 + 旧状态"混在一起的情况。public/ 下的资源（例如转换好的 TACZ 枪）改了也刷新。
 */
function fullReload(): Plugin {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const src = norm(fileURLToPath(new URL('./src/', import.meta.url)));
  const pub = norm(fileURLToPath(new URL('./public/', import.meta.url)));
  // 只管源码和静态资源；.logs、截图、vite.log 这些写在项目目录里的文件不能触发刷新，否则会无限循环
  const ours = (file: string): boolean => {
    const f = norm(file);
    return f.startsWith(src) || f.startsWith(pub);
  };
  return {
    name: 'full-reload-always',
    apply: 'serve',
    handleHotUpdate({ server, file }) {
      if (!ours(file)) return;
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * 资产平台（assets.html）用：开发时列出 public/assets/konbini/models/ 下的 glb / gltf，
 * 交付的模型放进去刷新页面就能看到，不用改目录。返回 { "models/atm.glb": 修改时间 }。
 */
function konbiniAssetIndex(): Plugin {
  const dir = fileURLToPath(new URL('./public/assets/konbini/models/', import.meta.url));
  const walk = (d: string, rel: string, out: Record<string, number>): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, r, out);
      else if (/\.(glb|gltf)$/i.test(e.name)) out[r] = Math.round(fs.statSync(p).mtimeMs);
    }
  };
  return {
    name: 'konbini-asset-index',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__konbini-assets.json', (_req, res) => {
        const out: Record<string, number> = {};
        walk(dir, 'models', out);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(out));
      });
    },
  };
}

/**
 * 原子资产（assets/models/<region>/<site>/*.glb）在开发时直接从源目录读，
 * 不用先拷进 public/。打包时用下面的 copyAtoms 拷进 dist/models。
 */
function atomsAssets(): Plugin {
  const srcDir = fileURLToPath(new URL('./assets/models/', import.meta.url));
  return {
    name: 'atoms-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/models', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const target = path.join(srcDir, rel);
        const norm = path.normalize(target);
        if (!norm.startsWith(path.normalize(srcDir)) || !fs.existsSync(norm)) return next();
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(norm).pipe(res);
      });
    },
  };
}

/** 打包时把原子资产拷进 dist/models/。 */
function copyAtoms(): Plugin {
  const srcDir = fileURLToPath(new URL('./assets/models/', import.meta.url));
  const outDir = fileURLToPath(new URL('./dist/models/', import.meta.url));
  return {
    name: 'copy-atoms',
    apply: 'build',
    closeBundle() {
      if (!fs.existsSync(srcDir)) return;
      fs.cpSync(srcDir, outDir, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [vue(), fullReload(), konbiniAssetIndex(), atomsAssets(), copyAtoms()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // .vendor 里是几百 MB 的枪包原始素材，不需要监听
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/.vendor/**', '**/.logs/**'] } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // 四个页面：游戏本体 + 雨夜便利店街角（konbini.html）+ 便利店资产库（assets.html）+ 原子预览（atoms.html）
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        konbini: fileURLToPath(new URL('./konbini.html', import.meta.url)),
        assets: fileURLToPath(new URL('./assets.html', import.meta.url)),
        atoms: fileURLToPath(new URL('./atoms.html', import.meta.url)),
      },
    },
  },
});
