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

/** 書名とページごとの段落から、本ファイル(簡易 Markdown。形式は src/book.ts)を作る */
export function buildBookMarkdown(title: string, pages: string[][]): string {
  const out: string[] = [`# ${title.replace(/\s+/g, ' ').trim() || '無題'}`];
  pages.forEach((paragraphs, i) => {
    if (paragraphs.length === 0) return;
    out.push(`<!-- page ${i + 1} -->`);
    // 行頭が # の段落は、見出しと取り違えられないよう目印を外す
    for (const p of paragraphs) out.push(p.replace(/^#+\s*/, ''));
  });
  return out.join('\n\n') + '\n';
}
