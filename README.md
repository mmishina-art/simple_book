# PWA アプリ テンプレート

スマホ向け PWA(ツール/ゲーム)を手軽に作るためのテンプレートです。Vite + TypeScript + vite-plugin-pwa。

## 新しいアプリの作り方

1. GitHub で **Use this template** → 新しいリポジトリを作る
2. Settings → Pages → Source を **GitHub Actions** にする
3. **`package.json` の `name` をアプリごとの名前に変え、`"pwaTemplate": true` の行を削除する**(同じサイトの他のアプリと、保存データやキャッシュが混ざらないようにするため)。アプリ名・色を `vite.config.ts` と `index.html` で書き換え、`npm run icons` でアイコンを作り直す
4. `CLAUDE.md` の「このアプリの方針」を記入する
5. `src/` のサンプル(タップカウンター)を置き換える。最初の画面の「インストールする方法」の入口、バージョン表示、「記録のバックアップ」、起動失敗時の復旧(`public/boot.js` と `#boot-error`)は残す

## 開発

```bash
npm ci
npm run dev          # 開発サーバー
npm run verify       # lint → test → build → check:dist
npx playwright install chromium && npm run test:e2e
```

ルールの詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。
