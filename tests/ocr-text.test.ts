import { describe, expect, it } from 'vitest';
import { parseBook } from '../src/book';
import { type PageContent, buildBookMarkdown, cleanPage, isIllustrationPage } from '../src/ocr-text.ts';

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
