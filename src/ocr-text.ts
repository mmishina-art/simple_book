// OCR の生の出力を、スマホで読みやすい文章に整える。DOM にも外部コマンドにも触れない純関数(tests/ocr-text.test.ts でテスト)。
// ブラウザの「PDF を変換」画面(src/convert.ts)と、パソコンのコマンド(scripts/pdf2book.ts)の両方が使う。

// 日本語の文字(ひらがな・カタカナ・漢字・全角記号など)。Tesseract は文字の間に半角スペースを入れがちなので、その除去に使う
const CJK = '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';
const SPACE_BETWEEN_CJK = new RegExp(`([${CJK}]) +(?=[${CJK}])`, 'g');
const ENDS_WITH_CJK = new RegExp(`[${CJK}]$`);
const STARTS_WITH_CJK = new RegExp(`^[${CJK}]`);
const PAGE_NUMBER_ONLY = /^[-—– ]*\d{1,4}[-—– ]*$/;

/** 1 ページぶんの OCR 結果を、段落の配列にする(空のページは空配列) */
export function cleanPage(raw: string): string[] {
  const paragraphs: string[] = [];
  for (const chunk of raw.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let joined = '';
    for (const line of chunk.split('\n')) {
      const text = line.trim().replace(SPACE_BETWEEN_CJK, '$1');
      if (text === '') continue;
      if (joined === '') joined = text;
      else joined += ENDS_WITH_CJK.test(joined) || STARTS_WITH_CJK.test(text) ? text : ` ${text}`;
    }
    // 本文として読めない短い記号や、ページ番号だけの段落は捨てる
    if (joined !== '' && !PAGE_NUMBER_ONLY.test(joined) && !/^[\p{P}\p{S}\s]+$/u.test(joined)) paragraphs.push(joined);
  }
  return paragraphs;
}

// ---- 行(縦書きでは列)の位置から、段落を復元する ----
// 縦書き用の OCR(psm 5)は、段落の切れ目を出さない。そこで、各行の位置から推定する:
//  ・行頭が字下げされている行は、新しい段落の始まり(縦書きは列の上端が下がる、横書きは左端が右に寄る)
//  ・行の終わりが短い(ページの端まで届かない)行は、段落の終わり
export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const median = (xs: number[]): number => percentile([...xs].sort((a, b) => a - b), 0.5);

/** 行の並びを、段落を空行で区切った文字列にする(cleanPage に渡す形)。縦書きは右の列から、横書きは上の行から読む。 */
export function linesToText(lines: OcrLine[], vertical: boolean): string {
  const rows = lines.filter((l) => l.text.trim() !== '');
  if (rows.length === 0) return '';
  // 読む順に並べる
  rows.sort(vertical ? (a, b) => b.x0 + b.x1 - (a.x0 + a.x1) : (a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const start = (l: OcrLine): number => (vertical ? l.y0 : l.x0); // 行の頭の位置
  const end = (l: OcrLine): number => (vertical ? l.y1 : l.x1); // 行の終わりの位置
  const size = median(rows.map((l) => (vertical ? l.x1 - l.x0 : l.y1 - l.y0))); // 1 字の大きさ(列の幅・行の高さ)
  const heads = rows.map(start).sort((a, b) => a - b);
  const ends = rows.map(end).sort((a, b) => a - b);
  const head = percentile(heads, 0.15); // ふつうの行の頭の位置(字下げのない行)
  const tail = percentile(ends, 0.85); // ふつうの行の終わりの位置(ページの端まで届く行)

  const paragraphs: string[][] = [];
  rows.forEach((l, i) => {
    const indented = start(l) > head + size * 0.5;
    const previousShort = i > 0 && end(rows[i - 1]) < tail - size * 1.5;
    if (i === 0 || indented || previousShort) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(l.text.trim());
  });
  return paragraphs.map((p) => p.join('\n')).join('\n\n');
}

// ---- 見出しの自動検出 ----
// 小説の見出しは短く、決まった形が多い。文の途中や本文を見出しにしないよう、「全体がその形」で「文末の記号がない」ものだけを選ぶ。
const NUM = '[一二三四五六七八九十百千〇零0-9０-９]+';
// 章・部など大きな区切り(例: 第一章 / 第2部 旅立ち / 序章 / あとがき。OCR が「第」を落とした「一章」も拾う)
const BIG = new RegExp(`^(第${NUM}[章部編巻]|${NUM}章|序章|終章|序|跋|プロローグ|エピローグ|はじめに|おわりに|あとがき|後書き|解説)([ \u3000]*[^。、！？!?「」]{0,24})?$`);
// 小さな区切り(例: 第三話 / 第十節)
const SMALL = new RegExp(`^第${NUM}[節話回幕]([ \u3000]*[^。、！？!?「」]{0,24})?$`);
// 漢数字だけの行(章番号。例: 一 / 十二)
const BARE_NUMBER = /^[一二三四五六七八九十百]{1,4}$/;

function headingKind(p: string): 'big' | 'small' | 'number' | null {
  if (p.length > 30) return null;
  if (BIG.test(p)) return 'big';
  if (SMALL.test(p)) return 'small';
  if (BARE_NUMBER.test(p)) return 'number';
  return null;
}

/** 変換したページ1枚ぶん。image があれば、本文の代わりに(または本文に加えて)その画像を入れる */
export interface PageContent {
  paragraphs: string[];
  /** 挿絵・扉絵などの画像(data: URL) */
  image?: string;
}

/** 画像のページにするかの判定: OCR の文字が少なく(表紙・扉・挿絵)、見出しでもなく、白紙でもない */
export const ILLUSTRATION_MAX_CHARS = 30;
export function isIllustrationPage(paragraphs: string[], blank: boolean): boolean {
  if (blank) return false;
  if (paragraphs.some((p) => headingKind(p) !== null)) return false;
  return paragraphs.join('').length < ILLUSTRATION_MAX_CHARS;
}

export interface BuildOptions {
  /** 見出しを自動で付ける(既定 true) */
  detect?: boolean;
  /** 表紙の画像(data: URL)。書名の下に入れる */
  cover?: string;
}

// ---- ページをまたぐ段落のつなぎ ----
// 文の途中でページが変わると、OCR はそこで段落を切ってしまう。前のページの最後の段落が文の途中で終わっていれば、
// 次のページの最初の段落をつなぐ(ページ番号の目印は、つないだ段落のあとに置く)。
const SENTENCE_END = /[。．.！？!?」』）)〉》】〕”’…―]$/;
const DIALOGUE_START = /^[「『（(〈《【〔“‘]/;

function joinText(a: string, b: string): string {
  return ENDS_WITH_CJK.test(a) || STARTS_WITH_CJK.test(b) ? a + b : `${a} ${b}`;
}

type Item = { type: 'page'; n: number } | { type: 'image'; src: string; n: number } | { type: 'p'; text: string; level: string };

/** 書名とページごとの内容から、本ファイル(簡易 Markdown。形式は src/book.ts)を作る */
export function buildBookMarkdown(title: string, pages: PageContent[], options: BuildOptions = {}): string {
  const detect = options.detect ?? true;
  const kinds = detect ? pages.map((page) => page.paragraphs.map(headingKind)) : [];
  // 「第一章」のような大きな区切りがある本では、漢数字だけの行はその下の小見出し(###)。なければ章(##)。
  const hasBig = kinds.some((row) => row.includes('big'));
  const levelOf = (kind: ReturnType<typeof headingKind> | undefined): string =>
    kind === 'big' ? '##' : kind === 'small' ? '###' : kind === 'number' ? (hasBig ? '###' : '##') : '';

  const items: Item[] = [];
  let last: { type: 'p'; text: string; level: string } | undefined; // 直前のページの、最後の段落
  pages.forEach((page, i) => {
    if (page.paragraphs.length === 0 && !page.image) return;
    const paragraphs = page.paragraphs.map((p) => p.replace(/^#+\s*/, '')); // 行頭が # の段落は、見出しと取り違えられないよう目印を外す
    let from = 0;
    const first = paragraphs[0];
    const mergeable =
      last && !last.level && !page.image && first !== undefined && !levelOf(kinds[i]?.[0]) && !SENTENCE_END.test(last.text) && !DIALOGUE_START.test(first);
    if (last && mergeable) {
      last.text = joinText(last.text, first);
      from = 1;
    }
    items.push({ type: 'page', n: i + 1 });
    if (page.image) items.push({ type: 'image', src: page.image, n: i + 1 });
    for (let j = from; j < paragraphs.length; j++) {
      const item = { type: 'p' as const, text: paragraphs[j], level: levelOf(kinds[i]?.[j]) };
      items.push(item);
      last = item;
    }
    if (page.image || paragraphs.length === from) last = undefined; // 画像だけのページをはさむ・段落がないときは、つながない
  });

  const out: string[] = [`# ${title.replace(/\s+/g, ' ').trim() || '無題'}`];
  if (options.cover) out.push(`<!-- cover: ${options.cover} -->`);
  for (const item of items) {
    if (item.type === 'page') out.push(`<!-- page ${item.n} -->`);
    else if (item.type === 'image') out.push(`![挿絵 p.${item.n}](${item.src})`);
    else out.push(item.level ? `${item.level} ${item.text}` : item.text);
  }
  return out.join('\n\n') + '\n';
}
