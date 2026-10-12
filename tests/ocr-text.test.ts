import { describe, expect, it } from 'vitest';
import { parseBook } from '../src/book';
import { buildBookMarkdown, cleanPage } from '../scripts/ocr-text.ts';

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

describe('buildBookMarkdown', () => {
  it('アプリが読める形になる', () => {
    const md = buildBookMarkdown('テスト 本', [['一頁目。'], [], ['三頁目。', '続き。']]);
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
    expect(parseBook(buildBookMarkdown('t', [['# 偽の見出し']])).blocks.at(-1)).toEqual({ kind: 'p', text: '偽の見出し' });
  });
});

describe('見出しの自動検出', () => {
  const headings = (pages: string[][], detect = true): string[] =>
    buildBookMarkdown('t', pages, detect).split('\n').filter((l) => /^##+ /.test(l));

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
    const book = parseBook(buildBookMarkdown('t', [['第一章 始まり', '本文。'], ['第二章']]));
    expect(book.toc.map((t) => t.text)).toEqual(['第一章 始まり', '第二章']);
  });
});

