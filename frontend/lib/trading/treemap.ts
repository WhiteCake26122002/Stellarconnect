export type Rect = { x: number; y: number; w: number; h: number };

export type TreemapNode<T> = T & Rect;

function worst(row: { value: number }[], side: number) {
  if (!row.length) return Infinity;
  const s = row.reduce((n, x) => n + x.value, 0);
  const max = Math.max(...row.map((x) => x.value));
  const min = Math.min(...row.map((x) => x.value));
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

function layoutRow<T extends { value: number }>(row: T[], rect: Rect, out: TreemapNode<T>[]) {
  const s = row.reduce((n, x) => n + x.value, 0);
  const horizontal = rect.w >= rect.h;
  const side = horizontal ? rect.h : rect.w;
  const thick = s / side;
  let cursor = horizontal ? rect.y : rect.x;
  for (const item of row) {
    const span = item.value / thick;
    if (horizontal) {
      out.push({ ...item, x: rect.x, y: cursor, w: thick, h: span });
      cursor += span;
    } else {
      out.push({ ...item, x: cursor, y: rect.y, w: span, h: thick });
      cursor += span;
    }
  }
  if (horizontal) {
    rect.x += thick;
    rect.w -= thick;
  } else {
    rect.y += thick;
    rect.h -= thick;
  }
}

export function squarify<T extends { id: string; value: number }>(
  nodes: T[],
  rect: Rect,
): TreemapNode<T>[] {
  const total = nodes.reduce((n, x) => n + Math.max(0, x.value), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const area = rect.w * rect.h;
  const items = nodes
    .filter((n) => n.value > 0)
    .map((n) => ({ ...n, value: (n.value / total) * area }))
    .sort((a, b) => b.value - a.value);
  const out: TreemapNode<T>[] = [];
  const box = { ...rect };
  let row: typeof items = [];
  while (items.length) {
    const next = items[0];
    const side = Math.min(box.w, box.h);
    if (!row.length || worst(row, side) >= worst([...row, next], side)) {
      row.push(items.shift()!);
      continue;
    }
    layoutRow(row, box, out);
    row = [];
  }
  if (row.length) layoutRow(row, box, out);
  return out;
}

export function nestedTreemap<T extends { id: string; value: number; group: string }>(
  nodes: T[],
  rect: Rect,
  gap = 2,
  header = 18,
): { group: string; frame: Rect; tiles: TreemapNode<T>[] }[] {
  const grouped = new Map<string, T[]>();
  for (const node of nodes) {
    const list = grouped.get(node.group) || [];
    list.push(node);
    grouped.set(node.group, list);
  }
  const groups = [...grouped.entries()].map(([group, members]) => ({
    id: group,
    group,
    value: members.reduce((n, x) => n + x.value, 0),
    members,
  }));
  const frames = squarify(groups, rect);
  return frames.map((frame) => {
    const inner = {
      x: frame.x + gap,
      y: frame.y + gap + header,
      w: Math.max(0, frame.w - gap * 2),
      h: Math.max(0, frame.h - gap * 2 - header),
    };
    return {
      group: frame.group,
      frame,
      tiles: squarify(frame.members, inner),
    };
  });
}

export function moveWeight(changePct: number) {
  const abs = Math.abs(changePct);
  return Math.max(abs * abs, 0.000002);
}

function mix(from: [number, number, number], to: [number, number, number], t: number) {
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(from[0] + (to[0] - from[0]) * u);
  const g = Math.round(from[1] + (to[1] - from[1]) * u);
  const b = Math.round(from[2] + (to[2] - from[2]) * u);
  return `rgb(${r}, ${g}, ${b})`;
}

export function moveFill(changePct: number) {
  return signedFill(changePct);
}

export function signedFill(changePct: number) {
  if (!(Math.abs(changePct) > 0.00005)) return "#2a2418";
  const mag = Math.min(1, Math.abs(changePct) / 0.025);
  if (changePct > 0) return mix([14, 72, 52], [46, 230, 160], 0.35 + mag * 0.65);
  return mix([92, 22, 32], [240, 113, 120], 0.35 + mag * 0.65);
}
