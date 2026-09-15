export type ColorId = number;
export type Cup = ColorId[]; // bottom -> top
export type Move = { from: number; to: number; amount: number; color: ColorId };
export type SearchMode = "fast" | "shortest";

export type SolveOptions = {
  capacity?: number;
  mode?: SearchMode;
  maxNodes?: number;
  timeoutMs?: number;
};

export type SolveResult =
  | { status: "solved"; moves: Move[]; explored: number; elapsedMs: number }
  | { status: "unsolved" | "limit"; moves: []; explored: number; elapsedMs: number; reason: string };

type Node = { cups: Cup[]; moves: Move[]; g: number; f: number };

class MinHeap<T> {
  private items: { value: T; priority: number }[] = [];
  get size() { return this.items.length; }
  push(value: T, priority: number) {
    const item = { value, priority };
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].priority <= priority) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop(): T | undefined {
    if (!this.items.length) return undefined;
    const root = this.items[0].value;
    const last = this.items.pop()!;
    if (!this.items.length) return root;
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      let child = left;
      if (right < this.items.length && this.items[right].priority < this.items[left].priority) child = right;
      if (this.items[child].priority >= last.priority) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = last;
    return root;
  }
}

export function topRun(cup: Cup): { color: ColorId; count: number } | null {
  if (!cup.length) return null;
  const color = cup[cup.length - 1];
  let count = 1;
  for (let i = cup.length - 2; i >= 0 && cup[i] === color; i--) count++;
  return { color, count };
}

export function isMonochrome(cup: Cup) {
  return cup.length <= 1 || cup.every((v) => v === cup[0]);
}

export function isSolved(cups: Cup[], capacity = 4) {
  return cups.every((cup) => cup.length === 0 || (cup.length === capacity && isMonochrome(cup)));
}

export function applyMove(cups: Cup[], from: number, to: number, capacity = 4): { cups: Cup[]; move: Move } | null {
  if (from === to) return null;
  const source = cups[from];
  const target = cups[to];
  if (!source?.length || !target || target.length >= capacity) return null;
  const run = topRun(source)!;
  const targetTop = target[target.length - 1];
  if (target.length && targetTop !== run.color) return null;
  const amount = Math.min(run.count, capacity - target.length);
  if (amount <= 0) return null;
  const next = cups.map((cup) => cup.slice());
  next[from].splice(next[from].length - amount, amount);
  next[to].push(...Array(amount).fill(run.color));
  return { cups: next, move: { from, to, amount, color: run.color } };
}

function encodeCup(cup: Cup) { return cup.join("."); }
export function canonicalKey(cups: Cup[]) { return cups.map(encodeCup).sort().join("|"); }

function colorCount(cups: Cup[]) {
  const counts = new Map<number, number>();
  for (const cup of cups) for (const color of cup) counts.set(color, (counts.get(color) ?? 0) + 1);
  return counts;
}

export function validatePuzzle(cups: Cup[], capacity = 4) {
  if (!cups.length) return { ok: false as const, reason: "没有杯子" };
  if (cups.some((cup) => cup.length > capacity)) return { ok: false as const, reason: `存在超过容量 ${capacity} 的杯子` };
  if (cups.some((cup) => cup.some((color) => !Number.isInteger(color) || color < 0))) {
    return { ok: false as const, reason: "存在未填写的中间空层，请先修正杯子内容" };
  }
  const counts = colorCount(cups);
  for (const [color, count] of counts) {
    if (count % capacity !== 0) return { ok: false as const, reason: `颜色 ${color + 1} 共 ${count} 层，必须是 ${capacity} 的整数倍` };
  }
  return { ok: true as const };
}

function runCount(cup: Cup) {
  if (!cup.length) return 0;
  let runs = 1;
  for (let i = 1; i < cup.length; i++) if (cup[i] !== cup[i - 1]) runs++;
  return runs;
}

function targetCupCount(cups: Cup[], capacity: number) {
  const layers = cups.reduce((sum, cup) => sum + cup.length, 0);
  return layers / capacity;
}

function admissibleHeuristic(cups: Cup[], capacity: number) {
  const runs = cups.reduce((sum, cup) => sum + runCount(cup), 0);
  return Math.max(0, runs - targetCupCount(cups, capacity));
}

function fastHeuristic(cups: Cup[], capacity: number) {
  let score = admissibleHeuristic(cups, capacity) * 3;
  for (const cup of cups) {
    if (!cup.length) continue;
    if (cup.length === capacity && isMonochrome(cup)) score -= 2;
    else if (isMonochrome(cup)) score -= 0.4 * cup.length;
  }
  return score;
}

function movesFrom(cups: Cup[], capacity: number): { cups: Cup[]; move: Move }[] {
  const result: { cups: Cup[]; move: Move }[] = [];
  const seenEmptyDestination = new Set<string>();
  for (let from = 0; from < cups.length; from++) {
    const source = cups[from];
    if (!source.length) continue;
    if (source.length === capacity && isMonochrome(source)) continue;
    const run = topRun(source)!;
    for (let to = 0; to < cups.length; to++) {
      if (from === to) continue;
      const target = cups[to];
      if (target.length === capacity) continue;
      if (target.length && target[target.length - 1] !== run.color) continue;
      if (!target.length && isMonochrome(source)) continue;
      if (!target.length) {
        const token = `${from}:${encodeCup(source)}`;
        if (seenEmptyDestination.has(token)) continue;
        seenEmptyDestination.add(token);
      }
      const applied = applyMove(cups, from, to, capacity);
      if (applied) result.push(applied);
    }
  }
  return result;
}

export function solve(cupsInput: Cup[], options: SolveOptions = {}): SolveResult {
  const capacity = options.capacity ?? 4;
  const mode = options.mode ?? "fast";
  const maxNodes = options.maxNodes ?? (mode === "shortest" ? 350_000 : 120_000);
  const timeoutMs = options.timeoutMs ?? (mode === "shortest" ? 8_000 : 2_500);
  const started = performance.now();
  const cups = cupsInput.map((cup) => cup.slice());
  const validity = validatePuzzle(cups, capacity);
  if (!validity.ok) return { status: "unsolved", moves: [], explored: 0, elapsedMs: 0, reason: validity.reason };
  if (isSolved(cups, capacity)) return { status: "solved", moves: [], explored: 0, elapsedMs: 0 };
  const queue = new MinHeap<Node>();
  const h0 = mode === "shortest" ? admissibleHeuristic(cups, capacity) : fastHeuristic(cups, capacity);
  queue.push({ cups, moves: [], g: 0, f: h0 }, h0);
  const best = new Map<string, number>([[canonicalKey(cups), 0]]);
  let explored = 0;
  while (queue.size) {
    if (explored >= maxNodes || performance.now() - started > timeoutMs) {
      return { status: "limit", moves: [], explored, elapsedMs: performance.now() - started, reason: `搜索达到限制（${explored.toLocaleString()} 个状态）` };
    }
    const node = queue.pop()!;
    explored++;
    if (isSolved(node.cups, capacity)) return { status: "solved", moves: node.moves, explored, elapsedMs: performance.now() - started };
    for (const next of movesFrom(node.cups, capacity)) {
      const g = node.g + 1;
      const key = canonicalKey(next.cups);
      const known = best.get(key);
      if (known !== undefined && known <= g) continue;
      best.set(key, g);
      const h = mode === "shortest" ? admissibleHeuristic(next.cups, capacity) : fastHeuristic(next.cups, capacity);
      const f = mode === "shortest" ? g + h : g * 0.18 + h;
      const moves = [...node.moves, next.move];
      if (isSolved(next.cups, capacity)) return { status: "solved", moves, explored, elapsedMs: performance.now() - started };
      queue.push({ cups: next.cups, moves, g, f }, f);
    }
  }
  return { status: "unsolved", moves: [], explored, elapsedMs: performance.now() - started, reason: "未找到合法解" };
}

export type UnlockSolveResult = SolveResult & { unlocked: number[] };

function combinations<T>(items: T[], choose: number): T[][] {
  if (choose === 0) return [[]];
  if (choose > items.length) return [];
  const out: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === choose) { out.push(current.slice()); return; }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]); visit(i + 1, current); current.pop();
    }
  };
  visit(0, []);
  return out;
}

export function solveWithLockedCups(allCups: Cup[], lockedIndices: number[], options: SolveOptions & { maxUnlocks?: number } = {}): UnlockSolveResult {
  const locked = new Set(lockedIndices);
  const maxUnlocks = Math.min(options.maxUnlocks ?? lockedIndices.length, lockedIndices.length);
  for (let unlockCount = 0; unlockCount <= maxUnlocks; unlockCount++) {
    for (const unlocked of combinations(lockedIndices, unlockCount)) {
      const active = allCups.map((cup, index) => ({ cup, index })).filter(({ index }) => !locked.has(index) || unlocked.includes(index));
      const result = solve(active.map(({ cup }) => cup), options);
      if (result.status !== "solved") continue;
      const mappedMoves = result.moves.map((move) => ({ ...move, from: active[move.from].index, to: active[move.to].index }));
      return { ...result, moves: mappedMoves, unlocked };
    }
  }
  return { status: "unsolved", moves: [], explored: 0, elapsedMs: 0, reason: `在最多解锁 ${maxUnlocks} 个广告杯的条件下未找到解`, unlocked: [] };
}
