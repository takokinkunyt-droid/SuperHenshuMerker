import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 静的ホスティングのどのパスに置いても動くように相対パスで出力する
  base: './',
  plugins: [react()],
  // AACのWASMエンコーダー（約1MB）は必要な環境でだけ遅延読み込みする
  build: { chunkSizeWarningLimit: 1100 },
});
