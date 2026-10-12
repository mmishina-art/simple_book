// 本ファイル(簡易 Markdown)の読み取り。DOM に触れない純関数にして、tests/ で単体テストする。
//
// 本ファイルの形式:
//   # 書名            ← 最初の「# 」の行が書名
//   ## 第1章          ← 「## 」「### 」は見出し(目次になる)
//   <!-- page 12 -->  ← 元の本のページ区切り(目印として薄く表示)
//   本文…             ← 空行で区切ったかたまりが段落

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'page';

export interface Block {
  kind: BlockKind;
  text: string;
}

export interface TocEntry {
  index: number;
  level: 2 | 3;
  text: string;
}

export interface Book {
  title: string;
  blocks: Block[];
  toc: TocEntry[];
}

/** 取り込める本ファイルの大きさの上限(バイト)。文庫本数十冊ぶんでも 1 冊は 10MB に届かない */
export const MAX_BOOK_BYTES = 30 * 1024 * 1024;

const PAGE_RE = /^<!--\s*page\s*:?\s*(\S+?)\s*-->$/i;

export function parseBook(source: string, fileName = ''): Book {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) blocks.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const page = PAGE_RE.exec(line);
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (line === '') {
      flush();
    } else if (page) {
      flush();
      blocks.push({ kind: 'page', text: page[1] });
    } else if (heading) {
      flush();
      blocks.push({ kind: (`h${heading[1].length}`) as BlockKind, text: heading[2].trim() });
    } else {
      para.push(line);
    }
  }
  flush();

  if (!blocks.some((b) => b.kind === 'p')) throw new Error('本文が見つかりません。書名・見出し・本文を書いたテキスト(.md / .txt)を選んでください');

  const h1 = blocks.find((b) => b.kind === 'h1');
  const title = h1?.text || fileName.replace(/\.[^.]+$/, '') || '無題';
  const toc: TocEntry[] = [];
  blocks.forEach((b, index) => {
    if (b.kind === 'h2' || b.kind === 'h3') toc.push({ index, level: b.kind === 'h2' ? 2 : 3, text: b.text });
  });
  return { title, blocks, toc };
}

/** 本の中身から ID を作る(同じ本を取り込み直しても、しおりが引き継がれる)。FNV-1a(32bit) を 2 通り。 */
export function bookId(source: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}-${source.length}`;
}

/** 読んだ位置(ブロック番号)から、進み具合(0〜100 の整数)にする */
export function progressPercent(index: number, total: number): number {
  if (total <= 1) return 0;
  return Math.round((Math.min(Math.max(index, 0), total - 1) / (total - 1)) * 100);
}

/** 位置を、ブロック数の範囲に収める(保存した位置が、差し替えた本より後ろのときなど) */
export function clampIndex(index: unknown, total: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.floor(index), 0), Math.max(total - 1, 0));
}

// ---- 読書の設定 ----

export type ThemeName = 'auto' | 'light' | 'dark' | 'sepia';
export type FontName = 'serif' | 'sans';

export interface ReaderSettings {
  fontSize: number;
  theme: ThemeName;
  font: FontName;
}

export const FONT_MIN = 14;
export const FONT_MAX = 32;
export const DEFAULT_SETTINGS: ReaderSettings = { fontSize: 18, theme: 'auto', font: 'serif' };

export function normalizeSettings(raw: unknown): ReaderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReaderSettings>;
  const size = typeof r.fontSize === 'number' && Number.isFinite(r.fontSize) ? Math.round(r.fontSize) : DEFAULT_SETTINGS.fontSize;
  return {
    fontSize: Math.min(Math.max(size, FONT_MIN), FONT_MAX),
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'sepia' ? r.theme : 'auto',
    font: r.font === 'sans' ? 'sans' : 'serif',
  };
}
