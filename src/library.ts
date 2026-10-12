// 取り込んだ本の保管庫(IndexedDB)。本の文章は大きい(localStorage は 5MB ほどで足りない)ので、こちらに入れる。
// しおりや設定は小さいので src/storage.ts(localStorage)。

const DB_NAME = __APP_ID__;
const STORE = 'books';

export interface StoredBook {
  id: string;
  title: string;
  /** 本ファイルの中身(簡易 Markdown) */
  text: string;
  addedAt: number;
}

export type BookSummary = Omit<StoredBook, 'text'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('本の保管庫を開けませんでした'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('本の保存に失敗しました'));
      tx.onabort = () => reject(tx.error ?? new Error('本の保存に失敗しました(空き容量を確認してください)'));
    });
  } finally {
    db.close();
  }
}

export async function putBook(book: StoredBook): Promise<void> {
  await withStore('readwrite', (s) => s.put(book));
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  return withStore<StoredBook | undefined>('readonly', (s) => s.get(id));
}

export async function deleteBook(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

/** 本棚に出す一覧(新しく追加した順)。文章は読まずに、書名だけ取り出す */
export async function listBooks(): Promise<BookSummary[]> {
  const all = await withStore<StoredBook[]>('readonly', (s) => s.getAll());
  return all.map(({ id, title, addedAt }) => ({ id, title, addedAt })).sort((a, b) => b.addedAt - a.addedAt);
}
