// PDF → 本ファイルの変換(ブラウザの中で OCR する)。pdf.js でページを画像にして、tesseract.js で文字にする。
// 重いので、「PDF を変換」画面を開いたときだけ読み込む(main.ts から動的 import)。
// OCR の整形・見出しの検出・本ファイルの組み立ては、パソコン用のコマンドと共通の src/ocr-text.ts。
import { ILLUSTRATION_MAX_CHARS, type PageContent, buildBookMarkdown, cleanPage, isIllustrationPage } from './ocr-text';

export type Direction = 'auto' | 'vertical' | 'horizontal';

export interface ConvertOptions {
  /** 本の向き。auto は、数ページを両方の向きで読んで、確信度の高いほうを選ぶ */
  direction: Direction;
  /** 最初のページを表紙の画像にする */
  cover: boolean;
  /** 文字が少ないページ(挿絵・扉)を画像として残す */
  illustrations: boolean;
  /** 見出しを自動で付ける */
  headings: boolean;
  title: string;
  /** 先頭から何ページまで変換するか(試しに少しだけ変換するとき)。undefined なら全部 */
  maxPages?: number;
  onProgress(p: ConvertProgress): void;
  signal: AbortSignal;
}

export interface ConvertProgress {
  done: number;
  total: number;
  /** 準備中の説明(ページの処理が始まる前)。なければ undefined */
  phase?: string;
  /** 残り時間の目安(秒)。まだわからないときは undefined */
  etaSeconds?: number;
}

export interface ConvertResult {
  markdown: string;
  /** 実際に使った向き(自動判定の結果を含む) */
  vertical: boolean;
  pages: number;
  images: number;
  /** 文字も画像もなく、白紙でもなかったページの数(読み取れなかったページ) */
  empty: number;
}

const OCR_BASE = new URL('ocr/', document.baseURI).href;
/** OCR にかける画像の、長辺のピクセル数 */
const OCR_LONG_SIDE = 2200;
/** 本ファイルに埋め込む画像の、長辺のピクセル数と JPEG の品質 */
const IMAGE_LONG_SIDE = 1400;
const IMAGE_QUALITY = 0.72;

/** ほとんど白一色のページか(縮小して、暗い点の割合を見る) */
export function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const w = 120;
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 170) dark++;
  }
  return dark / (w * h) < 0.004;
}

function toJpegDataUrl(canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, IMAGE_LONG_SIDE / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('画像を作れませんでした');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', IMAGE_QUALITY);
}

/** 同時に動かす OCR の数。スマホは 1、パソコンは CPU の半分(最大 4)。メモリを使うので控えめにする */
export function workerCount(): number {
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile) return 1;
  return Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
}

export async function convertPdf(file: File, o: ConvertOptions): Promise<ConvertResult> {
  const [pdfjs, workerUrl, { createWorker }] = await Promise.all([
    // legacy 版: 新しい JavaScript の機能(Map.prototype.getOrInsertComputed など)がない、古めのブラウザや iPhone の Safari でも動く
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url').then((m) => m.default),
    import('tesseract.js'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // wasmUrl: JPEG2000(JPX)・JBIG2 の画像を復号する部品の場所。指定しないと、そうした画像のページが白紙になる
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: `${OCR_BASE}pdfjs-wasm/` });
  const doc = await task.promise;
  const total = Math.min(doc.numPages, Math.max(1, o.maxPages ?? doc.numPages));
  // 縦書きは「1 つの縦書きのかたまり」(5)、横書きは「1 段組み」(4)が最も正確(実測。3 は縦書きの先頭の列を落とす)
  const makeWorker = async (vertical: boolean) => {
    const w = await createWorker(vertical ? 'jpn_vert' : 'jpn', 1, {
      workerPath: `${OCR_BASE}worker.min.js`,
      corePath: `${OCR_BASE}core`,
      langPath: `${OCR_BASE}lang`,
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
    });
    await w.setParameters({ tessedit_pageseg_mode: (vertical ? '5' : '4') as never });
    return w;
  };
  const aborted = (): void => {
    if (o.signal.aborted) throw new DOMException('中止しました', 'AbortError');
  };

  const renderPage = async (n: number): Promise<HTMLCanvasElement> => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(5, OCR_LONG_SIDE / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    return canvas;
  };

  // 向きの自動判定: 本の全体から散らした数ページ(表紙と白紙は除く)を、横書き用と縦書き用の両方で読み、確信度の高いほうにする。
  // 表紙・扉の題字(文字が少ない)に引きずられないよう、読めた文字数で重みを付ける
  let vertical = o.direction === 'vertical';
  if (o.direction === 'auto') {
    o.onProgress({ done: 0, total, phase: '本の向きを調べています' });
    const first = o.cover ? 2 : 1;
    const samples = [...new Set(Array.from({ length: 4 }, (_, k) => Math.round(first + (k * (total - first)) / 3)))].filter((n) => n >= first && n <= total);
    const [h, v] = await Promise.all([makeWorker(false), makeWorker(true)]);
    try {
      const score = { h: 0, v: 0 };
      for (const n of samples) {
        aborted();
        const canvas = await renderPage(n);
        if (!isBlankCanvas(canvas)) {
          const [rh, rv] = await Promise.all([h.recognize(canvas), v.recognize(canvas)]);
          // 点数 = 確信度 × そのモデルが読んだ文字数。向きの合わないモデルは、少しの文字を高い確信度で読むことがあるので、文字数で重みを付ける
          score.h += rh.data.confidence * rh.data.text.replace(/\s/g, '').length;
          score.v += rv.data.confidence * rv.data.text.replace(/\s/g, '').length;
        }
        canvas.width = canvas.height = 0;
      }
      // 差がないときは縦書き(小説に多い)
      vertical = score.v >= score.h;
    } finally {
      await Promise.allSettled([h.terminate(), v.terminate()]);
    }
  }

  const workers = await Promise.all(Array.from({ length: Math.min(workerCount(), total) }, () => makeWorker(vertical)));

  const pages: PageContent[] = Array.from({ length: total }, () => ({ paragraphs: [] }));
  let cover: string | undefined;
  let images = 0;
  const blanks = new Set<number>();
  let done = 0;
  let next = 1;
  const started = performance.now();
  o.onProgress({ done: 0, total });

  const work = async (worker: (typeof workers)[number]): Promise<void> => {
    for (;;) {
      aborted();
      const n = next++;
      if (n > total) return;
      const canvas = await renderPage(n);

      if (n === 1 && o.cover) {
        // 最初のページは表紙の画像にする(表紙の文字は読まない)
        cover = toJpegDataUrl(canvas);
      } else if (isBlankCanvas(canvas)) {
        blanks.add(n - 1);
      } else {
        const { data } = await worker.recognize(canvas);
        const paragraphs = cleanPage(data.text);
        if (o.illustrations && isIllustrationPage(paragraphs, false)) {
          pages[n - 1] = { paragraphs, image: toJpegDataUrl(canvas) };
          images++;
        } else {
          pages[n - 1] = { paragraphs };
        }
      }
      canvas.width = canvas.height = 0; // メモリを早く手放す
      done++;
      const elapsed = (performance.now() - started) / 1000;
      o.onProgress({ done, total, etaSeconds: done >= 2 ? Math.round((elapsed / done) * (total - done)) : undefined });
    }
  };

  try {
    await Promise.all(workers.map(work));
    aborted();
  } finally {
    await Promise.allSettled(workers.map((w) => w.terminate()));
    void task.destroy();
  }

  // 文字を読み取れたページが、ほとんどないとき: 本にせず、原因を伝える(画像だらけの本ができてしまうのを防ぐ)
  const attempted = total - (cover ? 1 : 0);
  if (attempted === 0) throw new Error('本文にするページがありません(1 ページ目を表紙にしたためです)。「1 ページ目を表紙の画像にする」を外すか、ページ数を増やしてください。');
  const textPages = pages.filter((p) => p.paragraphs.join('').length >= ILLUSTRATION_MAX_CHARS).length;
  if (attempted > 0 && textPages / attempted < 0.1) {
    const stats = `(${attempted} ページ中、文字を読み取れたページ ${textPages}、白紙と判断したページ ${blanks.size})`;
    throw new Error(
      blanks.size / attempted >= 0.8
        ? `ページの画像を読み取れませんでした${stats}。この PDF の画像の形式に、まだ対応していない可能性があります。`
        : `文字を読み取れませんでした${stats}。「本の向き」を変えて、先頭の数ページだけ試してみてください。`,
    );
  }

  const markdown = buildBookMarkdown(o.title, pages, { detect: o.headings, cover });
  return {
    markdown,
    vertical,
    pages: total,
    images: images + (cover ? 1 : 0),
    empty: pages.filter((p, i) => p.paragraphs.length === 0 && !p.image && !blanks.has(i) && !(i === 0 && cover)).length,
  };
}
