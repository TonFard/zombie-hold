import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

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

export default defineConfig({
  plugins: [vue(), fullReload()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // .vendor 里是几百 MB 的枪包原始素材，不需要监听
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/.vendor/**', '**/.logs/**'] } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
