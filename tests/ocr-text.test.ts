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
