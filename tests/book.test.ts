import { describe, expect, it } from 'vitest';
import { bookId, clampIndex, normalizeSettings, parseBook, progressPercent } from '../src/book';

const SAMPLE = `# 吾輩は猫である

<!-- page 1 -->

## 一

吾輩は猫である。
名前はまだ無い。

どこで生れたかとんと見当がつかぬ。

### 二のはじめ

本文その二。
`;

describe('parseBook', () => {
  it('書名・見出し・段落・ページ区切りに分ける', () => {
    const book = parseBook(SAMPLE);
    expect(book.title).toBe('吾輩は猫である');
    expect(book.blocks.map((b) => b.kind)).toEqual(['h1', 'page', 'h2', 'p', 'p', 'h3', 'p']);
    expect(book.blocks[3].text).toBe('吾輩は猫である。\n名前はまだ無い。');
    expect(book.blocks[1].text).toBe('1');
  });

  it('目次は ## と ### だけ(ブロック番号つき)', () => {
    expect(parseBook(SAMPLE).toc).toEqual([
      { index: 2, level: 2, text: '一' },
      { index: 5, level: 3, text: '二のはじめ' },
    ]);
  });

  it('書名の行がなければファイル名を使う', () => {
    expect(parseBook('本文だけ', 'メモ.txt').title).toBe('メモ');
  });

  it('BOM と CRLF を受け付ける', () => {
    const book = parseBook('﻿# 題\r\n\r\n一行目\r\n二行目\r\n');
    expect(book.blocks[1].text).toBe('一行目\n二行目');
  });

  it('本文がないファイルは理由つきで断る', () => {
    expect(() => parseBook('# 題だけ')).toThrow('本文が見つかりません');
    expect(() => parseBook('')).toThrow('本文が見つかりません');
  });

  it('タグのような文字もそのまま文字として持つ', () => {
    expect(parseBook('<b>強い</b>').blocks[0].text).toBe('<b>強い</b>');
  });
});

describe('bookId', () => {
  it('同じ中身なら同じ ID、違えば別の ID', () => {
    expect(bookId('あ')).toBe(bookId('あ'));
    expect(bookId('あ')).not.toBe(bookId('い'));
  });
});

describe('progressPercent / clampIndex', () => {
  it('進み具合は 0〜100', () => {
    expect(progressPercent(0, 11)).toBe(0);
    expect(progressPercent(5, 11)).toBe(50);
    expect(progressPercent(99, 11)).toBe(100);
    expect(progressPercent(3, 1)).toBe(0);
  });

  it('位置を範囲内に収める', () => {
    expect(clampIndex(500, 10)).toBe(9);
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex('x', 10)).toBe(0);
    expect(clampIndex(4.7, 10)).toBe(4);
  });
});

describe('normalizeSettings', () => {
  it('壊れた設定は既定値に戻す', () => {
    expect(normalizeSettings(null)).toEqual({ fontSize: 18, theme: 'auto', font: 'serif', direction: 'vertical' });
    expect(normalizeSettings({ fontSize: 999, theme: 'neon', font: 'x' })).toEqual({ fontSize: 32, theme: 'auto', font: 'serif', direction: 'vertical' });
  });

  it('正しい設定は保つ', () => {
    expect(normalizeSettings({ fontSize: 22, theme: 'sepia', font: 'sans', direction: 'horizontal' })).toEqual({ fontSize: 22, theme: 'sepia', font: 'sans', direction: 'horizontal' });
  });
});
