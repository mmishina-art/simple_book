import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// アプリの ID(package.json の name)。保存データのキーの接頭辞になる
const APP_ID = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string }).name;

/** 短い本。章が 2 つ */
const SHORT = `# テストの本

<!-- page 1 -->

## 第一章

最初の段落です。

次の段落です。

## 第二章

二つ目の章の本文です。
`;

/** 長い本(スクロールが必要)。段落 60 個 */
const LONG = ['# 長い本', ...Array.from({ length: 60 }, (_, i) => `## 節${i + 1}\n\n${'これは長い本の本文です。'.repeat(12)}(${i + 1})`)].join('\n\n');

async function addBook(page: Page, text: string, name = 'book.md'): Promise<void> {
  await page.locator('#book-import').setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) });
}

test('本を追加して開き、本文を読んで、本棚に戻れる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty-message')).toBeVisible();
  await addBook(page, SHORT);
  await expect(page.locator('#import-message')).toHaveText('1 冊を追加しました');
  await expect(page.locator('#empty-message')).toBeHidden();

  await page.getByRole('button', { name: /テストの本/ }).first().click();
  await expect(page.locator('#reader')).toBeVisible();
  await expect(page.locator('#shelf')).toBeHidden();
  await expect(page.locator('#reader-title')).toHaveText('テストの本');
  await expect(page.getByText('最初の段落です。')).toBeVisible();
  await expect(page.getByText('p.1')).toBeVisible();

  await page.getByRole('button', { name: '本棚にもどる' }).click();
  await expect(page.locator('#shelf')).toBeVisible();
  await expect(page.locator('#reader')).toBeHidden();
});

test('取り込んだ本は、再読み込みしても残る(オフライン用の保存)', async ({ page }) => {
  await page.goto('/');
  await addBook(page, SHORT);
  await expect(page.locator('#book-list')).toContainText('テストの本');
  await page.reload();
  await expect(page.locator('#book-list')).toContainText('テストの本');
});

test('読んだ位置(しおり)を覚えていて、開き直すと続きから読める', async ({ page }) => {
  await page.goto('/');
  await addBook(page, LONG);
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await page.locator('h3', { hasText: '節30' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 5));
  // スクロールが止まってから保存される
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`${id}-pos`), APP_ID)).toContain('"i"');
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`${id}-pos`) ?? '{}') as Record<string, { i: number }>, APP_ID);
  expect(Object.values(saved)[0].i).toBeGreaterThan(20);

  await page.reload();
  await expect(page.locator('#book-list')).toContainText('% まで読んだ');
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await expect(page.locator('h3', { hasText: '節30' })).toBeInViewport();
});

test('目次から章に飛べる', async ({ page }) => {
  await page.goto('/');
  await addBook(page, LONG);
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await page.getByRole('button', { name: '目次' }).click();
  await page.locator('#toc-list').getByRole('button', { name: '節40', exact: true }).click();
  await expect(page.locator('h3', { hasText: /^節40$/ })).toBeInViewport();
});

test('文字の大きさと色の設定が保存される', async ({ page }) => {
  await page.goto('/');
  await addBook(page, SHORT);
  await page.getByRole('button', { name: /テストの本/ }).first().click();
  await page.getByRole('button', { name: '文字と明るさの設定' }).click();
  await page.getByRole('button', { name: '文字を大きく' }).click();
  await page.getByRole('button', { name: 'セピア' }).click();
  await expect(page.locator('#font-size')).toHaveText('20');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await expect(page.getByRole('button', { name: 'セピア' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await page.getByRole('button', { name: /テストの本/ }).first().click();
  await expect(page.locator('#reader-body')).toHaveCSS('font-size', '20px');
});

test('本文のタグは文字として表示され、動かない', async ({ page }) => {
  await page.goto('/');
  await addBook(page, '# <img src=x onerror="window.__xss=1">\n\n<script>window.__xss=1</script>');
  await page.getByRole('button', { name: /img/ }).first().click();
  await expect(page.getByText('<script>window.__xss=1</script>')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('本ではないファイルは、理由を出して断る', async ({ page }) => {
  await page.goto('/');
  await addBook(page, '# 題だけ', 'empty.md');
  await expect(page.locator('#import-message')).toContainText('empty.md: 本文が見つかりません');
  await expect(page.locator('#empty-message')).toBeVisible();
});

test('本を削除できる', async ({ page }) => {
  await page.goto('/');
  await addBook(page, SHORT);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '「テストの本」を削除' }).click();
  await expect(page.locator('#empty-message')).toBeVisible();
});

test('manifest と Service Worker が使える', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});
