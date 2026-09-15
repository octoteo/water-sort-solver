"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyMove, type Cup, type Move, solveWithLockedCups } from "../lib/solver";
import { recognizeScreenshot, type RecognitionResult, type RasterImage } from "../lib/recognizer";

const CAPACITY = 4;
const DEFAULT_PALETTE = ["#7c3aed", "#2563eb", "#f43f5e", "#f59e0b", "#22c55e", "#14b8a6", "#ef4444", "#eab308", "#92400e", "#fb7185", "#0ea5e9", "#a855f7"];
const SAMPLE: Cup[] = [[0,1,0,1],[1,0,1,0],[],[]];

type CupHighlight = "source" | "target" | undefined;

function colorFor(palette: string[], color: number) {
  return palette[color] ?? DEFAULT_PALETTE[color % DEFAULT_PALETTE.length];
}

function CupView({ cup, index, locked, unlockRequired, selectedColor, palette, highlight, editing, onCell, onToggleLock }: { cup: Cup; index: number; locked: boolean; unlockRequired: boolean; selectedColor: number; palette: string[]; highlight?: CupHighlight; editing: boolean; onCell: (level: number) => void; onToggleLock: () => void; }) {
  const display = Array.from({ length: CAPACITY }, (_, i) => cup[CAPACITY - 1 - i]);
  const label = highlight === "source" ? "① 源杯" : highlight === "target" ? "② 目标" : null;
  return (
    <div className={`cup-wrap ${locked ? "locked" : ""} ${unlockRequired ? "unlock-required" : ""} ${highlight ? `is-${highlight}` : ""}`}>
      {label && <span className={`move-badge ${highlight}`}>{label}</span>}
      <button className="lock-btn" onClick={onToggleLock} title="切换广告锁定杯" disabled={!editing}>{unlockRequired ? "🔓" : locked ? "🔒" : "○"}</button>
      <div className="cup" aria-label={`杯子 ${index + 1}`}>
        {display.map((color, visualLevel) => {
          const actualLevel = CAPACITY - 1 - visualLevel;
          const title = !editing ? `杯子 ${index + 1}` : selectedColor < 0 ? "清空这一层及其上方" : color === undefined ? `填入颜色 ${selectedColor + 1}` : "点击覆盖当前层";
          return <button key={visualLevel} className="layer" disabled={!editing} onClick={() => onCell(actualLevel)} style={{ background: color === undefined ? "transparent" : colorFor(palette, color) }} title={title} />;
        })}
      </div>
      <span className="cup-index">{index + 1}</span>
    </div>
  );
}

function ScreenshotPreview({ url, result }: { url: string; result: RecognitionResult }) {
  return (
    <div className="recognition-layout">
      <div className="screenshot-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="待识别的游戏截图" />
        <div className="screenshot-overlay" aria-hidden="true">
          {result.detections.map((detection, index) => <div key={index} className={`detected-cup ${detection.type}`} style={{ left: `${detection.box.x * 100}%`, top: `${detection.box.y * 100}%`, width: `${detection.box.width * 100}%`, height: `${detection.box.height * 100}%` }}><span>{index + 1}{detection.type === "locked" ? " 🔒" : detection.type === "empty" ? " ·" : ""}</span></div>)}
        </div>
      </div>
      <div className="recognition-summary">
        <div className="confidence"><span>识别置信度</span><strong>{Math.round(result.confidence * 100)}%</strong></div>
        <div className="recognition-stats"><span>{result.detections.length} 个杯子</span><span>{result.locked.length} 个广告杯</span><span>{result.palette.length} 种颜色</span></div>
        <p>框的位置和编号应与原图一致。识别后仍可在下方逐层修正颜色、空层和广告杯。</p>
        {result.warnings.length > 0 && <div className="recognition-warning"><strong>需要检查</strong>{result.warnings.map((warning) => <span key={warning}>• {warning}</span>)}</div>}
      </div>
    </div>
  );
}

async function rasterize(file: File, objectUrl: string): Promise<RasterImage> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let cleanup: (() => void) | undefined;
  if (typeof window !== "undefined" && "createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    cleanup = () => bitmap.close();
  } else {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("无法读取图片")); });
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
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

export default function Home() {
  const [cups, setCups] = useState<Cup[]>(SAMPLE);
  const [locked, setLocked] = useState<number[]>([]);
  const [solutionUnlocked, setSolutionUnlocked] = useState<number[]>([]);
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  const [selectedColor, setSelectedColor] = useState(0);
  const [mode, setMode] = useState<"fast" | "shortest">("fast");
  const [moves, setMoves] = useState<Move[]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(900);
  const [message, setMessage] = useState("示例关卡已载入，可直接点击“求解”。");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const resetSolution = useCallback(() => {
    setMoves([]);
    setStep(0);
    setPlaying(false);
    setSolutionUnlocked([]);
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setMessage("请选择 PNG、JPG 或其他图片格式的游戏截图。");
      return;
    }
    setRecognizing(true);
    setMessage("正在本地识别杯子、液层颜色和广告锁定杯……");
    const objectUrl = URL.createObjectURL(file);
    try {
      const raster = await rasterize(file, objectUrl);
      const result = recognizeScreenshot(raster);
      if (!result.cups.length) {
        URL.revokeObjectURL(objectUrl);
        setRecognition(null);
        setMessage(result.warnings[0] ?? "截图识别失败，请使用完整游戏截图。");
        return;
      }
      resetSolution();
      setPreviewUrl(objectUrl);
      setRecognition(result);
      setCups(result.cups);
      setLocked(result.locked);
      setPalette(result.palette.length ? result.palette : DEFAULT_PALETTE);
      setSelectedColor(0);
      const warning = result.warnings.length ? `；有 ${result.warnings.length} 项需要人工检查` : "；颜色数量校验通过";
      setMessage(`已识别 ${result.cups.length} 个杯子、${result.locked.length} 个广告杯，置信度 ${Math.round(result.confidence * 100)}%${warning}。确认下方杯面后即可求解。`);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      setMessage(error instanceof Error ? `识别失败：${error.message}` : "截图识别失败");
    } finally {
      setRecognizing(false);
      setDragging(false);
    }
  }, [resetSolution]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"));
      const file = image?.getAsFile();
      if (file) void processImage(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processImage]);

  const preview = useMemo(() => {
    let state = cups.map((cup) => cup.slice());
    for (let i = 0; i < Math.min(step, moves.length); i++) {
      const next = applyMove(state, moves[i].from, moves[i].to, CAPACITY);
      if (next) state = next.cups;
    }
    return state;
  }, [cups, moves, step]);

  const recognizedRows = useMemo(() => {
    if (!recognition || recognition.detections.length !== preview.length) return null;
    const rows: number[][] = [];
    let previousY = -1;
    recognition.detections.forEach((detection, index) => {
      if (previousY < 0 || Math.abs(detection.box.y - previousY) > 0.04) {
        rows.push([]);
        previousY = detection.box.y;
      }
      rows[rows.length - 1].push(index);
    });
    return rows;
  }, [recognition, preview.length]);

  const currentMove = step < moves.length ? moves[step] : null;
  const progress = moves.length ? Math.round((step / moves.length) * 100) : 0;

  useEffect(() => {
    if (!playing) return;
    if (step >= moves.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep((value) => Math.min(moves.length, value + 1)), speed);
    return () => window.clearTimeout(timer);
  }, [playing, step, moves.length, speed]);

  const editLayer = (cupIndex: number, level: number) => {
    resetSolution();
    setCups((old) => old.map((cup, i) => {
      if (i !== cupIndex) return cup;
      const next = cup.slice();
      if (selectedColor < 0) {
        if (level < next.length) next.splice(level);
        return next;
      }
      if (level > next.length) return next;
      if (level === next.length) next.push(selectedColor);
      else next[level] = selectedColor;
      return next;
    }));
  };

  const addCup = () => { resetSolution(); setCups((old) => [...old, []]); setRecognition(null); };
  const clear = () => {
    setCups(Array.from({ length: 14 }, () => []));
    setLocked([]);
    setPalette(DEFAULT_PALETTE);
    setSelectedColor(0);
    setRecognition(null);
    setPreviewUrl(null);
    resetSolution();
    setMessage("已创建 14 个空杯。选择颜色后从杯底开始填写；“空”可清除当前层及其上方。");
  };

  const doSolve = () => {
    setPlaying(false);
    const result = solveWithLockedCups(cups, locked, { capacity: CAPACITY, mode, maxUnlocks: locked.length, timeoutMs: mode === "fast" ? 3500 : 10000 });
    if (result.status === "solved") {
      setMoves(result.moves);
      setStep(0);
      setSolutionUnlocked(result.unlocked);
      const unlockText = result.unlocked.length ? `；需解锁杯 ${result.unlocked.map((i) => i + 1).join(", ")}` : "；无需广告杯";
      setMessage(`找到 ${result.moves.length} 步解法${unlockText}。搜索 ${result.explored.toLocaleString()} 个状态，耗时 ${result.elapsedMs.toFixed(0)} ms。`);
    } else {
      resetSolution();
      setMessage(result.reason);
    }
  };

  const jumpToStep = (value: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(moves.length, value)));
  };

  const renderCup = (cup: Cup, i: number) => <CupView key={i} cup={cup} index={i} locked={locked.includes(i) && !solutionUnlocked.includes(i)} unlockRequired={solutionUnlocked.includes(i)} selectedColor={selectedColor} palette={palette} editing={!moves.length} highlight={currentMove?.from === i ? "source" : currentMove?.to === i ? "target" : undefined} onCell={(level) => editLayer(i, level)} onToggleLock={() => { resetSolution(); setLocked((old) => old.includes(i) ? old.filter((v) => v !== i) : [...old, i]); }} />;

  return (
    <main>
      <header className="hero"><div><p className="eyebrow">WATER SORT SOLVER</p><h1>颜色分杯通用求解器</h1><p className="subtitle">截图自动识别 · 本地运行 · 优先不看广告 · 可视化逐步执行</p></div><div className="status">v0.2</div></header>
      <section className="panel upload-panel"><div><h2>截图识别</h2><p>针对当前游戏皮肤的本地 CV 识别，不调用多模态模型，也不会把截图上传到服务器。支持拖入、选择文件或直接 Ctrl+V 粘贴截图。</p></div><label className={`upload-zone ${dragging ? "dragging" : ""} ${recognizing ? "busy" : ""}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void processImage(file); }}><span>{recognizing ? "正在识别…" : "📷 上传 / 拖入截图"}</span><small>也可以直接粘贴截图</small><input type="file" accept="image/*" disabled={recognizing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void processImage(file); e.currentTarget.value = ""; }} /></label></section>
      {previewUrl && recognition && <section className="panel recognition-panel"><div className="section-head"><div><h2>识别结果</h2><p>自动框选和编号仅用于校验；真正进入 Solver 的状态显示在下方杯子编辑器。</p></div></div><ScreenshotPreview url={previewUrl} result={recognition} /></section>}
      <section className="panel">
        <div className="section-head"><div><h2>{moves.length ? "可视化执行区" : "关卡编辑器"}</h2><p>{moves.length ? "按高亮提示操作：先点“源杯”，再点“目标杯”。每完成一次实际游戏操作，就点“已完成这一步”。" : recognition ? "已从截图生成关卡。请重点检查颜色、空层和 🔒 广告杯；发现错误可直接点击修正。" : "数组方向为杯底 → 杯顶。点颜色，再点击杯中对应层。锁图标表示“看广告解锁”的灰杯。"}</p></div><div className="toolbar"><button onClick={clear}>新建关卡</button><button onClick={addCup} disabled={moves.length > 0}>+ 杯子</button></div></div>
        {!moves.length && <div className="palette" aria-label="颜色选择"><button className={`eraser ${selectedColor === -1 ? "selected" : ""}`} onClick={() => setSelectedColor(-1)} title="清除该层及其上方">空</button>{palette.map((color, i) => <button key={`${color}-${i}`} className={selectedColor === i ? "selected" : ""} style={{ background: color }} onClick={() => setSelectedColor(i)} title={`颜色 ${i + 1}`} />)}</div>}
        {moves.length > 0 && currentMove && <div className="inline-instruction"><span className="instruction-kicker">现在执行第 {step + 1} 步</span><strong><em>①</em> 点击 {currentMove.from + 1} 号杯 <b>→</b> <em>②</em> 点击 {currentMove.to + 1} 号杯</strong><span className="pour-detail"><i style={{ background: colorFor(palette, currentMove.color) }} />{currentMove.amount > 1 ? `会自动连续倒出 ${currentMove.amount} 层同色液体` : "倒出顶部 1 层液体"}</span></div>}
        {moves.length > 0 && !currentMove && <div className="inline-instruction complete-instruction"><span className="instruction-kicker">全部完成</span><strong>✓ 当前杯面应与最终状态一致</strong><span className="pour-detail">如果游戏画面一致，这一关已经解开。</span></div>}
        {recognizedRows ? <div className={`recognized-board ${moves.length ? "guide-mode" : ""}`}>{recognizedRows.map((indexes, row) => <div className="recognized-row" key={row}>{indexes.map((index) => renderCup(preview[index], index))}</div>)}</div> : <div className={`cups-grid ${moves.length ? "guide-mode" : ""}`}>{preview.map(renderCup)}</div>}
      </section>
      <section className="panel solve-panel">
        <div className="solve-controls"><label>求解目标<select value={mode} onChange={(e) => setMode(e.target.value as "fast" | "shortest")} disabled={moves.length > 0}><option value="fast">快速找到可行解</option><option value="shortest">尽量少步骤（A*）</option></select></label><button className="primary" onClick={doSolve}>{moves.length ? "重新求解" : "开始求解"}</button></div>
        <p className="message">{message}</p>
        {moves.length > 0 && <div className="solution">
          <div className="visual-guide">
            <div className="guide-topline"><div><span>执行进度</span><strong>{step} / {moves.length}</strong></div><span>{progress}%</span></div>
            <div className="progress-track" aria-label={`已完成 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
            {currentMove ? <div className="move-command">
              <div className="command-node source"><small>① 先点击</small><strong>{currentMove.from + 1} 号杯</strong><span>源杯</span></div>
              <div className="command-arrow"><i style={{ background: colorFor(palette, currentMove.color) }} /><b>→</b><small>{currentMove.amount > 1 ? `一次 ${currentMove.amount} 层` : "1 层"}</small></div>
              <div className="command-node target"><small>② 再点击</small><strong>{currentMove.to + 1} 号杯</strong><span>目标杯</span></div>
            </div> : <div className="finish-card"><strong>🎉 解法执行完成</strong><span>已走完全部 {moves.length} 步。</span></div>}
          </div>
          <div className="step-actions execution-actions">
            <button disabled={step === 0} onClick={() => jumpToStep(step - 1)}>← 上一步</button>
            <button className="play-btn" disabled={step === moves.length} onClick={() => setPlaying((value) => !value)}>{playing ? "暂停自动播放" : "▶ 自动演示"}</button>
            <label className="speed-control">速度<select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={1400}>慢</option><option value={900}>标准</option><option value={500}>快</option></select></label>
            <button className="done-step" disabled={step === moves.length} onClick={() => jumpToStep(step + 1)}>已完成这一步 →</button>
          </div>
          <div className="move-list">{moves.map((move, i) => <button key={i} className={`${step === i ? "active" : ""} ${i < step ? "completed" : ""}`} onClick={() => jumpToStep(i)}><span>{i < step ? "✓" : i + 1}</span> {move.from + 1}→{move.to + 1}</button>)}</div>
        </div>}
      </section>
    </main>
  );
}
