import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type BuiltInEdge, type Node, type NodeProps, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronRight, Folder, Ellipsis } from 'lucide-react';
import { Emblem } from './Emblem';
import type { Category, Rule } from './model';
import './tree-map.css';

type TreeMapProps = {
  rules: Rule[];
  categories: Category[];
  collapsedCategories: ReadonlySet<string>;
  onCategoryFold: (id: string, closed: boolean) => void;
  selectedId: string | null;
  highlightedIds: string[];
  onSelect: (id: string) => void;
  onCategorySelect: (id: string) => void;
  onManageCategories: () => void;
  demo?: boolean;
};

type RulePin = Node<{ rule: Rule; current: boolean; endangered: boolean }, 'rulePin'>;
type CategoryPin = Node<{
  category: Category; hasRules: boolean; collapsed: boolean;
  onFold: TreeMapProps['onCategoryFold']; onDetails: TreeMapProps['onCategorySelect'];
}, 'categoryPin'>;
type RootPin = Node<Record<string, never>, 'rootPin'>;
type MapPin = RulePin | CategoryPin | RootPin;
type Branch = { node: MapPin; parentKey: string | null };
const rootKey = 'origin';
const minZoom = .0001;

// Namespaces separate stored IDs, even if a backup reuses a category ID as a rule ID.
// Escape the complete string for use in React Flow's DOM attribute selectors.
function graphKey(kind: 'rule' | 'category', id: string) {
  return `${kind}:${encodeURIComponent(JSON.stringify(id))}`;
}

function RuleNode({ data }: NodeProps<RulePin>) {
  const { rule, current, endangered } = data;
  return <div className={`atlas-pin${current ? ' atlas-pin--selected' : ''}${endangered ? ' atlas-pin--endangered' : ''}`}>
    <Handle position={Position.Top} type="target" className="atlas-port" />
    <span className="atlas-pin__device"><Emblem badge={rule.badge} size={84} /></span>
    <span className="atlas-pin__plaque"><span>{rule.title}</span></span>
    <Handle position={Position.Bottom} type="source" className="atlas-port" />
  </div>;
}

function CategoryNode({ data }: NodeProps<CategoryPin>) {
  const { category, hasRules, collapsed, onFold, onDetails } = data;
  const action = hasRules ? (collapsed ? '展开' : '收起') : '查看';
  return <div className="atlas-category">
    <Handle position={Position.Top} type="target" className="atlas-port" />
    <button type="button" className="atlas-category__main nodrag nopan"
      aria-label={'类别：' + category.name} aria-expanded={hasRules ? !collapsed : undefined}
      title={action + category.name}
      onClick={() => hasRules ? onFold(category.id, !collapsed) : onDetails(category.id)}>
      {hasRules ? <ChevronRight className="atlas-category__chevron" aria-hidden="true" /> : <Folder aria-hidden="true" />}
      <span>{category.name}</span>
    </button>
    {hasRules && <button type="button" className="atlas-category__details nodrag nopan"
      aria-label={category.name + '的类别详情'} title="类别详情" onClick={() => onDetails(category.id)}>
      <Ellipsis aria-hidden="true" />
    </button>}
    <Handle position={Position.Bottom} type="source" className="atlas-port" />
  </div>;
}

function RootNode() {
  return <div className="atlas-root" title="空根节点">
    <svg viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <path d="m21 3 17 18-17 18L4 21Z" fill="#f0e9d2" stroke="#746444" strokeWidth="1.35" />
      <path d="m21 7 13 14-13 14L8 21Z" stroke="#ac9262" strokeWidth=".9" />
      <path d="m21 13 7.5 8-7.5 8-7.5-8Z" stroke="#657252" strokeWidth="1.7" />
    </svg>
    <Handle position={Position.Bottom} type="source" className="atlas-port" />
  </div>;
}

const nodeTypes = { rulePin: RuleNode, categoryPin: CategoryNode, rootPin: RootNode };

function branchesFor(categories: Category[], active: Rule[], selectedId: string | null, marked: Set<string>,
                     collapsedCategories: ReadonlySet<string>, onFold: TreeMapProps['onCategoryFold'],
                     onDetails: TreeMapProps['onCategorySelect']): Branch[] {
  const common = { position: { x: 0, y: 0 }, selectable: true, focusable: true, ariaRole: 'button' as const };
  const branches: Branch[] = [{
    node: { ...common, id: rootKey, type: 'rootPin', width: 44, height: 44, ariaLabel: '空根节点', data: {} },
    parentKey: null,
  }];
  const occupied = new Set(active.map(rule => rule.categoryId));
  for (const category of categories) {
    const hasRules = occupied.has(category.id);
    branches.push({
      node: {
        ...common, id: graphKey('category', category.id), type: 'categoryPin',
        width: (category.name.length <= 4 ? 126 : 144) + (hasRules ? 30 : 0), height: 40,
        selectable: false, focusable: false, ariaRole: 'group',
        data: { category, hasRules, collapsed: collapsedCategories.has(category.id), onFold, onDetails },
      },
      parentKey: rootKey,
    });
  }
  for (const rule of active) {
    if (rule.categoryId !== null && collapsedCategories.has(rule.categoryId)) continue;
    const endangered = marked.has(rule.id);
    let parentKey = rootKey;
    if (rule.parentId !== null) parentKey = graphKey('rule', rule.parentId);
    else if (rule.categoryId !== null) parentKey = graphKey('category', rule.categoryId);
    branches.push({
      node: {
        ...common, id: graphKey('rule', rule.id), type: 'rulePin', width: 156, height: 107,
        data: { rule, endangered, current: rule.id === selectedId },
        ariaLabel: rule.title + (endangered ? '，待撤回' : ''),
      },
      parentKey,
    });
  }
  return branches;
}

// Assign each leaf a column, then center the parent over its outer children.
// The explicit stack also supports long, narrow trees from a backup.
function arrange(branches: Branch[]) {
  const children = new Map<string, MapPin[]>();
  let widest = 0;
  for (const { node, parentKey } of branches) {
    widest = Math.max(widest, node.width!);
    if (parentKey === null) continue;
    const siblings = children.get(parentKey) ?? [];
    siblings.push(node);
    children.set(parentKey, siblings);
  }
  const centers = new Map<string, number>();
  const stack = [{ node: branches[0].node, y: 0, placedChildren: false }];
  let column = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    const descendants = children.get(frame.node.id) ?? [];
    if (descendants.length && !frame.placedChildren) {
      stack.push({ ...frame, placedChildren: true });
      const nextY = frame.y + frame.node.height! + (frame.node.type === 'rulePin' ? 38 : 30);
      for (let i = descendants.length - 1; i >= 0; i--) {
        stack.push({ node: descendants[i], y: nextY, placedChildren: false });
      }
      continue;
    }
    const x = descendants.length
      ? (centers.get(descendants[0].id)! + centers.get(descendants[descendants.length - 1].id)!) / 2
      : column++ * (widest + 24);
    centers.set(frame.node.id, x);
    frame.node.position = { x: x - frame.node.width! / 2, y: frame.y };
  }
}

function link(id: string, parentId: string, marked: boolean): BuiltInEdge {
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

function MapControls({ initial, overview }: { initial: Viewport; overview: Viewport }) {
  const { setViewport, zoomIn, zoomOut, viewportInitialized } = useReactFlow<MapPin>();
  const { zoom } = useViewport();
  const { x, y, zoom: initialZoom } = initial;
  useLayoutEffect(() => {
    if (viewportInitialized) void setViewport({ x, y, zoom: initialZoom });
  }, [viewportInitialized, setViewport, x, y, initialZoom]);
  return <div className="atlas-tools nodrag nopan" role="group" aria-label="地图视图">
    <button type="button" aria-label="缩小地图" title="缩小地图" disabled={zoom <= minZoom} onClick={() => void zoomOut({ duration: 160 })}>
      <svg viewBox="0 0 20 20"><path d="M4 10h12" /></svg>
    </button>
    <output aria-label="地图缩放百分比">{zoom < .01 ? '<1' : Math.round(zoom * 100)}%</output>
    <button type="button" aria-label="放大地图" title="放大地图" disabled={zoom >= 1.999} onClick={() => void zoomIn({ duration: 160 })}>
      <svg viewBox="0 0 20 20"><path d="M4 10h12m-6-6v12" /></svg>
    </button>
    <button type="button" className="atlas-tools__fit" aria-label="显示全图" title="显示全图" onClick={() => void setViewport(overview, { duration: 220 })}>
      <svg viewBox="0 0 20 20"><path d="M3.5 7.2V3.5h3.7m5.6 0h3.7v3.7m0 5.6v3.7h-3.7m-5.6 0H3.5v-3.7" /></svg>
    </button>
  </div>;
}

function cameraFor(nodes: MapPin[], width: number, height: number) {
  let left = Infinity, right = -Infinity, bottom = 0;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    right = Math.max(right, node.position.x + node.width!);
    bottom = Math.max(bottom, node.position.y + node.height!);
  }
  const zoom = Math.max(minZoom, Math.min(1.16, width * .9 / (right - left), (height - 58) / bottom));
  const overview = {
    x: width / 2 - (left + right) / 2 * zoom,
    y: 18 + (height - 58 - bottom * zoom) / 2,
    zoom,
  };
  const floor = width < 600 ? .77 : .68;
  const compact = nodes.length <= 4 && nodes.every(node => node.type !== 'rulePin');
  if (compact || zoom >= floor) return { initial: overview, overview };
  const root = nodes[0];
  const rootCenter = root.position.x + root.width! / 2;
  return {
    initial: { x: width / 2 - rootCenter * floor, y: Math.max(18, (height - bottom * floor) / 2), zoom: floor },
    overview,
  };
}

export default function TreeMap({ rules, categories, collapsedCategories, onCategoryFold, selectedId, highlightedIds, onSelect, onCategorySelect, onManageCategories, demo = false }: TreeMapProps) {
  const surface = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = surface.current!;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize(old => old.width === width && old.height === height ? old : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { nodes, edges, byKey } = useMemo(() => {
    const marked = new Set(highlightedIds);
    const branches = branchesFor(categories, rules.filter(rule => !rule.archivedAt), selectedId, marked,
                                 collapsedCategories, onCategoryFold, onCategorySelect);
    arrange(branches);
    const edges: BuiltInEdge[] = [];
    for (const { node, parentKey } of branches) {
      if (parentKey === null) continue;
      const rule = node.type === 'rulePin' ? node.data.rule : null;
      const highlight = !!rule && rule.parentId !== null && marked.has(rule.id) && marked.has(rule.parentId);
      edges.push(link(node.id, parentKey, highlight));
    }
    const nodes = branches.map(branch => branch.node);
    return { nodes, edges, byKey: new Map(nodes.map(node => [node.id, node])) };
  }, [categories, rules, selectedId, highlightedIds, collapsedCategories, onCategoryFold, onCategorySelect]);
  function activate(node: MapPin) {
    if (node.type === 'rulePin') onSelect(node.data.rule.id);
    else if (node.type === 'rootPin') onManageCategories();
  }
  const camera = cameraFor(nodes, size.width, size.height);
  return <section ref={surface} className="atlas-map" aria-label={demo ? '演习国策树地图' : '我的国策树地图'}>
    <Cartography />
    {size.width > 0 && size.height > 0 &&
      <ReactFlowProvider>
        <ReactFlow<MapPin, BuiltInEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultViewport={camera.initial}
          minZoom={minZoom} maxZoom={2}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
          nodesFocusable edgesFocusable={false} selectionOnDrag={false} multiSelectionKeyCode={null}
          deleteKeyCode={null} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => activate(node)}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target as HTMLElement;
            if (target.closest('button')) return;
            const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
            const node = id && byKey.get(id);
            if (node) { event.preventDefault(); activate(node); }
          }}>
          <MapControls initial={camera.initial} overview={camera.overview} />
        </ReactFlow>
      </ReactFlowProvider>}
  </section>;
}
