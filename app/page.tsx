"use client";

import { useEffect, useMemo, useState } from "react";
import { applyMove, type Cup, type Move, solveWithLockedCups } from "../lib/solver";

const CAPACITY = 4;
const PALETTE = ["#7c3aed", "#2563eb", "#f43f5e", "#f59e0b", "#22c55e", "#14b8a6", "#ef4444", "#eab308", "#92400e", "#fb7185", "#0ea5e9", "#a855f7"];
const SAMPLE: Cup[] = [[0,1,0,1],[1,0,1,0],[],[]];

type CupHighlight = "source" | "target" | undefined;

function CupView({ cup, index, locked, unlockRequired, selectedColor, highlight, editing, onCell, onToggleLock }: { cup: Cup; index: number; locked: boolean; unlockRequired: boolean; selectedColor: number; highlight?: CupHighlight; editing: boolean; onCell: (level: number) => void; onToggleLock: () => void; }) {
  const display = Array.from({ length: CAPACITY }, (_, i) => cup[CAPACITY - 1 - i]);
  const label = highlight === "source" ? "① 源杯" : highlight === "target" ? "② 目标" : null;
  return (
    <div className={`cup-wrap ${locked ? "locked" : ""} ${unlockRequired ? "unlock-required" : ""} ${highlight ? `is-${highlight}` : ""}`}>
      {label && <span className={`move-badge ${highlight}`}>{label}</span>}
      <button className="lock-btn" onClick={onToggleLock} title="切换广告锁定杯" disabled={!editing}>{unlockRequired ? "🔓" : locked ? "🔒" : "○"}</button>
      <div className="cup" aria-label={`杯子 ${index + 1}`}>
        {display.map((color, visualLevel) => {
          const actualLevel = CAPACITY - 1 - visualLevel;
          return <button key={visualLevel} className="layer" disabled={!editing} onClick={() => onCell(actualLevel)} style={{ background: color === undefined ? "transparent" : PALETTE[color % PALETTE.length] }} title={editing ? (color === undefined ? `填入颜色 ${selectedColor + 1}` : "点击覆盖当前层") : `杯子 ${index + 1}`} />;
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
  const [solutionUnlocked, setSolutionUnlocked] = useState<number[]>([]);
  const [selectedColor, setSelectedColor] = useState(0);
  const [mode, setMode] = useState<"fast" | "shortest">("fast");
  const [moves, setMoves] = useState<Move[]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(900);
  const [message, setMessage] = useState("示例关卡已载入，可直接点击“求解”。");

  const resetSolution = () => {
    setMoves([]);
    setStep(0);
    setPlaying(false);
    setSolutionUnlocked([]);
  };

  const preview = useMemo(() => {
    let state = cups.map((cup) => cup.slice());
    for (let i = 0; i < Math.min(step, moves.length); i++) {
      const next = applyMove(state, moves[i].from, moves[i].to, CAPACITY);
      if (next) state = next.cups;
    }
    return state;
  }, [cups, moves, step]);

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
      while (next.length <= level) next.push(-1);
      next[level] = selectedColor;
      return normalizeCup(next);
    }));
  };

  const addCup = () => { resetSolution(); setCups((old) => [...old, []]); };
  const clear = () => {
    setCups(Array.from({ length: 14 }, () => []));
    setLocked([]);
    resetSolution();
    setMessage("已创建 14 个空杯。选择颜色后从杯底开始填写。空杯可直接保留。");
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

  return (
    <main>
      <header className="hero"><div><p className="eyebrow">WATER SORT SOLVER</p><h1>颜色分杯通用求解器</h1><p className="subtitle">本地运行 · 优先不看广告 · 自动连续倒同色液体</p></div><div className="status">v0.1</div></header>
      <section className="panel upload-panel"><div><h2>截图识别</h2><p>截图入口已经保留。v0.1 先交付求解核心与人工校正编辑器，下一迭代接入当前游戏皮肤的自动识别。</p></div><label className="upload-disabled"><span>📷 上传截图（识别器开发中）</span><input type="file" accept="image/*" disabled /></label></section>
      <section className="panel">
        <div className="section-head"><div><h2>{moves.length ? "可视化执行区" : "关卡编辑器"}</h2><p>{moves.length ? "按高亮提示操作：先点“源杯”，再点“目标杯”。每完成一次实际游戏操作，就点“已完成这一步”。" : "数组方向为杯底 → 杯顶。点颜色，再点击杯中对应层。锁图标表示“看广告解锁”的灰杯。"}</p></div><div className="toolbar"><button onClick={clear}>新建关卡</button><button onClick={addCup} disabled={moves.length > 0}>+ 杯子</button></div></div>
        {!moves.length && <div className="palette" aria-label="颜色选择">{PALETTE.map((color, i) => <button key={color} className={selectedColor === i ? "selected" : ""} style={{ background: color }} onClick={() => setSelectedColor(i)} title={`颜色 ${i + 1}`} />)}</div>}
        {moves.length > 0 && currentMove && <div className="inline-instruction"><span className="instruction-kicker">现在执行第 {step + 1} 步</span><strong><em>①</em> 点击 {currentMove.from + 1} 号杯 <b>→</b> <em>②</em> 点击 {currentMove.to + 1} 号杯</strong><span className="pour-detail"><i style={{ background: PALETTE[currentMove.color % PALETTE.length] }} />{currentMove.amount > 1 ? `会自动连续倒出 ${currentMove.amount} 层同色液体` : "倒出顶部 1 层液体"}</span></div>}
        {moves.length > 0 && !currentMove && <div className="inline-instruction complete-instruction"><span className="instruction-kicker">全部完成</span><strong>✓ 当前杯面应与最终状态一致</strong><span className="pour-detail">如果游戏画面一致，这一关已经解开。</span></div>}
        <div className={`cups-grid ${moves.length ? "guide-mode" : ""}`}>{preview.map((cup, i) => <CupView key={i} cup={cup} index={i} locked={locked.includes(i) && !solutionUnlocked.includes(i)} unlockRequired={solutionUnlocked.includes(i)} selectedColor={selectedColor} editing={!moves.length} highlight={currentMove?.from === i ? "source" : currentMove?.to === i ? "target" : undefined} onCell={(level) => editLayer(i, level)} onToggleLock={() => { resetSolution(); setLocked((old) => old.includes(i) ? old.filter((v) => v !== i) : [...old, i]); }} />)}</div>
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
              <div className="command-arrow"><i style={{ background: PALETTE[currentMove.color % PALETTE.length] }} /><b>→</b><small>{currentMove.amount > 1 ? `一次 ${currentMove.amount} 层` : "1 层"}</small></div>
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
