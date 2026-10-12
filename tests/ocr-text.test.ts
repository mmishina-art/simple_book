import { describe, expect, it } from 'vitest';
import { parseBook } from '../src/book';
import { type OcrLine, type PageContent, buildBookMarkdown, cleanPage, isIllustrationPage, linesToText } from '../src/ocr-text.ts';

describe('cleanPage', () => {
  it('日本語の文字の間のスペースを取り、行をつなぐ', () => {
    expect(cleanPage('吾 輩 は 猫 で あ る 。\n名 前 は ま だ 無 い 。')).toEqual(['吾輩は猫である。名前はまだ無い。']);
  });

  it('空行で段落を分ける', () => {
    expect(cleanPage('一つ目。\n\n二つ目。')).toEqual(['一つ目。', '二つ目。']);
  });

  it('英語の行は、スペースでつなぐ', () => {
    expect(cleanPage('Hello\nworld')).toEqual(['Hello world']);
  });

  it('英語と日本語の間のスペースは保つ', () => {
    expect(cleanPage('これは Apple です')).toEqual(['これは Apple です']);
  });

  it('ページ番号だけ・記号だけの段落と、空のページを捨てる', () => {
    expect(cleanPage('本文。\n\n- 12 -\n\n===')).toEqual(['本文。']);
    expect(cleanPage('  \n\n  ')).toEqual([]);
  });
});

const text = (...pages: string[][]): PageContent[] => pages.map((paragraphs) => ({ paragraphs }));

describe('buildBookMarkdown', () => {
  it('アプリが読める形になる', () => {
    const md = buildBookMarkdown('テスト 本', text(['一頁目。'], [], ['三頁目。', '続き。']));
    const book = parseBook(md);
    expect(book.title).toBe('テスト 本');
    expect(book.blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'h1:テスト 本',
      'page:1',
      'p:一頁目。',
      'page:3',
      'p:三頁目。',
      'p:続き。',
    ]);
  });

  it('行頭の # は見出しにならないよう外す', () => {
    expect(parseBook(buildBookMarkdown('t', text(['# 偽の見出し']))).blocks.at(-1)).toEqual({ kind: 'p', text: '偽の見出し' });
  });
});

describe('見出しの自動検出', () => {
  const headings = (pages: string[][], detect = true): string[] =>
    buildBookMarkdown('t', text(...pages), { detect }).split('\n').filter((l) => /^##+ /.test(l));

  it('第一章・序章・あとがきなどを ## にする', () => {
    expect(headings([['序章'], ['第一章 旅立ち', '本文。'], ['第2部'], ['あとがき']])).toEqual(['## 序章', '## 第一章 旅立ち', '## 第2部', '## あとがき']);
  });

  it('OCR が「第」を落とした「一章 …」も見出しにする', () => {
    expect(headings([['一章朝の散歩']])).toEqual(['## 一章朝の散歩']);
  });

  it('第三話・第十節は ###', () => {
    expect(headings([['第三話'], ['第十節 夜']])).toEqual(['### 第三話', '### 第十節 夜']);
  });

  it('漢数字だけの行は、章がなければ ##、章があれば ###', () => {
    expect(headings([['一', '本文。'], ['二']])).toEqual(['## 一', '## 二']);
    expect(headings([['第一章'], ['一'], ['二']])).toEqual(['## 第一章', '### 一', '### 二']);
  });

  it('本文や文の途中は見出しにしない', () => {
    expect(headings([['第一章では、彼女が旅に出る。'], ['はじめに彼は言った。'], ['一人で歩いた。'], ['第一章 ' + 'あ'.repeat(40)]])).toEqual([]);
  });

  it('detect を切ると、何も付けない', () => {
    expect(headings([['第一章']], false)).toEqual([]);
  });

  it('アプリの目次になる', () => {
    const book = parseBook(buildBookMarkdown('t', text(['第一章 始まり', '本文。'], ['第二章'])));
    expect(book.toc.map((t) => t.text)).toEqual(['第一章 始まり', '第二章']);
  });
});

const IMG = 'data:image/jpeg;base64,/9j/4AAQ';

describe('表紙と挿絵', () => {
  it('表紙・挿絵を入れた本を、アプリが読める', () => {
    const md = buildBookMarkdown('絵のある本', [{ paragraphs: [], image: IMG }, { paragraphs: ['本文です。'] }], { cover: IMG });
    const book = parseBook(md);
    expect(book.cover).toBe(IMG);
    expect(book.blocks.map((b) => b.kind)).toEqual(['h1', 'image', 'page', 'image', 'page', 'p']);
    expect(book.blocks[1]).toMatchObject({ kind: 'image', text: '表紙', src: IMG });
    expect(book.blocks[3]).toMatchObject({ kind: 'image', text: '挿絵 p.1', src: IMG });
  });

  it('data: の画像以外(外部 URL・svg・スクリプト)は画像として読まない', () => {
    const md = '# t\n\n![x](https://example.com/a.png)\n\n![x](data:image/svg+xml;base64,AAAA)\n\n![x](javascript:alert(1))\n\n本文。';
    const book = parseBook(md);
    expect(book.blocks.some((b) => b.kind === 'image')).toBe(false);
    expect(book.cover).toBeUndefined();
  });
});

describe('isIllustrationPage', () => {
  it('文字が少なく、見出しでも白紙でもないページが、画像のページ', () => {
    expect(isIllustrationPage([], false)).toBe(true);
    expect(isIllustrationPage(['ヽ'], false)).toBe(true);
  });

  it('白紙・本文のあるページ・見出しのあるページは画像にしない', () => {
    expect(isIllustrationPage([], true)).toBe(false);
    expect(isIllustrationPage(['これは本文です。'.repeat(10)], false)).toBe(false);
    expect(isIllustrationPage(['第一章'], false)).toBe(false);
  });
});

describe('ページをまたぐ段落のつなぎ', () => {
  const blocks = (pages: string[][]): string[] => parseBook(buildBookMarkdown('t', text(...pages))).blocks.slice(1).map((b) => `${b.kind}:${b.text}`);

  it('文の途中でページが変わったら、段落をつなぎ、ページ番号はつないだ段落のあとに置く', () => {
    expect(blocks([['一つ目の段落。', '二つ目は、ここで切れて'], ['しまった。', '三つ目。']])).toEqual([
      'page:1',
      'p:一つ目の段落。',
      'p:二つ目は、ここで切れてしまった。',
      'page:2',
      'p:三つ目。',
    ]);
  });

  it('文末(。」など)で終わっていれば、つながない', () => {
    expect(blocks([['終わった。'], ['次の段落。']])).toEqual(['page:1', 'p:終わった。', 'page:2', 'p:次の段落。']);
    expect(blocks([['「はい」'], ['次。']])).toEqual(['page:1', 'p:「はい」', 'page:2', 'p:次。']);
  });

  it('次のページが会話(「)で始まるときは、つながない', () => {
    expect(blocks([['彼は言った'], ['「そうか」']])).toEqual(['page:1', 'p:彼は言った', 'page:2', 'p:「そうか」']);
  });

  it('見出しや画像のページをはさむときは、つながない', () => {
    expect(blocks([['途中で終わる'], ['第一章']])).toContain('h2:第一章'.replace('h2', 'h2'));
    const withImage = parseBook(buildBookMarkdown('t', [{ paragraphs: ['途中で終わる'] }, { paragraphs: ['続き。'], image: IMG }])).blocks.map((b) => b.kind);
    expect(withImage).toEqual(['h1', 'page', 'p', 'page', 'image', 'p']);
  });

  it('英語は、スペースでつなぐ', () => {
    expect(blocks([['The quick brown'], ['fox jumps over.']])).toEqual(['page:1', 'p:The quick brown fox jumps over.', 'page:2']);
  });
});

describe('linesToText(行の位置から段落を復元)', () => {
  // 縦書きの 1 ページ(自作の合成画像を OCR した列の位置)。右の列から並ぶ。字下げした列は上端が下がる
  const col = (text: string, x0: number, y0: number, y1: number): OcrLine => ({ text, x0, y0, x1: x0 + 44, y1 });
  const vertical: OcrLine[] = [
    col('甲一', 1404, 317, 1138), // 字下げ → 段落 1 の始まり
    col('甲二。', 1316, 257, 452), // 短く終わる → 段落 1 の終わり
    col('乙一', 1225, 316, 1139), // 字下げ → 段落 2
    col('乙二', 1134, 274, 1139), // 少しのずれ(字下げではない)
    col('乙三。', 1046, 257, 572),
    col('丙一', 954, 318, 1141),
    col('丙二。', 865, 261, 932),
  ];

  it('縦書き: 字下げした列と、短く終わる列で、段落を分ける', () => {
    expect(cleanPage(linesToText(vertical, true))).toEqual(['甲一甲二。', '乙一乙二乙三。', '丙一丙二。']);
  });

  it('縦書き: 列の順番が入れ替わっていても、右から読む', () => {
    expect(cleanPage(linesToText([...vertical].reverse(), true))).toEqual(['甲一甲二。', '乙一乙二乙三。', '丙一丙二。']);
  });

  it('横書き: 左端が右に寄った行と、短く終わる行で、段落を分ける', () => {
    const row = (text: string, x0: number, x1: number, y0: number): OcrLine => ({ text, x0, x1, y0, y1: y0 + 40 });
    const lines = [row('甲一', 140, 1100, 100), row('甲二。', 100, 400, 150), row('乙一', 140, 1100, 200), row('乙二。', 100, 1100, 250)];
    expect(cleanPage(linesToText(lines, false))).toEqual(['甲一甲二。', '乙一乙二。']);
  });

  it('空・1 行だけでも壊れない', () => {
    expect(linesToText([], true)).toBe('');
    expect(cleanPage(linesToText([col('一行だけ。', 100, 50, 500)], true))).toEqual(['一行だけ。']);
  });
});

