import { memo, useEffect, useMemo } from 'react';
import {
  Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useViewport,
  type BuiltInEdge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Emblem } from './Emblem';
import type { Rule } from './model';
import './tree-map.css';

type TreeMapProps = {
  rules: Rule[];
  selectedId: string | null;
  highlightedIds: string[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  demo?: boolean;
  canCreate?: boolean;
  hadHistory?: boolean;
};

type RulePin = Node<{ rule: Rule; current: boolean; endangered: boolean }, 'rulePin'>;
const width = 156;
const height = 107;
const xGap = 188;
const yGap = 146;
const mapFit = { padding: { x: '5%', top: 18, bottom: 40 }, maxZoom: 1.16 } as const;

function RuleNode({ data }: NodeProps<RulePin>) {
  const { rule, current, endangered } = data;
  return <div className={`atlas-pin${current ? ' atlas-pin--selected' : ''}${endangered ? ' atlas-pin--endangered' : ''}`}>
    <Handle position={Position.Top} type="target" className="atlas-port" />
    <span className="atlas-pin__device"><Emblem badge={rule.badge} size={84} /></span>
    <span className="atlas-pin__plaque"><span>{rule.title}</span></span>
    <Handle position={Position.Bottom} type="source" className="atlas-port" />
  </div>;
}

const nodeTypes = { rulePin: RuleNode };

// Assign each leaf a column, then center the parent over its outer children.
// The explicit stack also supports long, narrow trees from a backup.
function arrange(active: Rule[]) {
  const children = new Map<string | null, Rule[]>();
  for (const rule of active) {
    const siblings = children.get(rule.parentId) ?? [];
    siblings.push(rule);
    children.set(rule.parentId, siblings);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const stack = [...(children.get(null) ?? [])].reverse().map(rule => ({ rule, depth: 0, placedChildren: false }));
  let column = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    const descendants = children.get(frame.rule.id) ?? [];
    if (descendants.length && !frame.placedChildren) {
      stack.push({ ...frame, placedChildren: true });
      for (let i = descendants.length - 1; i >= 0; i--) {
        stack.push({ rule: descendants[i], depth: frame.depth + 1, placedChildren: false });
      }
      continue;
    }
    const x = descendants.length
      ? (positions.get(descendants[0].id)!.x + positions.get(descendants[descendants.length - 1].id)!.x) / 2
      : column++ * xGap;
    positions.set(frame.rule.id, { x, y: frame.depth * yGap });
  }
  return positions;
}

function link(id: string, parentId: string, highlighted: Set<string>): BuiltInEdge {
  const marked = highlighted.has(id) && highlighted.has(parentId);
  return {
    id: `to-${id}`, source: parentId, target: id, type: 'smoothstep', selectable: false,
    focusable: false, pathOptions: { borderRadius: 4, offset: 14 },
    className: marked ? 'atlas-edge atlas-edge--endangered' : 'atlas-edge',
  };
}

// Sample a relief field into isolines. Every map shares the same local, offline engraving.
function contourPlates() {
  const cols = 76, rows = 54, step = 14;
  function hill(x: number, y: number, cx: number, cy: number, sx: number, sy: number) {
    return Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  }
  function relief(x: number, y: number) {
    const nx = x + 30 * Math.sin(y * .012) + 15 * Math.sin((x + y) * .02);
    const ny = y + 29 * Math.sin(x * .009) + 7 * Math.cos((x - y) * .024);
    return 1.85 * hill(nx, ny, 1040, 160, 254, 180)
      + 1.05 * hill(nx, ny, 925, 440, 112, 213)
      + 1.45 * hill(nx, ny, 72, 665, 185, 250)
      + 1.05 * hill(nx, ny, 295, 684, 114, 116)
      + .61 * hill(nx, ny, -15, 110, 145, 152)
      + .10 * Math.sin(nx * .019 + ny * .012) * Math.cos(ny * .017);
  }
  const values = Array.from({ length: rows + 1 }, (_, y) =>
    Array.from({ length: cols + 1 }, (_, x) => relief(x * step, y * step)));
  const plates: { d: string; major: boolean }[] = [];
  for (let band = 1; band < 32; band++) {
    const level = band * .06;
    const paths: string[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const corners = [values[j][i], values[j][i + 1], values[j + 1][i + 1], values[j + 1][i]];
      const points = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const intersections: string[] = [];
      for (let c = 0; c < 4; c++) {
        const n = (c + 1) % 4;
        if ((corners[c] < level) === (corners[n] < level)) continue;
        const t = (level - corners[c]) / (corners[n] - corners[c]);
        const x = (points[c][0] + (points[n][0] - points[c][0]) * t) * step;
        const y = (points[c][1] + (points[n][1] - points[c][1]) * t) * step;
        intersections.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      for (let p = 0; p + 1 < intersections.length; p += 2) {
        paths.push(`M${intersections[p]}L${intersections[p + 1]}`);
      }
    }
    if (paths.length) plates.push({ d: paths.join(''), major: band % 5 === 0 });
  }
  return plates;
}

const contourPaths = contourPlates();

const Cartography = memo(function Cartography() {
  return <div className="atlas-paper" aria-hidden="true">
    <svg className="atlas-relief" viewBox="0 0 1064 756" preserveAspectRatio="none">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {contourPaths.map(({ d, major }, i) => <path key={i} d={d} strokeOpacity={major ? '.40' : '.24'} strokeWidth={major ? '1.3' : '.8'} />)}
      </g>
    </svg>
    <div className="atlas-graticule" />
    <div className="atlas-ticks atlas-ticks--x" /><div className="atlas-ticks atlas-ticks--y" />
    <div className="atlas-compass">
      <svg viewBox="0 0 48 66" fill="none">
        <text x="24" y="11" textAnchor="middle" fill="currentColor" fontSize="9" fontFamily="Georgia,serif">N</text>
        <circle cx="24" cy="39" r="11.8" stroke="currentColor" strokeWidth=".65" />
        <path d="m24 16 3.7 19.4L43 39l-15.3 3.6L24 63l-3.7-20.4L5 39l15.3-3.6Z" fill="#ebe5cf" stroke="currentColor" strokeWidth=".9" />
        <path d="M24 16v23l-3.7-3.6ZM43 39H24l3.7 3.6ZM24 63V39l-3.7 3.6ZM5 39h19l-3.7-3.6Z" fill="currentColor" />
        <circle cx="24" cy="39" r="1.8" fill="#e7ddbd" stroke="currentColor" strokeWidth=".7" />
      </svg>
    </div>
  </div>;
});

function Foundation({ onCreate, canCreate = true, hadHistory = false }: Pick<TreeMapProps, 'onCreate' | 'canCreate' | 'hadHistory'>) {
  const actionLabel = hadHistory ? '建立新国策' : '建立首项国策';
  return <div className="atlas-foundation">
    <div className="atlas-seal" aria-hidden="true">
      <svg viewBox="0 0 180 142" className="atlas-seal__plate" fill="none">
        <ellipse cx="90" cy="71" rx="82" ry="46" stroke="currentColor" strokeWidth=".7" strokeDasharray="2 5" />
        <circle cx="90" cy="71" r="60" stroke="currentColor" strokeWidth=".65" strokeDasharray="4 4" />
        <circle cx="90" cy="71" r="48.5" stroke="currentColor" strokeWidth=".7" />
        <path d="M90 2v13m0 113v12M10 71h14m133 0h14m-37.9-43.1 5.2-5.2m-91.5 91.5 5.2-5.2m80.6 0 5.2 5.2m-91.5-91.5 5.2 5.2" stroke="currentColor" />
        {[0, 90, 180, 270].map(rotation => <path key={rotation} d="m90 11 2.5 4-2.5 4-2.5-4Z" fill="currentColor" transform={`rotate(${rotation} 90 71)`} />)}
      </svg>
      <span><Emblem badge="standard" size={111} /></span>
    </div>
    <strong>当前没有生效国策</strong>
    <button type="button" onClick={onCreate} disabled={!canCreate}>
      {canCreate && <span aria-hidden="true">＋</span>} {canCreate ? actionLabel : '今日名额已用完'}
    </button>
  </div>;
}

function MapControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  return <div className="atlas-tools nodrag nopan" role="group" aria-label="地图视图">
    <button type="button" aria-label="缩小地图" title="缩小地图" disabled={zoom <= .081} onClick={() => void zoomOut({ duration: 160 })}>
      <svg viewBox="0 0 20 20"><path d="M4 10h12" /></svg>
    </button>
    <output aria-label="地图缩放百分比">{Math.round(zoom * 100)}%</output>
    <button type="button" aria-label="放大地图" title="放大地图" disabled={zoom >= 1.999} onClick={() => void zoomIn({ duration: 160 })}>
      <svg viewBox="0 0 20 20"><path d="M4 10h12m-6-6v12" /></svg>
    </button>
    <button type="button" className="atlas-tools__fit" aria-label="显示全图" title="显示全图" onClick={() => void fitView({ ...mapFit, duration: 220 })}>
      <svg viewBox="0 0 20 20"><path d="M3.5 7.2V3.5h3.7m5.6 0h3.7v3.7m0 5.6v3.7h-3.7m-5.6 0H3.5v-3.7" /></svg>
    </button>
  </div>;
}

function FrameChanges({ topology }: { topology: string }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!ready) return;
    const handle = requestAnimationFrame(() => { void fitView(mapFit); });
    return () => cancelAnimationFrame(handle);
  }, [ready, topology, fitView]);
  return null;
}

export default function TreeMap({ rules, selectedId, highlightedIds, onSelect, onCreate, demo = false, canCreate, hadHistory }: TreeMapProps) {
  const active = useMemo(() => rules.filter(rule => !rule.archivedAt), [rules]);
  const positions = useMemo(() => arrange(active), [active]);
  const marked = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const topology = useMemo(() => JSON.stringify(active.map(rule => [rule.id, rule.parentId])), [active]);
  const nodes: RulePin[] = active.map(rule => ({
    id: rule.id, type: 'rulePin', position: positions.get(rule.id)!, width, height,
    data: { rule, current: rule.id === selectedId, endangered: marked.has(rule.id) },
    ariaLabel: `${rule.title}${marked.has(rule.id) ? '，待撤回' : ''}`, ariaRole: 'button',
    selectable: true, focusable: true,
  }));
  const edges = active.flatMap(rule => rule.parentId ? [link(rule.id, rule.parentId, marked)] : []);
  return <section className="atlas-map" aria-label={demo ? '演习国策树地图' : '我的国策树地图'}>
    <Cartography />
    {active.length === 0 ? <Foundation onCreate={onCreate} canCreate={canCreate} hadHistory={hadHistory} /> :
      <ReactFlowProvider>
        <ReactFlow<RulePin, BuiltInEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          fitView fitViewOptions={mapFit} minZoom={.08} maxZoom={2}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
          nodesFocusable edgesFocusable={false} selectionOnDrag={false} multiSelectionKeyCode={null}
          deleteKeyCode={null} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => onSelect(node.id)}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target as HTMLElement;
            const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
            if (id) { event.preventDefault(); onSelect(id); }
          }}>
          <FrameChanges topology={topology} />
          <MapControls />
        </ReactFlow>
      </ReactFlowProvider>}
  </section>;
}
