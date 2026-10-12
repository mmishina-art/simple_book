# 電子書籍(simple_book)

自炊した PDF を **パソコンで OCR してテキスト(Markdown)にし、スマホの PWA アプリで読む** ための電子書籍アプリです。Vite + TypeScript + vite-plugin-pwa。

- 公開 URL: https://mmishina-art.github.io/simple_book/ (GitHub Pages。main にマージされると公開)
- 外部へ送信しません。本もしおりも、端末の中だけに保存されます。

## 使い方

```
PDF ──(パソコンで OCR)──▶ 本ファイル(.md) ──(スマホに送る)──▶ アプリの「本を追加」 ──▶ 読む
```

### 1. PDF を本ファイルに変換する(パソコン)

必要なもの: Node 22.18 以上、poppler、tesseract(日本語データつき)

```bash
# Mac
brew install poppler tesseract tesseract-lang
# Ubuntu
sudo apt install poppler-utils tesseract-ocr tesseract-ocr-jpn tesseract-ocr-jpn-vert

node scripts/pdf2book.ts 本.pdf                       # → 本.md ができる
node scripts/pdf2book.ts 本.pdf --title "書名" --to 30  # 書名の指定、先頭 30 ページだけ試す
```

- 1 ページずつ OCR して、`本.work/` に結果を残します。途中でやめても、同じコマンドで続きから再開できます。
- 既定は1段組みの小説向け(`--psm 4`)です。段組みや図のある本は `--psm 3`。縦書きの本は `--lang jpn_vert` を試してください。字がうすい・小さいときは `--dpi 400`。
- **見出しは自動で付きます**: 「第一章」「第2部 旅立ち」「序章」「あとがき」「第三話」と、漢数字だけの行(一、二…)。アプリの目次になります。いらないときは `--no-headings`。漢数字だけの短い行は OCR が読み落とすことがあるので、抜けた見出しは手で足してください。
- OCR の誤字や、見出しの付け間違い・付け漏れは、できた `.md` をテキストエディタで直せます(見出しにしたい行の頭に `## ` を付ける)。

### 2. アプリに取り込む(スマホ)

できた `.md` を AirDrop・メール・クラウドなどでスマホに送り、アプリの「本を追加」で選びます(複数まとめて選べます)。取り込んだ本は端末の中(IndexedDB)に入り、オフラインで読めます。

### 3. 読む

- **縦書き(既定)**: 右から左へ、横にスクロール(スワイプ)して読みます。「Aa」→「向き」で横書き(縦スクロール)にも切り替えられます。切り替えても、読んでいる場所は保たれます。
- 読んだ位置(しおり)は自動で保存され、次に開くと続きから読めます。
- 「目次」(`##` `###` の見出し)から章に飛べます。
- 「Aa」で、文字の大きさ・書体(明朝/ゴシック)・色(自動/明るい/セピア/暗い)を変えられます。
- しおりと設定は「しおり・設定のバックアップ」でファイルに書き出せます。**本そのものは含まれない**ので、本ファイルは別に取っておいてください。

## 本ファイルの形式(簡易 Markdown)

```markdown
# 書名
<!-- page 12 -->     ← 元の本のページ区切り(薄く表示される)
## 第1章             ← 見出し(目次になる)。### も使える
本文。空行で段落が分かれる。
```

書名は最初の `# ` の行。`.txt` でも取り込めます。

## 開発

```bash
npm ci
npm run dev          # 開発サーバー
npm run verify       # lint → test → build → check:dist
npx playwright install chromium && npm run test:e2e
```

## ファイル構成

- `scripts/pdf2book.ts`: PDF → 本ファイルの変換(pdftoppm + tesseract を呼ぶ)。`scripts/ocr-text.ts`: OCR の出力の整形(純関数)
- `src/book.ts`: 本ファイルの解析・しおり・設定の正規化(純関数)
- `src/library.ts`: 本の保管庫(IndexedDB)。`src/storage.ts`: しおり・設定(localStorage)
- `src/reader.ts`: 読書画面。`src/main.ts`: 本棚と全体の配線
- `src/install.ts` / `src/pwa.ts` / `src/backup.ts` / `public/boot.js`: インストール説明・更新ボタン・バックアップ・起動失敗の復旧(共通テンプレートのまま)

ルールの詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## ライセンス

アプリのコードは自作です。本のデータ(PDF・本ファイル)はアプリに含まれず、各自の端末の中にだけあります。OCR には Tesseract(Apache License 2.0)を、利用者のパソコンで使います。
