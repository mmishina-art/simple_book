// localStorage は使えない環境（プライベートブラウズなど）でもアプリが動くよう、必ず try/catch で囲む。
// 保存キー名を変えると利用者の記録が消える。変えるときは移行処理を書くこと。

import { SCHEMA_VERSION, createBackup, parseBackup } from './backup';

// 保存データのキーの接頭辞。GitHub Pages では、すべてのアプリが同じサイトに載り、localStorage を共有するので、
// アプリごとに別の名前にする（package.json の name）。
const PREFIX = __APP_ID__;

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}-${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}-${key}`, JSON.stringify(value));
  } catch {
    // 保存できなくても続行する
  }
}

// ブラウザに「保存データを消さないで」と頼む（消されにくくなる）
export function requestPersist(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}

// ---- 保存データの版番号と移行 ----

/** 保存データの形が変わったときの移行処理。from → from+1 の変換を、ここに足していく。 */
function migrate(from: number): void {
  // 例: if (from < 2) { /* 版 1 → 2 の変換 */ }
  void from;
}

/** 起動時に一度呼ぶ。保存されている形の版が古ければ、移行してから版番号を書き直す。 */
export function migrateStorage(): void {
  const stored = load<number>('schema', 0);
  if (stored < SCHEMA_VERSION) {
    migrate(stored);
    save('schema', SCHEMA_VERSION);
  }
}

// ---- バックアップ ----

/** このアプリの保存データを、ファイルの中身（JSON の文字列）にする */
export function exportBackup(): string {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${PREFIX}-`)) data[key] = localStorage.getItem(key) ?? '';
    }
  } catch {
    // 読めなければ空のバックアップになる
  }
  return createBackup(data);
}

/** バックアップの中身を保存する。おかしいファイルは例外（理由つき）で止める。保存した件数を返す。 */
export function importBackup(text: string): number {
  const data = parseBackup(text);
  const keys = Object.keys(data).filter((k) => k.startsWith(`${PREFIX}-`));
  for (const key of keys) localStorage.setItem(key, data[key]);
  return keys.length;
}
