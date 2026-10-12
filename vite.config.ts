/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

const { version, name: appId } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; name: string };

// アプリ名・色はここと index.html の2か所だけ。新しいアプリを作るときに書き換える。
const APP_NAME = '電子書籍';
const THEME_COLOR = '#1f6feb';
const BACKGROUND_COLOR = '#f6f8fa';

export default defineConfig({
  // GitHub Pages のサブパス配信でも動くよう、相対パスにする
  base: './',
  // 画面に表示するバージョン（package.json の version）
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // アプリの ID（package.json の name）。保存データのキー・バックアップの app 名・起動失敗の復旧の範囲に使う。
    // GitHub Pages では、すべてのアプリが同じサイトに載るので、アプリごとに別の名前にする。
    __APP_ID__: JSON.stringify(appId),
  },
  plugins: [
    {
      // public/boot.js（Vite を通らない）が読めるように、アプリの ID を index.html に埋め込む
      name: 'app-id-meta',
      transformIndexHtml: (html) => html.replace('__APP_ID__', appId),
    },
    VitePWA({
      // 'prompt': 新版は待機させ、画面の「更新」ボタンで切り替える（プレイ中に勝手に切り替えない）
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'PDFから作った本を読む電子書籍アプリ',
        lang: 'ja',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // OCR のデータ(約 16MB)は、本を読むだけの人に配らない。「PDF を変換」を初めて使ったときに取得して、あとは端末に残す(下の runtimeCaching)
        globIgnores: ['ocr/**'],
        // PDF 変換の部品(pdf.js)も同様。初回の取得は変換画面を開いたとき
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/ocr/') || /pdf\.worker/.test(url.pathname),
            handler: 'CacheFirst',
            // キャッシュ名は「アプリの ID-」で始める(public/boot.js の復旧が、このアプリのキャッシュだけを消せるように)
            options: { cacheName: `${appId}-ocr`, expiration: { maxEntries: 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
