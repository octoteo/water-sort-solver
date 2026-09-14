"use client";

import { useMemo, useState } from "react";
import { applyMove, type Cup, type Move, solveWithLockedCups } from "../lib/solver";

const CAPACITY = 4;
const PALETTE = ["#7c3aed", "#2563eb", "#f43f5e", "#f59e0b", "#22c55e", "#14b8a6", "#ef4444", "#eab308", "#92400e", "#fb7185", "#0ea5e9", "#a855f7"];
const SAMPLE: Cup[] = [[0,1,0,1],[1,0,1,0],[],[]];

function CupView({ cup, index, locked, selectedColor, onCell, onToggleLock }: { cup: Cup; index: number; locked: boolean; selectedColor: number; onCell: (level: number) => void; onToggleLock: () => void; }) {
  const display = Array.from({ length: CAPACITY }, (_, i) => cup[CAPACITY - 1 - i]);
  return (
    <div className={`cup-wrap ${locked ? "locked" : ""}`}>
      <button className="lock-btn" onClick={onToggleLock} title="切换广告锁定杯">{locked ? "🔒" : "○"}</button>
      <div className="cup" aria-label={`杯子 ${index + 1}`}>
        {display.map((color, visualLevel) => {
          const actualLevel = CAPACITY - 1 - visualLevel;
          return <button key={visualLevel} className="layer" onClick={() => onCell(actualLevel)} style={{ background: color === undefined ? "transparent" : PALETTE[color % PALETTE.length] }} title={color === undefined ? `填入颜色 ${selectedColor + 1}` : "点击覆盖当前层"} />;
        })}
      </div>
      <span className="cup-index">{index + 1}</span>
    </div>
  );
}

function normalizeCup(cup: Cup) {
  const next = cup.slice(0, CAPACITY);
  while (next.length && next[next.length - 1] === -1) next.pop();
  return next;
}

export default function Home() {
  const [cups, setCups] = useState<Cup[]>(SAMPLE);
  const [locked, setLocked] = useState<number[]>([]);
  const [selectedColor, setSelectedColor] = useState(0);
  const [mode, setMode] = useState<"fast" | "shortest">("fast");
  const [moves, setMoves] = useState<Move[]>([]);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("示例关卡已载入，可直接点击“求解”。");

  const preview = useMemo(() => {
    let state = cups.map((cup) => cup.slice());
    for (let i = 0; i < Math.min(step, moves.length); i++) {
      const next = applyMove(state, moves[i].from, moves[i].to, CAPACITY);
      if (next) state = next.cups;
    }
    return state;
  }, [cups, moves, step]);

  const editLayer = (cupIndex: number, level: number) => {
    setMoves([]); setStep(0);
    setCups((old) => old.map((cup, i) => {
      if (i !== cupIndex) return cup;
      const next = cup.slice();
      while (next.length <= level) next.push(-1);
      next[level] = selectedColor;
      return normalizeCup(next);
    }));
  };

  const addCup = () => setCups((old) => [...old, []]);
  const clear = () => {
    setCups(Array.from({ length: 14 }, () => [])); setLocked([]); setMoves([]); setStep(0);
    setMessage("已创建 14 个空杯。选择颜色后从杯底开始填写。空杯可直接保留。");
  };

  const doSolve = () => {
    const result = solveWithLockedCups(cups, locked, { capacity: CAPACITY, mode, maxUnlocks: locked.length, timeoutMs: mode === "fast" ? 3500 : 10000 });
    if (result.status === "solved") {
      setMoves(result.moves); setStep(0);
      const unlockText = result.unlocked.length ? `；需解锁杯 ${result.unlocked.map((i) => i + 1).join(", ")}` : "；无需广告杯";
      setMessage(`找到 ${result.moves.length} 步解法${unlockText}。搜索 ${result.explored.toLocaleString()} 个状态，耗时 ${result.elapsedMs.toFixed(0)} ms。`);
    } else {
      setMoves([]); setMessage(result.reason);
    }
  };

  return (
    <main>
      <header className="hero"><div><p className="eyebrow">WATER SORT SOLVER</p><h1>颜色分杯通用求解器</h1><p className="subtitle">本地运行 · 优先不看广告 · 自动连续倒同色液体</p></div><div className="status">v0.1</div></header>
      <section className="panel upload-panel"><div><h2>截图识别</h2><p>截图入口已经保留。v0.1 先交付求解核心与人工校正编辑器，下一迭代接入当前游戏皮肤的自动识别。</p></div><label className="upload-disabled"><span>📷 上传截图（识别器开发中）</span><input type="file" accept="image/*" disabled /></label></section>
      <section className="panel">
        <div className="section-head"><div><h2>关卡编辑器</h2><p>数组方向为杯底 → 杯顶。点颜色，再点击杯中对应层。锁图标表示“看广告解锁”的灰杯。</p></div><div className="toolbar"><button onClick={clear}>新建关卡</button><button onClick={addCup}>+ 杯子</button></div></div>
        <div className="palette" aria-label="颜色选择">{PALETTE.map((color, i) => <button key={color} className={selectedColor === i ? "selected" : ""} style={{ background: color }} onClick={() => setSelectedColor(i)} title={`颜色 ${i + 1}`} />)}</div>
        <div className="cups-grid">{preview.map((cup, i) => <CupView key={i} cup={cup} index={i} locked={locked.includes(i)} selectedColor={selectedColor} onCell={(level) => editLayer(i, level)} onToggleLock={() => { setMoves([]); setStep(0); setLocked((old) => old.includes(i) ? old.filter((v) => v !== i) : [...old, i]); }} />)}</div>
      </section>
      <section className="panel solve-panel">
        <div className="solve-controls"><label>求解目标<select value={mode} onChange={(e) => setMode(e.target.value as "fast" | "shortest")}><option value="fast">快速找到可行解</option><option value="shortest">尽量少步骤（A*）</option></select></label><button className="primary" onClick={doSolve}>开始求解</button></div>
        <p className="message">{message}</p>
        {moves.length > 0 && <div className="solution"><div className="step-card"><span>当前步骤</span><strong>{step} / {moves.length}</strong>{step < moves.length && <b>{moves[step].from + 1} → {moves[step].to + 1}</b>}</div><div className="step-actions"><button disabled={step === 0} onClick={() => setStep((v) => Math.max(0, v - 1))}>上一步</button><button disabled={step === moves.length} onClick={() => setStep((v) => Math.min(moves.length, v + 1))}>下一步</button></div><div className="move-list">{moves.map((move, i) => <button key={i} className={step === i ? "active" : ""} onClick={() => setStep(i)}>{i + 1}. {move.from + 1}→{move.to + 1}</button>)}</div></div>}
      </section>
    </main>
  );
}
