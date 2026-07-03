/*
 * COI ServiceWorker — GitHub Pages などレスポンスヘッダを設定できない
 * 静的ホスティングで COOP/COEP を付与し crossOriginIsolated を有効化する。
 * （crossOriginIsolated = MediaPipe の WASM スレッドが使える = 認識が速い）
 * server.py 経由ではヘッダが最初から付くため、このワーカーは何もしない。
 * 参考: https://github.com/gzuidhof/coi-serviceworker (MIT)
 */

if (typeof window === 'undefined') {
  // ---- Service Worker 側 ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response;
          const headers = new Headers(response.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Resource-Policy', 'same-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((e) => console.error('[coi-sw]', e))
    );
  });
} else {
  // ---- ページ側（登録スクリプトとして読み込まれた場合）----
  (() => {
    const script = window.document.currentScript;
    const swUrl = script ? script.src : './coi-serviceworker.js';

    // すでに隔離済み（server.py がヘッダを付けている）なら何もしない
    if (window.crossOriginIsolated) return;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        // 初回登録時のみ1回だけリロードして SW を効かせる
        if (reg.active && !navigator.serviceWorker.controller) {
          if (!sessionStorage.getItem('coiReloaded')) {
            sessionStorage.setItem('coiReloaded', '1');
            window.location.reload();
          }
        } else {
          reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            if (!w) return;
            w.addEventListener('statechange', () => {
              if (w.state === 'activated' && !navigator.serviceWorker.controller &&
                  !sessionStorage.getItem('coiReloaded')) {
                sessionStorage.setItem('coiReloaded', '1');
                window.location.reload();
              }
            });
          });
        }
      })
      .catch((e) => console.warn('[coi-sw] register failed (続行します)', e));
  })();
}
