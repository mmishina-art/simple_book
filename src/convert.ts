// PDF → 本ファイルの変換(ブラウザの中で OCR する)。pdf.js でページを画像にして、tesseract.js で文字にする。
// 重いので、「PDF を変換」画面を開いたときだけ読み込む(main.ts から動的 import)。
// OCR の整形・見出しの検出・本ファイルの組み立ては、パソコン用のコマンドと共通の src/ocr-text.ts。
import { type PageContent, buildBookMarkdown, cleanPage, isIllustrationPage } from './ocr-text';

export interface ConvertOptions {
  /** 縦書きの本(jpn_vert) */
  vertical: boolean;
  /** 最初のページを表紙の画像にする */
  cover: boolean;
  /** 文字が少ないページ(挿絵・扉)を画像として残す */
  illustrations: boolean;
  /** 見出しを自動で付ける */
  headings: boolean;
  title: string;
  onProgress(p: ConvertProgress): void;
  signal: AbortSignal;
}

export interface ConvertProgress {
  done: number;
  total: number;
  /** 残り時間の目安(秒)。まだわからないときは undefined */
  etaSeconds?: number;
}

export interface ConvertResult {
  markdown: string;
  pages: number;
  images: number;
  /** 文字も画像もなかったページの数 */
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
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
    import('tesseract.js'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = doc.numPages;
  const lang = o.vertical ? 'jpn_vert' : 'jpn';
  // 縦書きは「1 つの縦書きのかたまり」(5)、横書きは「1 段組み」(4)が最も正確(実測。3 は縦書きの先頭の列を落とす)
  const psm = o.vertical ? '5' : '4';

  const workers = await Promise.all(
    Array.from({ length: Math.min(workerCount(), total) }, async () => {
      const w = await createWorker(lang, 1, {
        workerPath: `${OCR_BASE}worker.min.js`,
        corePath: `${OCR_BASE}core`,
        langPath: `${OCR_BASE}lang`,
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: psm as never });
      return w;
    }),
  );

  const pages: PageContent[] = Array.from({ length: total }, () => ({ paragraphs: [] }));
  let cover: string | undefined;
  let images = 0;
  let done = 0;
  let next = 1;
  const started = performance.now();
  const aborted = (): void => {
    if (o.signal.aborted) throw new DOMException('中止しました', 'AbortError');
  };
  o.onProgress({ done: 0, total });

  const work = async (worker: (typeof workers)[number]): Promise<void> => {
    for (;;) {
      aborted();
      const n = next++;
      if (n > total) return;
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(5, OCR_LONG_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();

      if (n === 1 && o.cover) {
        // 最初のページは表紙の画像にする(表紙の文字は読まない)
        cover = toJpegDataUrl(canvas);
      } else if (isBlankCanvas(canvas)) {
        // 白紙
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

  const markdown = buildBookMarkdown(o.title, pages, { detect: o.headings, cover });
  return {
    markdown,
    pages: total,
    images: images + (cover ? 1 : 0),
    empty: pages.filter((p, i) => p.paragraphs.length === 0 && !p.image && !(i === 0 && cover)).length,
  };
}
