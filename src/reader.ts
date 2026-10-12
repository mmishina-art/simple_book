// 読書画面の DOM 操作。本の文章はすべて textContent で入れる(本ファイルの中身を HTML として扱わない)。
import { type Book, type ReaderSettings, FONT_MAX, FONT_MIN, clampIndex, isDataImage, progressPercent } from './book';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

export interface ReaderHooks {
  /** 読んでいる位置が変わった(スクロールが止まったとき・離れるとき) */
  onPosition(index: number, total: number): void;
  onSettings(settings: ReaderSettings): void;
  onClose(): void;
}

const els: HTMLElement[] = [];
let book: Book | null = null;
let settings: ReaderSettings;
let hooks: ReaderHooks;
let timer = 0;
let lastReported = -1;

const body = (): HTMLElement => $('reader-body');
const bar = (): HTMLElement => document.querySelector<HTMLElement>('.reader-bar') as HTMLElement;

const vertical = (): boolean => settings.direction === 'vertical';

/** いま読んでいる(画面の先頭にある)ブロックの番号。
 *  横書き: 上端から。縦書き: 右端から(縦書きは右から左へ進み、本文の枠の中を横にスクロールする) */
function currentIndex(): number {
  const box = body().getBoundingClientRect();
  const v = vertical();
  const line = v ? box.right - 4 : bar().offsetHeight + 4;
  // 先頭に近い順に並んでいるので、二分探索で「まだ先頭を過ぎていない最初のブロック」を探す
  const passed = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    return v ? r.left >= line : r.bottom <= line;
  };
  let lo = 0;
  let hi = els.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (passed(els[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function scrollToIndex(index: number): void {
  const el = els[clampIndex(index, els.length)];
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (vertical()) {
    // 縦書きの scrollLeft は、右端が 0 で左へ進むほど負になる。ブロックの右端を、枠の右端に合わせる
    body().scrollLeft += r.right - body().getBoundingClientRect().right;
  } else {
    window.scrollTo(0, Math.max(0, r.top + window.scrollY - bar().offsetHeight));
  }
}

function report(): void {
  if (!book) return;
  const index = currentIndex();
  $('reader-progress').textContent = `${progressPercent(index, els.length)}%`;
  if (index !== lastReported) {
    lastReported = index;
    hooks.onPosition(index, els.length);
  }
}

function onScroll(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(report, 250);
  if (book) $('reader-progress').textContent = `${progressPercent(currentIndex(), els.length)}%`;
}

function flush(): void {
  if (book) {
    window.clearTimeout(timer);
    report();
  }
}

export function applySettings(next: ReaderSettings): void {
  settings = next;
  const root = document.documentElement;
  if (next.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = next.theme;
  body().style.setProperty('--reader-size', `${next.fontSize}px`);
  body().dataset.font = next.font;
  $('reader').dataset.direction = next.direction;
  $('font-size').textContent = String(next.fontSize);
  $<HTMLButtonElement>('font-down').disabled = next.fontSize <= FONT_MIN;
  $<HTMLButtonElement>('font-up').disabled = next.fontSize >= FONT_MAX;
  for (const b of document.querySelectorAll<HTMLElement>('[data-direction]')) b.setAttribute('aria-pressed', String(b.dataset.direction === next.direction));
  for (const b of document.querySelectorAll<HTMLElement>('[data-font]')) b.setAttribute('aria-pressed', String(b.dataset.font === next.font));
  for (const b of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === next.theme));
}

/** 設定を変えたあとも、いま読んでいる場所を見失わない */
function change(next: ReaderSettings): void {
  const index = book ? currentIndex() : 0;
  applySettings(next);
  hooks.onSettings(next);
  if (book) scrollToIndex(index);
}

function openDialog(id: string): void {
  $<HTMLDialogElement>(id).showModal();
}

export function setupReader(initial: ReaderSettings, h: ReaderHooks): void {
  hooks = h;
  applySettings(initial);

  window.addEventListener('scroll', onScroll, { passive: true });
  body().addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  $('reader-back').addEventListener('click', () => hooks.onClose());
  $('toc-open').addEventListener('click', () => {
    const list = $('toc-list');
    list.replaceChildren();
    for (const entry of book?.toc ?? []) {
      const li = document.createElement('li');
      li.className = `toc-l${entry.level}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.text;
      button.addEventListener('click', () => {
        $<HTMLDialogElement>('toc-dialog').close();
        scrollToIndex(entry.index);
      });
      li.append(button);
      list.append(li);
    }
    $('toc-empty').hidden = (book?.toc.length ?? 0) > 0;
    openDialog('toc-dialog');
  });
  $('settings-open').addEventListener('click', () => openDialog('settings-dialog'));
  $('font-down').addEventListener('click', () => change({ ...settings, fontSize: settings.fontSize - 2 }));
  $('font-up').addEventListener('click', () => change({ ...settings, fontSize: settings.fontSize + 2 }));
  for (const b of document.querySelectorAll<HTMLElement>('[data-direction]')) {
    b.addEventListener('click', () => change({ ...settings, direction: b.dataset.direction === 'horizontal' ? 'horizontal' : 'vertical' }));
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-font]')) {
    b.addEventListener('click', () => change({ ...settings, font: b.dataset.font === 'sans' ? 'sans' : 'serif' }));
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) {
    const choice = b.dataset.themeChoice;
    if (choice === 'auto' || choice === 'light' || choice === 'dark' || choice === 'sepia') b.addEventListener('click', () => change({ ...settings, theme: choice }));
  }
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.sheet')) {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  }
}

export function showBook(next: Book, startIndex: number): void {
  book = next;
  lastReported = -1;
  els.length = 0;
  $('reader-title').textContent = next.title;
  const frag = document.createDocumentFragment();
  const images: HTMLImageElement[] = [];
  for (const block of next.blocks) {
    let el: HTMLElement;
    if (block.kind === 'image' && block.src && isDataImage(block.src)) {
      // 画像は data: のものだけ(book.ts で検査済み)。説明文は alt に入れる
      el = document.createElement('figure');
      const img = document.createElement('img');
      img.src = block.src;
      img.alt = block.text;
      img.decoding = 'async';
      images.push(img);
      el.append(img);
    } else {
      el = document.createElement(block.kind === 'p' || block.kind === 'page' ? 'p' : block.kind === 'h1' ? 'h2' : block.kind === 'h2' ? 'h3' : 'h4');
      if (block.kind === 'page') {
        el.textContent = block.text; // 「p.」は CSS で付ける(縦書きでは数字だけを、上寄せで小さく出す)
        el.setAttribute('aria-label', `元の本の ${block.text} ページ`);
      } else {
        el.textContent = block.text;
      }
    }
    el.className = `b-${block.kind}`;
    els.push(el);
    frag.append(el);
  }
  body().replaceChildren(frag);
  $('reader').hidden = false;
  $('shelf').hidden = true;
  // レイアウトが決まってから位置を戻す
  scrollToIndex(startIndex);
  $('reader-progress').textContent = `${progressPercent(clampIndex(startIndex, els.length), els.length)}%`;
  body().focus({ preventScroll: true });
  // 画像の大きさが決まると、それより後ろの位置が動く。画像の準備ができたら、読む場所に合わせ直す
  if (images.length > 0) {
    void Promise.allSettled(images.map((img) => img.decode())).then(() => {
      if (book === next && lastReported < 0) scrollToIndex(startIndex);
    });
  }
}

export function hideBook(): void {
  flush();
  book = null;
  els.length = 0;
  body().replaceChildren();
  $('reader').hidden = true;
  $('shelf').hidden = false;
  window.scrollTo(0, 0);
}

export function isReading(): boolean {
  return book !== null;
}
