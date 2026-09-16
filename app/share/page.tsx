"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyMove, type Cup, type Move, type UnlockSolveResult } from "../../lib/solver";
import { recognizeScreenshot, type RecognitionResult, type RasterImage } from "../../lib/recognizer";
import {
  clearLocalScreenshots,
  deleteLocalScreenshot,
  listLocalScreenshots,
  saveLocalScreenshot,
  type LocalScreenshotEntry,
} from "../../lib/local-history";

const CAPACITY = 4;
const DEFAULT_PALETTE = ["#7c3aed", "#2563eb", "#f43f5e", "#f59e0b", "#22c55e", "#14b8a6", "#ef4444", "#eab308", "#92400e", "#fb7185", "#0ea5e9", "#a855f7"];
const PREFS_KEY = "water-sort-mobile-prefs-v1";

type WorkerReply = { id: number; result: UnlockSolveResult };
type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};
type MobilePrefs = {
  keepAwake: boolean;
  haptics: boolean;
  historyEnabled: boolean;
  focusMode: boolean;
  skinProfile: "taote-water-sort-v1";
};

const DEFAULT_PREFS: MobilePrefs = {
  keepAwake: true,
  haptics: true,
  historyEnabled: false,
  focusMode: true,
  skinProfile: "taote-water-sort-v1",
};

function colorFor(palette: string[], color: number) {
  return palette[color] ?? DEFAULT_PALETTE[color % DEFAULT_PALETTE.length];
}

function puzzleProgressKey(result: RecognitionResult) {
  const source = JSON.stringify([result.cups, result.locked]);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `water-sort-progress-${(hash >>> 0).toString(36)}`;
}

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

async function rasterize(file: File): Promise<RasterImage> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let cleanup: (() => void) | undefined;

  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    cleanup = () => bitmap.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取截图"));
    });
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    cleanup = () => URL.revokeObjectURL(objectUrl);
  }

  const scale = Math.min(1, 540 / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 Canvas");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  cleanup?.();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}

function MiniBoard({ cups, palette, locked, unlocked, move }: { cups: Cup[]; palette: string[]; locked: number[]; unlocked: number[]; move: Move | null }) {
  return (
    <div className="share-cups" aria-label="当前杯面">
      {cups.map((cup, index) => {
        const display = Array.from({ length: CAPACITY }, (_, visualLevel) => cup[CAPACITY - 1 - visualLevel]);
        const stillLocked = locked.includes(index) && !unlocked.includes(index);
        return (
          <div key={index} className={`share-cup-wrap ${move?.from === index ? "active-source" : ""} ${move?.to === index ? "active-target" : ""}`}>
            {stillLocked && <span title="广告锁定杯">🔒</span>}
            <div className="share-cup" style={stillLocked ? { opacity: 0.42, filter: "grayscale(1)" } : undefined}>
              {display.map((color, level) => <div key={level} className="share-layer" style={{ background: color === undefined ? "transparent" : colorFor(palette, color) }} />)}
            </div>
            <span className="share-cup-index">{index + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function SharedSolvePage() {
  const [token, setToken] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [unlocked, setUnlocked] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("正在准备移动端求解器……");
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [prefs, setPrefs] = useState<MobilePrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<"off" | "on" | "unsupported" | "blocked">("off");
  const [history, setHistory] = useState<LocalScreenshotEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerRequestRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const vibrate = useCallback((pattern: number | number[]) => {
    if (!prefs.haptics || !("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  }, [prefs.haptics]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listLocalScreenshots());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(saved), skinProfile: "taote-water-sort-v1" });
    } catch {
      setPrefs(DEFAULT_PREFS);
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    if (prefs.historyEnabled) void refreshHistory();
    else setHistory([]);
  }, [prefs, prefsLoaded, refreshHistory]);

  const releaseWakeLock = useCallback(async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) {
      try { await lock.release(); } catch { /* already released */ }
    }
    setWakeStatus("off");
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!prefs.keepAwake || !moves.length || document.visibilityState !== "visible") return;
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) {
      setWakeStatus("unsupported");
      return;
    }
    if (wakeLockRef.current) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setWakeStatus("on");
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
        if (prefs.keepAwake && moves.length) setWakeStatus("off");
      });
    } catch {
      setWakeStatus("blocked");
    }
  }, [moves.length, prefs.keepAwake]);

  useEffect(() => {
    if (!prefs.keepAwake || !moves.length) {
      void releaseWakeLock();
      return;
    }
    void acquireWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock, moves.length, prefs.keepAwake, releaseWakeLock]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    void wakeLockRef.current?.release();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!progressKey || !moves.length) return;
    localStorage.setItem(progressKey, String(step));
  }, [progressKey, step, moves.length]);

  const runSolver = useCallback((result: RecognitionResult) => {
    if (typeof Worker === "undefined") {
      setError("当前浏览器不支持 Web Worker，请进入完整编辑器重试。");
      setStatus("当前浏览器不支持后台求解");
      return;
    }
    workerRef.current?.terminate();
    const id = ++workerRequestRef.current;
    const worker = new Worker(new URL("../../lib/solver.worker.ts", import.meta.url));
    workerRef.current = worker;
    setSolving(true);
    setStatus(result.suspiciousCups.length ? `识别完成；有 ${result.suspiciousCups.length} 个位置建议核对，正在先尝试自动求解……` : `识别完成，正在后台自动求解……`);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      workerRef.current = null;
      setSolving(false);
      if (event.data.result.status === "solved") {
        setMoves(event.data.result.moves);
        setUnlocked(event.data.result.unlocked);
        const key = puzzleProgressKey(result);
        setProgressKey(key);
        const restored = Math.max(0, Math.min(event.data.result.moves.length, Number(localStorage.getItem(key) ?? 0) || 0));
        setStep(restored);
        const unlockText = event.data.result.unlocked.length ? `；需解锁杯 ${event.data.result.unlocked.map((index) => index + 1).join("、")}` : "；无需广告杯";
        const resumeText = restored > 0 && restored < event.data.result.moves.length ? `；已恢复到第 ${restored + 1} 步` : "";
        setStatus(`已找到 ${event.data.result.moves.length} 步解法${unlockText}${resumeText}。`);
        setError(null);
        vibrate([25, 35, 25]);
      } else {
        setMoves([]);
        setError(event.data.result.reason);
        setStatus("自动求解未完成");
      }
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      setSolving(false);
      setError("后台求解线程启动失败，请进入完整编辑器重试。");
      setStatus("求解线程失败");
    };
    worker.postMessage({ id, cups: result.cups, locked: result.locked, mode: "fast" });
  }, [vibrate]);

  const processFile = useCallback(async (file: File, options: { saveHistory?: boolean; historyId?: string } = {}) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片格式的游戏截图。");
      return;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    workerRequestRef.current++;
    setSolving(false);
    setMoves([]);
    setUnlocked([]);
    setStep(0);
    setProgressKey(null);
    setRecognition(null);
    setError(null);
    setStatus("正在设备本地识别杯子和颜色……");

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);

    try {
      const raster = await rasterize(file);
      const result = recognizeScreenshot(raster);
      if (!result.cups.length) throw new Error(result.warnings[0] ?? "没有识别到可求解的杯子，请进入完整编辑器手动核对。");
      setRecognition(result);
      setCurrentHistoryId(options.historyId ?? null);

      if (prefs.historyEnabled && options.saveHistory !== false) {
        try {
          const id = await saveLocalScreenshot(file, {
            cupCount: result.cups.length,
            lockedCount: result.locked.length,
            suspiciousCount: result.suspiciousCups.length,
            confidence: result.confidence,
          }, file.name || "淘特关卡截图");
          setCurrentHistoryId(id);
          await refreshHistory();
        } catch {
          // History is convenience-only; recognition/solving must still continue.
        }
      }

      runSolver(result);
    } catch (caught) {
      setSolving(false);
      setError(caught instanceof Error ? caught.message : "处理截图失败。");
      setStatus("处理失败");
    }
  }, [prefs.historyEnabled, refreshHistory, runSolver]);

  useEffect(() => {
    if (!prefsLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const queryError = params.get("error");
    const sharedToken = params.get("shared");
    if (queryError === "missing-image") {
      setError("这次系统分享里没有找到图片。请从截图预览或相册里选择“分享”，再选择 Water Sort Solver。");
      setStatus("没有收到截图");
      return;
    }
    if (!sharedToken) {
      setStatus("可以分享截图，也可以直接选择最近的游戏截图。");
      if (prefs.historyEnabled) void refreshHistory();
      return;
    }

    setToken(sharedToken);
    let cancelled = false;
    void (async () => {
      try {
        if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
        const response = await fetch(`/__shared_image__/${encodeURIComponent(sharedToken)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("分享截图已失效，请重新分享一次。");
        const blob = await response.blob();
        if (cancelled) return;
        const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        const file = new File([blob], `shared-water-sort.${extension}`, { type: blob.type || "image/jpeg" });
        await processFile(file);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "处理分享截图失败。");
          setStatus("处理失败");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [prefsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    if (!recognition) return [] as Cup[];
    let state = recognition.cups.map((cup) => cup.slice());
    for (let index = 0; index < Math.min(step, moves.length); index++) {
      const next = applyMove(state, moves[index].from, moves[index].to, CAPACITY);
      if (next) state = next.cups;
    }
    return state;
  }, [recognition, moves, step]);

  const currentMove = step < moves.length ? moves[step] : null;
  const progress = moves.length ? Math.round((step / moves.length) * 100) : 0;
  const palette = recognition?.palette.length ? recognition.palette : DEFAULT_PALETTE;
  const focusActive = prefs.focusMode && moves.length > 0 && !error;

  const changeStep = (next: number) => {
    const clamped = Math.max(0, Math.min(moves.length, next));
    if (clamped !== step) vibrate(24);
    setStep(clamped);
  };

  const chooseNewScreenshot = () => fileInputRef.current?.click();

  const loadHistoryItem = async (entry: LocalScreenshotEntry) => {
    const extension = entry.type.includes("png") ? "png" : entry.type.includes("webp") ? "webp" : "jpg";
    const file = new File([entry.blob], `history-${entry.id}.${extension}`, { type: entry.type });
    setToken(null);
    await processFile(file, { saveHistory: false, historyId: entry.id });
  };

  const removeHistoryItem = async (id: string) => {
    await deleteLocalScreenshot(id);
    if (currentHistoryId === id) setCurrentHistoryId(null);
    await refreshHistory();
  };

  const clearHistory = async () => {
    if (!window.confirm("清空保存在这台设备上的 Water Sort 截图历史？")) return;
    await clearLocalScreenshots();
    setHistory([]);
    setCurrentHistoryId(null);
  };

  const clearSharedAndHome = () => {
    if (token) navigator.serviceWorker.controller?.postMessage({ type: "delete-shared", token });
    window.location.href = "/";
  };

  const wakeLabel = wakeStatus === "on" ? "防息屏已开启" : wakeStatus === "unsupported" ? "不支持防息屏" : wakeStatus === "blocked" ? "防息屏被系统限制" : "防息屏";

  return (
    <main className={`share-main ${focusActive ? "focus-active" : ""}`}>
      <input ref={fileInputRef} className="share-file-input" type="file" accept="image/*" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        if (token) navigator.serviceWorker.controller?.postMessage({ type: "delete-shared", token });
        setToken(null);
        void processFile(file);
      }} />

      <header className="share-hero">
        <div><p className="share-kicker">ANDROID QUICK SOLVE · V0.5</p><h1>{focusActive ? "按提示连续操作" : "截图直达求解器"}</h1><p className="subtitle">淘特截图 → 本地识别 → 后台求解 → 大按钮连续执行</p></div>
        <span className="share-pill">淘特模式 · 本地处理</span>
      </header>

      <section className="share-card mobile-control-card">
        <div className={`share-status ${error ? "error" : moves.length ? "ready" : ""}`}>
          <span className="share-status-dot" />
          <div><strong>{status}</strong><small>{solving ? "求解在 Web Worker 中运行，不会阻塞手机界面。" : `识别配置：${prefs.skinProfile}`}</small></div>
        </div>
        <div className="mobile-toggles" aria-label="移动端设置">
          <button type="button" className={prefs.keepAwake ? "enabled" : ""} onClick={() => setPrefs((old) => ({ ...old, keepAwake: !old.keepAwake }))}>{wakeLabel}</button>
          <button type="button" className={prefs.haptics ? "enabled" : ""} onClick={() => setPrefs((old) => ({ ...old, haptics: !old.haptics }))}>轻震动 {prefs.haptics ? "开" : "关"}</button>
          <button type="button" className={prefs.focusMode ? "enabled" : ""} onClick={() => setPrefs((old) => ({ ...old, focusMode: !old.focusMode }))}>专注模式 {prefs.focusMode ? "开" : "关"}</button>
          <button type="button" className={prefs.historyEnabled ? "enabled" : ""} onClick={() => setPrefs((old) => ({ ...old, historyEnabled: !old.historyEnabled }))}>本机历史 {prefs.historyEnabled ? "开" : "关"}</button>
        </div>
      </section>

      {!focusActive && (previewUrl || recognition) && <section className="share-card share-grid">
        {previewUrl ? <div className="share-shot"><img src={previewUrl} alt="游戏截图" /></div> : <div className="share-empty-state">正在准备截图预览…</div>}
        <div className="share-summary">
          <h2>自动识别</h2>
          {recognition ? <>
            <div className="share-metrics"><span>{recognition.detections.length} 个杯</span><span>{recognition.locked.length} 个广告杯</span><span>{recognition.palette.length} 种颜色</span><span>{Math.round(recognition.confidence * 100)}% 置信度</span></div>
            {recognition.suspiciousCups.length > 0 && <div className="share-warning">建议核对杯 {recognition.suspiciousCups.map((index) => index + 1).join("、")}。快捷模式仍会先尝试求解；如果游戏画面与结果不一致，进入完整编辑器修正。</div>}
          </> : <p>正在检测杯子网格、液层、空杯和广告锁定杯……</p>}
        </div>
      </section>}

      {recognition && <section className={`share-card board-card ${focusActive ? "focus-board" : ""}`}>
        <div className="focus-title"><h2>当前杯面</h2>{focusActive && <button type="button" onClick={() => setPrefs((old) => ({ ...old, focusMode: false }))}>查看截图与诊断</button>}</div>
        <MiniBoard cups={preview} palette={palette} locked={recognition.locked} unlocked={unlocked} move={currentMove} />
      </section>}

      {moves.length > 0 && <section className={`share-card execution-card ${focusActive ? "focus-execution" : ""}`}>
        <div className="share-progress"><strong>执行进度 {step} / {moves.length}</strong><span>{progress}%</span></div>
        <div className="mobile-progress-track"><span style={{ width: `${progress}%` }} /></div>
        {currentMove ? <div className="share-command">
          <div className="share-node source"><small>① 先点击</small><strong>{currentMove.from + 1} 号杯</strong><span>源杯</span></div>
          <div className="share-arrow"><i style={{ background: colorFor(palette, currentMove.color) }} /><b>→</b><small>{currentMove.amount > 1 ? `${currentMove.amount} 层同色` : "1 层"}</small></div>
          <div className="share-node target"><small>② 再点击</small><strong>{currentMove.to + 1} 号杯</strong><span>目标杯</span></div>
        </div> : <div className="share-finish"><strong>🎉 全部步骤完成</strong><span>直接点“下一关截图”，继续下一局。</span></div>}
        <div className="share-actions secondary-actions">
          <button type="button" disabled={step === 0} onClick={() => changeStep(step - 1)}>↶ 误点了，退一步</button>
          <button type="button" onClick={chooseNewScreenshot}>{currentMove ? "换一张截图" : "下一关截图"}</button>
          {token && <a href={`/?shared=${encodeURIComponent(token)}`}>进入完整编辑器核对</a>}
          <button type="button" onClick={clearSharedAndHome}>返回完整主页</button>
        </div>
      </section>}

      {!moves.length && !solving && <section className="share-card quick-start-card">
        <button className="quick-start-button" type="button" onClick={chooseNewScreenshot}>选择最近截图开始求解</button>
        <small>安卓上也可以直接从截图预览/相册点“分享 → Water Sort”。</small>
      </section>}

      {prefs.historyEnabled && !focusActive && <section className="share-card local-history-card">
        <div className="history-head"><div><h2>本机截图历史</h2><p>最多 8 张，7 天自动清理，仅存当前设备 IndexedDB；不会上传服务器。</p></div>{history.length > 0 && <button type="button" onClick={() => void clearHistory()}>清空</button>}</div>
        {history.length ? <div className="history-list">{history.map((entry) => <div key={entry.id} className={`history-item ${currentHistoryId === entry.id ? "active" : ""}`}>
          <button className="history-open" type="button" onClick={() => void loadHistoryItem(entry)}><strong>{formatHistoryTime(entry.createdAt)}</strong><span>{entry.cupCount} 杯 · {entry.lockedCount} 广告杯 · {Math.round(entry.confidence * 100)}%</span></button>
          <button className="history-delete" type="button" aria-label="删除这张本机截图" onClick={() => void removeHistoryItem(entry.id)}>×</button>
        </div>)}</div> : <p className="history-empty">开启后，新处理的截图会出现在这里。该功能默认关闭。</p>}
      </section>}

      {error && <section className="share-card"><div className="share-warning">{error}</div><div className="share-actions">{token && <a href={`/?shared=${encodeURIComponent(token)}`}>进入完整编辑器核对</a>}<button type="button" onClick={chooseNewScreenshot}>重新选择截图</button><a href="/">返回主页</a></div></section>}

      {moves.length > 0 && <div className="execution-dock" role="group" aria-label="连续执行控制">
        <button className="dock-back" type="button" disabled={step === 0} onClick={() => changeStep(step - 1)} aria-label="上一步">↶</button>
        <button className="dock-primary" type="button" onClick={() => currentMove ? changeStep(step + 1) : chooseNewScreenshot()}>{currentMove ? `✓ 完成第 ${step + 1} 步` : "📷 下一关截图"}</button>
        <button className="dock-shot" type="button" onClick={chooseNewScreenshot} aria-label="选择新截图">📷</button>
      </div>}
    </main>
  );
}
