"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyMove, type Cup, type Move, type UnlockSolveResult } from "../../lib/solver";
import { recognizeScreenshot, type RecognitionResult, type RasterImage } from "../../lib/recognizer";

const CAPACITY = 4;
const DEFAULT_PALETTE = ["#7c3aed", "#2563eb", "#f43f5e", "#f59e0b", "#22c55e", "#14b8a6", "#ef4444", "#eab308", "#92400e", "#fb7185", "#0ea5e9", "#a855f7"];
type WorkerReply = { id: number; result: UnlockSolveResult };

function colorFor(palette: string[], color: number) {
  return palette[color] ?? DEFAULT_PALETTE[color % DEFAULT_PALETTE.length];
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
      image.onerror = () => reject(new Error("无法读取分享的截图"));
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
  const [status, setStatus] = useState("正在读取系统分享的截图……");
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryError = params.get("error");
    const sharedToken = params.get("shared");
    if (queryError === "missing-image") {
      setError("这次系统分享里没有找到图片。请从截图预览或相册里选择“分享”，再选择 Water Sort Solver。");
      setStatus("没有收到截图");
      return;
    }
    if (!sharedToken) {
      setError("没有收到分享截图。你也可以返回完整编辑器，直接上传或粘贴截图。");
      setStatus("等待截图");
      return;
    }

    setToken(sharedToken);
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
        const response = await fetch(`/__shared_image__/${encodeURIComponent(sharedToken)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("分享截图已失效，请重新分享一次。");
        const blob = await response.blob();
        if (cancelled) return;

        const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        const file = new File([blob], `shared-water-sort.${extension}`, { type: blob.type || "image/jpeg" });
        objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        setStatus("正在设备本地识别杯子和颜色……");

        const raster = await rasterize(file);
        if (cancelled) return;
        const result = recognizeScreenshot(raster);
        if (!result.cups.length) throw new Error(result.warnings[0] ?? "没有识别到可求解的杯子，请进入完整编辑器手动核对。");
        setRecognition(result);
        setStatus(result.suspiciousCups.length ? `已识别 ${result.cups.length} 个杯子；有 ${result.suspiciousCups.length} 个位置建议核对，先尝试自动求解……` : `已识别 ${result.cups.length} 个杯子，正在自动求解……`);

        if (typeof Worker === "undefined") throw new Error("当前浏览器不支持 Web Worker，请进入完整编辑器重试。");
        const worker = new Worker(new URL("../../lib/solver.worker.ts", import.meta.url));
        workerRef.current = worker;
        setSolving(true);
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          if (cancelled || event.data.id !== 1) return;
          worker.terminate();
          workerRef.current = null;
          setSolving(false);
          if (event.data.result.status === "solved") {
            setMoves(event.data.result.moves);
            setUnlocked(event.data.result.unlocked);
            setStep(0);
            const unlockText = event.data.result.unlocked.length ? `；需解锁杯 ${event.data.result.unlocked.map((index) => index + 1).join("、")}` : "；无需广告杯";
            setStatus(`已找到 ${event.data.result.moves.length} 步解法${unlockText}。直接按下面第 1 步开始操作。`);
          } else {
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
        worker.postMessage({ id: 1, cups: result.cups, locked: result.locked, mode: "fast" });
      } catch (caught) {
        if (!cancelled) {
          setSolving(false);
          setError(caught instanceof Error ? caught.message : "处理分享截图失败。");
          setStatus("处理失败");
        }
      }
    })();

    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

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

  const clearShared = () => {
    if (token) navigator.serviceWorker.controller?.postMessage({ type: "delete-shared", token });
    window.location.href = "/";
  };

  return (
    <main className="share-main">
      <header className="share-hero">
        <div><p className="share-kicker">ANDROID SHARE · V0.4</p><h1>截图已直达求解器</h1><p className="subtitle">分享 → 本地识别 → 自动求解 → 直接显示第 1 步</p></div>
        <span className="share-pill">设备本地处理</span>
      </header>

      <section className="share-card">
        <div className={`share-status ${error ? "error" : moves.length ? "ready" : ""}`}>
          <span className="share-status-dot" />
          <div><strong>{status}</strong><small>{solving ? "求解运行在 Web Worker 中，界面不会被阻塞。" : "系统分享截图由已安装 PWA 的 Service Worker 接收。"}</small></div>
        </div>
      </section>

      {(previewUrl || recognition) && <section className="share-card share-grid">
        {previewUrl ? <div className="share-shot"><img src={previewUrl} alt="系统分享的游戏截图" /></div> : <div className="share-empty-state">正在准备截图预览…</div>}
        <div className="share-summary">
          <h2>自动识别</h2>
          {recognition ? <>
            <div className="share-metrics"><span>{recognition.detections.length} 个杯</span><span>{recognition.locked.length} 个广告杯</span><span>{recognition.palette.length} 种颜色</span><span>{Math.round(recognition.confidence * 100)}% 置信度</span></div>
            {recognition.suspiciousCups.length > 0 && <div className="share-warning">建议核对杯 {recognition.suspiciousCups.map((index) => index + 1).join("、")}。快捷模式仍会先尝试求解；如果游戏画面与结果不一致，点下面“进入完整编辑器”修正。</div>}
          </> : <p>正在检测杯子网格、液层、空杯和广告锁定杯……</p>}
        </div>
      </section>}

      {recognition && <section className="share-card">
        <h2>当前杯面</h2>
        <MiniBoard cups={preview} palette={palette} locked={recognition.locked} unlocked={unlocked} move={currentMove} />
      </section>}

      {moves.length > 0 && <section className="share-card">
        <div className="share-progress"><strong>执行进度 {step} / {moves.length}</strong><span>{progress}%</span></div>
        {currentMove ? <div className="share-command">
          <div className="share-node source"><small>① 先点击</small><strong>{currentMove.from + 1} 号杯</strong><span>源杯</span></div>
          <div className="share-arrow"><i style={{ background: colorFor(palette, currentMove.color) }} /><b>→</b><small>{currentMove.amount > 1 ? `${currentMove.amount} 层同色` : "1 层"}</small></div>
          <div className="share-node target"><small>② 再点击</small><strong>{currentMove.to + 1} 号杯</strong><span>目标杯</span></div>
        </div> : <div className="share-finish"><strong>🎉 全部步骤完成</strong><span>当前杯面应已经是完成状态。</span></div>}
        <div className="share-actions">
          <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>← 上一步</button>
          <button className="primary-action" type="button" disabled={!currentMove} onClick={() => setStep((value) => Math.min(moves.length, value + 1))}>已完成这一步 →</button>
          {token && <a href={`/?shared=${encodeURIComponent(token)}`}>进入完整编辑器核对</a>}
          <button type="button" onClick={clearShared}>清除截图并返回</button>
        </div>
      </section>}

      {error && <section className="share-card"><div className="share-warning">{error}</div><div className="share-actions">{token && <a href={`/?shared=${encodeURIComponent(token)}`}>进入完整编辑器核对</a>}<a href="/">返回主页</a></div></section>}
    </main>
  );
}
