// 「PDF を変換」画面の OCR(tesseract.js)に必要なファイルを、public/ocr/ に集める(ビルドと開発サーバーの前に実行)。
// 外部の CDN に頼らず、アプリと同じ場所から配信するため。public/ocr/ は生成物なので、Git には入れない。
//   worker.min.js / core/*.wasm.js : tesseract.js の本体(wasm)
//   lang/*.traineddata.gz          : 日本語(jpn)と縦書き(jpn_vert)の認識データ(best_int: 精度が高く、約 2MB)
//   pdfjs-wasm/*                   : pdf.js が、JPEG2000(JPX)・JBIG2 の画像と ICC 色を復号する部品(自炊 PDF でよく使われる形式。ないと、そのページが白紙になる)
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public/ocr');
const nm = (p) => join(root, 'node_modules', p);

const files = [
  [nm('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map((n) => [nm(`tesseract.js-core/${n}.wasm.js`), `core/${n}.wasm.js`]),
  [nm('@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz'), 'lang/jpn.traineddata.gz'],
  [nm('@tesseract.js-data/jpn_vert/4.0.0_best_int/jpn_vert.traineddata.gz'), 'lang/jpn_vert.traineddata.gz'],
  ...['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js'].map((n) => [nm(`pdfjs-dist/wasm/${n}`), `pdfjs-wasm/${n}`]),
];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`OCR 用のファイルがありません: ${from}(npm ci を実行してください)`);
    process.exit(1);
  }
  mkdirSync(join(out, to, '..'), { recursive: true });
  copyFileSync(from, join(out, to));
}
console.log(`OCR 用のファイルを public/ocr/ に ${files.length} 個コピーしました`);
