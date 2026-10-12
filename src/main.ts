import './style.css';
import { type Book, MAX_BOOK_BYTES, bookId, clampIndex, normalizeSettings, parseBook, progressPercent } from './book';
import { type BookSummary, deleteBook, getBook, listBooks, putBook } from './library';
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

async function importFiles(files: FileList): Promise<void> {
  const message = $('import-message');
  const notes: string[] = [];
  let added = 0;
  for (const file of Array.from(files)) {
    try {
      if (file.size > MAX_BOOK_BYTES) throw new Error('大きすぎます(30MB まで)');
      const text = await file.text();
      const book = parseBook(text, file.name);
      await putBook({ id: bookId(text), title: book.title, text, addedAt: Date.now() });
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

$('version').textContent = __APP_VERSION__;
requestPersist();
setupUpdateBanner($('update-banner'), $('update-button'));
setupInstallGuide($<HTMLButtonElement>('install-open'), $<HTMLDialogElement>('install-dialog'), $<HTMLButtonElement>('install-now'));
void renderShelf();

// ここまで来たら起動成功(public/boot.js が見ている)
window.__appStarted = true;
