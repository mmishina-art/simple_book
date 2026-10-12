// 「PDF から本を作る」画面の DOM 操作。変換そのもの(重い部分)は src/convert.ts で、開始するときに読み込む。
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

type Phase = 'form' | 'running' | 'done';

function formatEta(seconds: number): string {
  if (seconds < 90) return `残り約 ${Math.max(1, seconds)} 秒`;
  const min = Math.round(seconds / 60);
  return min < 120 ? `残り約 ${min} 分` : `残り約 ${(min / 60).toFixed(1)} 時間`;
}

export function setupConvert(onBook: (markdown: string, fileName: string) => Promise<void>): void {
  const dialog = $<HTMLDialogElement>('convert-dialog');
  const fileInput = $<HTMLInputElement>('convert-file');
  const start = $<HTMLButtonElement>('convert-start');
  let file: File | undefined;
  let vertical = true;
  let controller: AbortController | undefined;
  let markdown = '';
  let fileName = 'book.md';
  let wakeLock: { release(): Promise<void> } | undefined;

  const show = (phase: Phase): void => {
    $('convert-form').hidden = phase !== 'form';
    $('convert-running').hidden = phase !== 'running';
    $('convert-done').hidden = phase !== 'done';
  };
  const setDirection = (v: boolean): void => {
    vertical = v;
    for (const b of dialog.querySelectorAll<HTMLElement>('[data-convert-dir]')) b.setAttribute('aria-pressed', String((b.dataset.convertDir === 'vertical') === v));
  };

  $('convert-open').addEventListener('click', () => {
    if (!controller) {
      show('form');
      $('convert-error').textContent = '';
    }
    dialog.showModal();
  });
  for (const b of dialog.querySelectorAll<HTMLElement>('[data-convert-dir]')) b.addEventListener('click', () => setDirection(b.dataset.convertDir === 'vertical'));

  fileInput.addEventListener('change', () => {
    file = fileInput.files?.[0];
    start.disabled = !file;
    $('convert-filename').textContent = file ? `${file.name}(${(file.size / 1024 / 1024).toFixed(1)}MB)` : '';
    if (file) $<HTMLInputElement>('convert-title-input').value = file.name.replace(/\.pdf$/i, '');
  });

  start.addEventListener('click', () => void run());
  $('convert-cancel').addEventListener('click', () => controller?.abort());
  // 変換中に画面を閉じたら中止する
  dialog.addEventListener('close', () => {
    if (controller && $('convert-running').hidden === false) controller.abort();
  });
  $('convert-save').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  async function run(): Promise<void> {
    if (!file) return;
    const error = $('convert-error');
    error.textContent = '';
    controller = new AbortController();
    show('running');
    const bar = $<HTMLProgressElement>('convert-progress');
    bar.value = 0;
    $('convert-status').textContent = '準備しています…(はじめは OCR のデータを読み込みます)';
    try {
      // 変換中に画面が消えないようにする(使えない端末では何もしない)
      wakeLock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').catch(() => undefined);
    } catch {
      wakeLock = undefined;
    }
    try {
      const { convertPdf } = await import('./convert');
      const title = $<HTMLInputElement>('convert-title-input').value.trim() || file.name.replace(/\.pdf$/i, '');
      const result = await convertPdf(file, {
        vertical,
        cover: $<HTMLInputElement>('convert-cover').checked,
        illustrations: $<HTMLInputElement>('convert-illustrations').checked,
        headings: $<HTMLInputElement>('convert-headings').checked,
        title,
        signal: controller.signal,
        onProgress: ({ done, total, etaSeconds }) => {
          bar.value = Math.round((done / total) * 100);
          $('convert-status').textContent = `${done} / ${total} ページ${etaSeconds !== undefined ? `(${formatEta(etaSeconds)})` : ''}`;
        },
      });
      markdown = result.markdown;
      fileName = `${title}.md`;
      await onBook(markdown, fileName);
      $('convert-result').textContent = `本棚に追加しました(${result.pages} ページ${result.images > 0 ? `、画像 ${result.images} 枚` : ''}${result.empty > 0 ? `、文字を読み取れなかったページ ${result.empty}` : ''})。OCR の誤字は、本ファイル(.md)を直して取り込み直すと、しおりを保ったまま差し替わります。`;
      show('done');
    } catch (err) {
      show('form');
      error.textContent = err instanceof DOMException && err.name === 'AbortError' ? '中止しました' : `変換できませんでした: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      controller = undefined;
      void wakeLock?.release().catch(() => undefined);
      wakeLock = undefined;
    }
  }
}
