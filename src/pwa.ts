// Service Worker の登録と「更新」ボタン。新版は待機させ、ボタンが押されたときだけ切り替える。
import { registerSW } from 'virtual:pwa-register';

export function setupUpdateBanner(banner: HTMLElement, button: HTMLElement): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      banner.hidden = false;
    },
  });
  button.addEventListener('click', () => {
    void updateSW(true);
  });
}
