// =============================================================
//  Vision入力 — MediaPipe PoseLandmarker（複数人・全身）
//  ローカルに同梱した vendor/mediapipe の資産のみで動作します。
// =============================================================

import { CONFIG } from '../config.js';

// MediaPipe本体は「動的import」で読む。これによりライブラリ読込に失敗しても
// アプリ全体は起動し、自動でマウス/キーボードに切り替わる（起動をブロックしない）。
// import.meta.url を基準に絶対URL化（どんな配信形態でも壊れにくい）。
const BUNDLE_URL = new URL('../../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
const WASM_PATH = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH = new URL(`../../vendor/mediapipe/${CONFIG.input.modelFile}`, import.meta.url).href;

export class VisionInput {
  constructor(videoEl) {
    this.video = videoEl;
    this.landmarker = null;
    this.stream = null;
    this.ready = false;       // 認識可能（モデル+カメラ両方OK）
    this.modelReady = false;
    this.cameraReady = false;
    this.lastResults = null;
    this._lastVideoTime = -1;
    this._lastTs = 0;
    this.statusText = '';
  }

  async init() {
    await this._initModel();
    await this._initCamera();
    this.ready = this.modelReady && this.cameraReady;
    return this.ready;
  }

  async _initModel() {
    this.statusText = 'ライブラリ読込中';
    const { PoseLandmarker, FilesetResolver } = await import(BUNDLE_URL);
    this.statusText = 'モデル読込中';
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const cfg = CONFIG.input;
    const makeOptions = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numPoses: cfg.maxPlayers,
      minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
      minPosePresenceConfidence: cfg.minPosePresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
      outputSegmentationMasks: false,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, makeOptions(cfg.delegate));
    } catch (e) {
      console.warn('[vision] GPU初期化に失敗、CPUで再試行', e);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, makeOptions('CPU'));
    }
    this.modelReady = true;
  }

  async _initCamera() {
    this.statusText = 'カメラ起動中';
    // セキュアコンテキスト(https または localhost)でないとカメラは使えない
    if (!window.isSecureContext) {
      throw new Error('INSECURE_CONTEXT');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('NO_CAMERA_API');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch (err) {
      // NotAllowedError / NotFoundError などを名前付きで再送出
      throw new Error(err && err.name ? err.name : 'CAMERA_ERROR');
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    // メタデータ（解像度）が揃うまで待つ
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        const done = () => resolve();
        this.video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 4000); // 保険
      });
    }
    this.cameraReady = true;
  }

  // 毎フレーム: 最新の姿勢配列を返す（[{landmarks:[33], visibility...}] 形式）
  // 戻り値: result.landmarks（配列の配列）または null
  detect(nowMs) {
    if (!this.ready || !this.landmarker) return null;
    if (this.video.readyState < 2 || !this.video.videoWidth) return this.lastResults?.landmarks ?? null;

    // 同一フレームの再処理を避ける
    if (this.video.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = this.video.currentTime;
      const ts = Math.max(nowMs, this._lastTs + 1);
      this._lastTs = ts;
      try {
        this.lastResults = this.landmarker.detectForVideo(this.video, ts);
      } catch (e) {
        // タイムスタンプ系などの一時エラーは握りつぶして継続
        console.debug('[vision] detect skip', e?.message || e);
      }
    }
    return this.lastResults ? this.lastResults.landmarks : null;
  }

  get videoAspect() {
    if (this.video && this.video.videoWidth) return this.video.videoWidth / this.video.videoHeight;
    return 16 / 9;
  }

  stop() {
    try {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    } catch {}
    this.stream = null;
    this.cameraReady = false;
    this.ready = false;
  }
}
