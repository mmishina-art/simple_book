// OCR の生の出力を、スマホで読みやすい文章に整える。DOM にも外部コマンドにも触れない純関数(tests/ocr-text.test.ts でテスト)。

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

/** 書名とページごとの段落から、本ファイル(簡易 Markdown。形式は src/book.ts)を作る。detect が true なら、見出しを自動で付ける */
export function buildBookMarkdown(title: string, pages: string[][], detect = true): string {
  const kinds = detect ? pages.map((paragraphs) => paragraphs.map(headingKind)) : [];
  // 「第一章」のような大きな区切りがある本では、漢数字だけの行はその下の小見出し(###)。なければ章(##)。
  const hasBig = kinds.some((row) => row.includes('big'));
  const out: string[] = [`# ${title.replace(/\s+/g, ' ').trim() || '無題'}`];
  pages.forEach((paragraphs, i) => {
    if (paragraphs.length === 0) return;
    out.push(`<!-- page ${i + 1} -->`);
    paragraphs.forEach((p, j) => {
      // 行頭が # の段落は、見出しと取り違えられないよう目印を外す
      const text = p.replace(/^#+\s*/, '');
      const kind = kinds[i]?.[j] ?? null;
      const level = kind === 'big' ? '##' : kind === 'small' ? '###' : kind === 'number' ? (hasBig ? '###' : '##') : '';
      out.push(level ? `${level} ${text}` : text);
    });
  });
  return out.join('\n\n') + '\n';
}
