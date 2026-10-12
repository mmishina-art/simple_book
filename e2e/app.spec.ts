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

/** 既定は縦書き。横書きの動きを見るテストは、保存された設定がないときだけ横書きにしておく */
async function useHorizontal(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ fontSize: 18, theme: 'auto', font: 'serif', direction: 'horizontal' }));
  }, `${APP_ID}-settings`);
}

async function addBook(page: Page, text: string, name = 'book.md'): Promise<void> {
  await page.locator('#book-import').setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) });
}

test('本を追加して開き、本文を読んで、本棚に戻れる', async ({ page }) => {
  await useHorizontal(page);
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
  await useHorizontal(page);
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
  await useHorizontal(page);
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

test('縦書きが既定で、右から左へ横にスクロールして読める', async ({ page }) => {
  await page.goto('/');
  await addBook(page, LONG);
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await expect(page.locator('#reader-body')).toHaveCSS('writing-mode', 'vertical-rl');
  // 最初は右端(書名)が見えている
  await expect(page.locator('.b-h1')).toBeInViewport();
  await page.getByRole('button', { name: '目次' }).click();
  await page.locator('#toc-list').getByRole('button', { name: '節40', exact: true }).click();
  await expect(page.locator('h3', { hasText: /^節40$/ })).toBeInViewport();
  await expect(page.locator('.b-h1')).not.toBeInViewport();

  // しおり: 開き直すと、同じ節から読める
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`${id}-pos`), APP_ID)).toContain('"i"');
  await page.reload();
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await expect(page.locator('h3', { hasText: /^節40$/ })).toBeInViewport();
});

test('縦書きと横書きを切り替えても、読んでいる場所が変わらない', async ({ page }) => {
  await page.goto('/');
  await addBook(page, LONG);
  await page.getByRole('button', { name: /長い本/ }).first().click();
  await page.getByRole('button', { name: '目次' }).click();
  await page.locator('#toc-list').getByRole('button', { name: '節20', exact: true }).click();
  await page.getByRole('button', { name: '文字と明るさの設定' }).click();
  await page.getByRole('button', { name: '横書き' }).click();
  await expect(page.locator('#reader-body')).toHaveCSS('writing-mode', 'horizontal-tb');
  await page.getByRole('button', { name: 'とじる' }).last().click();
  await expect(page.locator('h3', { hasText: /^節20$/ })).toBeInViewport();
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

test.describe('PDF から本を作る(OCR)', () => {
  // OCR(wasm)は時間がかかるので、タイムアウトを長めにする
  test.setTimeout(180_000);

  async function convert(page: Page, pdf: string, direction: '自動' | '縦書き' | '横書き'): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: /PDF から本を作る/ }).click();
    await page.locator('#convert-file').setInputFiles(new URL(`./fixtures/${pdf}`, import.meta.url).pathname);
    await page.locator('#convert-dialog').getByRole('button', { name: direction, exact: true }).click();
    await page.getByRole('button', { name: '変換をはじめる' }).click();
    await expect(page.locator('#convert-result')).toContainText('本棚に追加しました', { timeout: 150_000 });
  }

  test('横書きの PDF を、表紙・見出し・挿絵つきの本にできる', async ({ page }) => {
    await useHorizontal(page);
    await convert(page, 'horizontal.pdf', '横書き');
    await page.locator('#convert-dialog').getByRole('button', { name: 'とじる' }).click();

    // 本棚に表紙のサムネイルが出る
    await expect(page.locator('#book-list img.cover')).toHaveCount(1);
    await page.getByRole('button', { name: /horizontal/ }).first().click();
    await expect(page.locator('#reader-body figure img')).toHaveCount(2); // 表紙 + 挿絵
    await expect(page.getByText('今日は早く起きて')).toBeVisible();
    // 見出しが自動で付き、目次になる
    await page.getByRole('button', { name: '目次' }).click();
    await expect(page.locator('#toc-list')).toContainText('第一章');
  });

  test('縦書きの PDF を読み取れる', async ({ page }) => {
    await convert(page, 'vertical.pdf', '縦書き');
    await page.locator('#convert-dialog').getByRole('button', { name: 'とじる' }).click();
    await page.getByRole('button', { name: /vertical/ }).first().click();
    await expect(page.locator('#reader-body')).toContainText('公園');
  });

  test('本の向きを自動で判定する(横書き・縦書き)', async ({ page }) => {
    await convert(page, 'horizontal.pdf', '自動');
    await expect(page.locator('#convert-result')).toContainText('横書きと判定');
    await page.reload();
    await convert(page, 'vertical.pdf', '自動');
    await expect(page.locator('#convert-result')).toContainText('縦書きと判定');
  });

  // 自炊 PDF でよく使われる JPEG2000 の画像。pdf.js の復号用 wasm(wasmUrl)がないと、白紙として描画されて「本文なし」になる
  test('JPEG2000 の画像の PDF を変換できる', async ({ page }) => {
    await convert(page, 'jpx.pdf', '横書き');
    await page.locator('#convert-dialog').getByRole('button', { name: 'とじる' }).click();
    await page.getByRole('button', { name: /jpx/ }).first().click();
    await expect(page.locator('#reader-body')).toContainText('公園');
  });

  test('先頭の数ページだけ変換できる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /PDF から本を作る/ }).click();
    await page.locator('#convert-file').setInputFiles(new URL('./fixtures/horizontal.pdf', import.meta.url).pathname);
    await page.locator('#convert-max-pages').fill('2');
    await page.locator('#convert-dialog').getByRole('button', { name: '横書き', exact: true }).click();
    await page.getByRole('button', { name: '変換をはじめる' }).click();
    await expect(page.locator('#convert-result')).toContainText('2 ページ', { timeout: 60_000 });
  });

  test('文字も画像も読み取れないときは、原因を伝えて本にしない', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /PDF から本を作る/ }).click();
    await page.locator('#convert-file').setInputFiles(new URL('./fixtures/blank.pdf', import.meta.url).pathname);
    await page.locator('#convert-cover').uncheck();
    await page.locator('#convert-dialog').getByRole('button', { name: '横書き', exact: true }).click();
    await page.getByRole('button', { name: '変換をはじめる' }).click();
    await expect(page.locator('#convert-error')).toContainText('読み取れませんでした', { timeout: 60_000 });
    await page.locator('#convert-dialog').getByRole('button', { name: 'とじる' }).click();
    await expect(page.locator('#empty-message')).toBeVisible();
  });

  test('PDF ではないファイルは、理由を出して断る', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /PDF から本を作る/ }).click();
    await page.locator('#convert-file').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('これはPDFではない') });
    await page.getByRole('button', { name: '変換をはじめる' }).click();
    await expect(page.locator('#convert-error')).toContainText('変換できませんでした');
  });
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
