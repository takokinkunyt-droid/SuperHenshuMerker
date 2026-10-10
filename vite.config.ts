import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 同梱フォント（@fontsource）のCSSから古い woff 形式の指定を外し、woff2 だけを出力に含める。
 * 対象ブラウザはすべて woff2 に対応しているので、公開サイズがほぼ半分になる。
 */
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '');
    },
  };
}

export default defineConfig({
  // 静的ホスティングのどのパスに置いても動くように相対パスで出力する
  base: './',
  plugins: [woff2Only(), react()],
  // AACのWASMエンコーダー（約1MB）は必要な環境でだけ遅延読み込みする
  build: { chunkSizeWarningLimit: 1100 },
});
