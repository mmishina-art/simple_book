import './style.css';
import { type Book, MAX_BOOK_BYTES, bookId, clampIndex, normalizeSettings, parseBook, progressPercent } from './book';
import { type BookSummary, deleteBook, getBook, listBooks, putBook } from './library';
import { setupConvert } from './convert-ui';
import { setupInstallGuide } from './install';
import { setupUpdateBanner } from './pwa';
import { applySettings, hideBook, isReading, setupReader, showBook } from './reader';
import { exportBackup, importBackup, load, migrateStorage, requestPersist, save } from './storage';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

migrateStorage();

// ---- しおり(本ごとの、読んだ位置) ----
interface Position {
  i: number;
  n: number;
}
const positions = (): Record<string, Position> => load<Record<string, Position>>('pos', {});
function savePosition(id: string, i: number, n: number): void {
  save('pos', { ...positions(), [id]: { i, n } });
}

// 本棚に出す表紙は、小さくしたものを保管庫に入れておく(本棚を開くたびに大きな画像を読まないため)
async function makeThumbnail(src: string): Promise<string | undefined> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const h = 160;
    const w = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(w, 160);
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    // 表紙の上下左右を切らず、枠いっぱいに入れる(cover の表示で縁が切れるのは CSS 側)
    ctx.drawImage(img, 0, 0, canvas.width, h);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

// ---- 本棚 ----
async function renderShelf(): Promise<void> {
  const list = $('book-list');
  let books: BookSummary[];
  try {
    books = await listBooks();
  } catch {
    $('import-message').textContent = '本の保管庫を開けませんでした(プライベートブラウズでは使えないことがあります)';
    books = [];
  }
  const pos = positions();
  list.replaceChildren();
  for (const b of books) {
    const li = document.createElement('li');
    if (b.cover) {
      const img = document.createElement('img');
      img.className = 'cover';
      img.src = b.cover;
      img.alt = '';
      li.append(img);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'book-open';
    const title = document.createElement('span');
    title.className = 'book-title';
    title.textContent = b.title;
    const meta = document.createElement('small');
    const p = pos[b.id];
    meta.textContent = p ? (p.i === 0 ? '未読' : `${progressPercent(p.i, p.n)}% まで読んだ`) : '未読';
    open.append(title, meta);
    open.addEventListener('click', () => void openBook(b.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'book-delete';
    del.textContent = '削除';
    del.setAttribute('aria-label', `「${b.title}」を削除`);
    del.addEventListener('click', () => void removeBook(b.id, b.title));
    li.append(open, del);
    list.append(li);
  }
  $('empty-message').hidden = books.length > 0;
}

async function removeBook(id: string, title: string): Promise<void> {
  if (!window.confirm(`「${title}」を削除しますか?\n(本ファイルが手元に残っていれば、また取り込めます)`)) return;
  await deleteBook(id);
  const { [id]: _removed, ...rest } = positions();
  void _removed;
  save('pos', rest);
  await renderShelf();
}

/** 本ファイルの中身を、保管庫に入れる(おかしい中身は例外で止める)。同じ本は上書きされ、しおりが引き継がれる */
async function addBookText(text: string, fileName: string): Promise<void> {
  const book = parseBook(text, fileName);
  await putBook({ id: bookId(text), title: book.title, text, addedAt: Date.now(), cover: book.cover ? await makeThumbnail(book.cover) : undefined });
}

async function importFiles(files: FileList): Promise<void> {
  const message = $('import-message');
  const notes: string[] = [];
  let added = 0;
  for (const file of Array.from(files)) {
    try {
      if (file.size > MAX_BOOK_BYTES) throw new Error('大きすぎます(30MB まで)');
      await addBookText(await file.text(), file.name);
      added++;
    } catch (err) {
      notes.push(`${file.name}: ${err instanceof Error ? err.message : '読み込めませんでした'}`);
    }
  }
  message.textContent = [added > 0 ? `${added} 冊を追加しました` : '', ...notes].filter(Boolean).join(' / ');
  await renderShelf();
}

// ---- 読書 ----
let currentId = '';
let settings = normalizeSettings(load('settings', null));

async function openBook(id: string): Promise<void> {
  const stored = await getBook(id);
  if (!stored) return;
  let book: Book;
  try {
    book = parseBook(stored.text, stored.title);
  } catch {
    $('import-message').textContent = 'この本は開けませんでした';
    return;
  }
  currentId = id;
  history.pushState({ reading: true }, '');
  showBook(book, clampIndex(positions()[id]?.i, book.blocks.length));
}

function closeBook(): void {
  if (!isReading()) return;
  hideBook();
  currentId = '';
  void renderShelf();
}

setupReader(settings, {
  onPosition: (i, n) => {
    if (currentId) savePosition(currentId, i, n);
  },
  onSettings: (next) => {
    settings = next;
    save('settings', next);
  },
  // 画面の「もどる」と、端末の戻る操作は、同じ履歴を使う
  onClose: () => history.back(),
});
window.addEventListener('popstate', closeBook);

// ---- 取り込み・バックアップ ----
$<HTMLInputElement>('book-import').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) void importFiles(input.files).finally(() => (input.value = ''));
});

$('backup-export').addEventListener('click', () => {
  const blob = new Blob([exportBackup()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${__APP_ID__}-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$<HTMLInputElement>('backup-import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const message = $('backup-message');
  try {
    const n = importBackup(await file.text());
    settings = normalizeSettings(load('settings', null));
    applySettings(settings);
    message.textContent = `${n} 件の記録を読み込みました`;
    await renderShelf();
  } catch (err) {
    message.textContent = err instanceof Error ? err.message : '読み込めませんでした';
  }
  input.value = '';
});

setupConvert(async (markdown, fileName) => {
  await addBookText(markdown, fileName);
  await renderShelf();
});

$('version').textContent = __APP_VERSION__;
requestPersist();
setupUpdateBanner($('update-banner'), $('update-button'));
setupInstallGuide($<HTMLButtonElement>('install-open'), $<HTMLDialogElement>('install-dialog'), $<HTMLButtonElement>('install-now'));
void renderShelf();

// ここまで来たら起動成功(public/boot.js が見ている)
window.__appStarted = true;
