// 自炊した PDF を OCR でテキストにして、アプリに取り込める本ファイル(.md)を作る。パソコンで実行する。
//
//   node scripts/pdf2book.ts 本.pdf [--title 書名] [--out 本.md] [--lang jpn] [--dpi 300] [--from 1] [--to 50] [--jobs 4] [--psm 4] [--no-headings]
//
// 必要なもの: Node 22.18 以上 / poppler(pdftoppm, pdfinfo) / tesseract と日本語データ(jpn。縦書きの本は jpn_vert も)
//   Mac:    brew install poppler tesseract tesseract-lang
//   Ubuntu: sudo apt install poppler-utils tesseract-ocr tesseract-ocr-jpn tesseract-ocr-jpn-vert
// 途中でやめても、work フォルダに 1 ページずつ結果が残るので、同じコマンドで続きから再開できる。
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { buildBookMarkdown, cleanPage } from './ocr-text.ts';

const run = promisify(execFile);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    out: { type: 'string' },
    lang: { type: 'string', default: 'jpn' },
    dpi: { type: 'string', default: '300' },
    from: { type: 'string' },
    to: { type: 'string' },
    jobs: { type: 'string' },
    psm: { type: 'string', default: '4' }, // 4: 1段組み(小説向け)。段組みや図のある本は 3
    'no-headings': { type: 'boolean' },
    work: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const pdf = positionals[0];
if (values.help || !pdf) {
  console.log('使い方: node scripts/pdf2book.ts 本.pdf [--title 書名] [--out 本.md] [--lang jpn] [--dpi 300] [--from N] [--to N] [--jobs N] [--no-headings]');
  process.exit(pdf ? 0 : 1);
}
if (!existsSync(pdf)) fail(`PDF が見つかりません: ${pdf}`);

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

async function need(cmd: string, args: string[], hint: string): Promise<string> {
  try {
    const r = await run(cmd, args);
    return r.stdout + r.stderr;
  } catch {
    return fail(`${cmd} が使えません。${hint}`);
  }
}

const lang = values.lang;
const dpi = Number(values.dpi);
const base = basename(pdf).replace(/\.pdf$/i, '');
const out = resolve(values.out ?? join(dirname(pdf), `${base}.md`));
const work = resolve(values.work ?? join(dirname(pdf), `${base}.work`));
const jobs = Math.max(1, Number(values.jobs) || Math.min(4, availableParallelism()));

const info = await need('pdfinfo', [pdf], 'poppler をインストールしてください(brew install poppler / apt install poppler-utils)');
const totalPages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
if (!totalPages) fail('PDF のページ数が読み取れません');
const langs = await need('tesseract', ['--list-langs'], 'tesseract をインストールしてください(brew install tesseract tesseract-lang / apt install tesseract-ocr tesseract-ocr-jpn)');
for (const l of lang.split('+')) {
  if (!langs.split('\n').map((s) => s.trim()).includes(l)) fail(`tesseract に言語データ「${l}」がありません(apt install tesseract-ocr-${l.replace(/_/g, '-')} など)`);
}

const first = Math.max(1, Number(values.from) || 1);
const last = Math.min(totalPages, Number(values.to) || totalPages);
await mkdir(work, { recursive: true });

const pageFile = (n: number): string => join(work, `page-${String(n).padStart(4, '0')}.txt`);

async function ocrPage(n: number): Promise<void> {
  if (existsSync(pageFile(n))) return;
  const prefix = join(work, `img-${n}`);
  await run('pdftoppm', ['-r', String(dpi), '-gray', '-png', '-singlefile', '-f', String(n), '-l', String(n), pdf, prefix]);
  const image = `${prefix}.png`;
  try {
    const r = await run('tesseract', [image, 'stdout', '-l', lang, '--psm', values.psm], {
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    await writeFile(pageFile(n), r.stdout);
  } finally {
    await rm(image, { force: true });
  }
}

console.log(`${basename(pdf)}: ${first}〜${last} ページ / 全 ${totalPages} ページ(言語 ${lang}、${dpi}dpi、同時 ${jobs} 件)`);
const queue = Array.from({ length: last - first + 1 }, (_, i) => first + i);
let done = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      await ocrPage(n);
      done++;
      process.stdout.write(`\r  OCR ${done}/${last - first + 1}`);
    }
  }),
);
process.stdout.write('\n');

const pages: string[][] = [];
for (let n = 1; n <= last; n++) pages.push(n < first ? [] : cleanPage(await readFile(pageFile(n), 'utf8')));
const title = values.title ?? base;
const markdown = buildBookMarkdown(title, pages, !values['no-headings']);
await writeFile(out, markdown);
const headings = markdown.split('\n').filter((l) => /^##+ /.test(l)).length;
const empty = pages.slice(first - 1).filter((p) => p.length === 0).length;
console.log(`書き出しました: ${out}${empty > 0 ? `(文字が読み取れなかったページ: ${empty})` : ''}`);
console.log(`見出しを ${headings} 個、自動で付けました(第一章 / 序章 / 漢数字だけの行など。いらないときは --no-headings)`);
console.log('OCR の誤りや見出しの付け間違いは、このファイルをテキストエディタで直せます。アプリの「本を追加」で選んでください。');
