import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { PlcNodeData } from '../components/PLCBlockNode'
import { defaultSettingsForBlock } from './blockSettings'
import type { FlowNodeData } from './connectionValidation'
import type { FrameNodeData } from '../types/frame'

export const FLOW_SHEET_FORMAT = 'control-graph-sheet' as const
export const FLOW_SHEET_VERSION = 1

export type FlowSheetDocument = {
  format: typeof FLOW_SHEET_FORMAT
  version: number
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
}

const DEFAULT_EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  color: '#38bdf8',
} as const

const DEFAULT_EDGE_STYLE = { stroke: '#38bdf8', strokeWidth: 2 }

const ALLOWED_NODE_TYPES = new Set(['plcBlock', 'plcFrame'])

function slimNode(n: Node<FlowNodeData>): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: JSON.parse(JSON.stringify(n.data)) as unknown,
  }
  if (n.parentId) o.parentId = n.parentId
  if (n.extent) o.extent = n.extent
  if (n.style && Object.keys(n.style).length > 0) {
    o.style = JSON.parse(JSON.stringify(n.style))
  }
  return o
}

function slimEdge(e: Edge): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: e.id,
    source: e.source,
    target: e.target,
  }
  if (e.sourceHandle) o.sourceHandle = e.sourceHandle
  if (e.targetHandle) o.targetHandle = e.targetHandle
  if (e.type) o.type = e.type
  if (e.animated === false) o.animated = false
  if (e.style) o.style = JSON.parse(JSON.stringify(e.style))
  if (e.markerEnd) o.markerEnd = JSON.parse(JSON.stringify(e.markerEnd))
  return o
}

/** Pretty JSON for clipboard / file — all blocks, frames, wires. */
export function serializeFlowSheet(nodes: Node<FlowNodeData>[], edges: Edge[]): string {
  const doc: FlowSheetDocument = {
    format: FLOW_SHEET_FORMAT,
    version: FLOW_SHEET_VERSION,
    nodes: nodes.map(slimNode),
    edges: edges.map(slimEdge),
  }
  return JSON.stringify(doc, null, 2)
}

function normalizeImportedNode(raw: unknown, seenIds: Set<string>): Node<FlowNodeData> | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id || seenIds.has(o.id)) return null
  if (typeof o.type !== 'string' || !ALLOWED_NODE_TYPES.has(o.type)) return null
  if (!o.position || typeof o.position !== 'object') return null
  const pos = o.position as Record<string, unknown>
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return null
  const position = { x: pos.x, y: pos.y }

  if (o.type === 'plcFrame') {
    const d = (o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : {}) as Record<
      string,
      unknown
    >
    const data: FrameNodeData = {
      label: typeof d.label === 'string' ? d.label : 'FRAME',
    }
    const node: Node<FrameNodeData> = {
      id: o.id,
      type: 'plcFrame',
      position,
      data,
      style:
        o.style && typeof o.style === 'object' && !Array.isArray(o.style)
          ? (JSON.parse(JSON.stringify(o.style)) as Node['style'])
          : { width: 320, height: 220 },
    }
    if (typeof o.parentId === 'string' && o.parentId) node.parentId = o.parentId
    if (o.extent === 'parent') node.extent = 'parent'
    seenIds.add(o.id)
    return node as Node<FlowNodeData>
  }

  const d = (o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : {}) as Record<
    string,
    unknown
  >
  const blockType = typeof d.blockType === 'string' ? d.blockType : 'ADD'
  const label = typeof d.label === 'string' ? d.label : undefined
  const partial =
    d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings)
      ? (d.settings as Partial<PlcNodeData['settings']>)
      : undefined
  const data: PlcNodeData = {
    blockType,
    label,
    settings: { ...defaultSettingsForBlock(blockType), ...partial },
  }
  const node: Node<PlcNodeData> = {
    id: o.id,
    type: 'plcBlock',
    position,
    data,
  }
  if (typeof o.parentId === 'string' && o.parentId) node.parentId = o.parentId
  if (o.extent === 'parent') node.extent = 'parent'
  seenIds.add(o.id)
  return node as Node<FlowNodeData>
}

function normalizeImportedEdge(raw: unknown): Edge | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
    return null
  }
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
    targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
    type: typeof e.type === 'string' ? e.type : undefined,
    animated: e.animated === false ? false : true,
    style:
      e.style && typeof e.style === 'object' && !Array.isArray(e.style)
        ? (JSON.parse(JSON.stringify(e.style)) as Edge['style'])
        : DEFAULT_EDGE_STYLE,
    markerEnd:
      e.markerEnd && typeof e.markerEnd === 'object' && !Array.isArray(e.markerEnd)
        ? (JSON.parse(JSON.stringify(e.markerEnd)) as Edge['markerEnd'])
        : DEFAULT_EDGE_MARKER,
  } as Edge
}

/** Parents before children so React Flow gets a stable hierarchy. */
export function sortNodesParentBeforeChildren(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: Node<FlowNodeData>[] = []
  const placed = new Set<string>()

  function place(id: string) {
    if (placed.has(id)) return
    const n = byId.get(id)
    if (!n) return
    if (n.parentId && byId.has(n.parentId) && !placed.has(n.parentId)) {
      place(n.parentId)
    }
    placed.add(id)
    out.push(n)
  }

  for (const n of nodes) place(n.id)
  return out
}

export function parseFlowSheetJson(
  text: string,
): { ok: true; nodes: Node<FlowNodeData>[]; edges: Edge[] } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Root must be a JSON object.' }
  }
  const root = parsed as Record<string, unknown>

  let nodesRaw: unknown
  let edgesRaw: unknown

  if (root.format === FLOW_SHEET_FORMAT && root.version === FLOW_SHEET_VERSION) {
    nodesRaw = root.nodes
    edgesRaw = root.edges
  } else if (Array.isArray(root.nodes) && Array.isArray(root.edges)) {
    nodesRaw = root.nodes
    edgesRaw = root.edges
  } else {
    return {
      ok: false,
      error: `Expected "${FLOW_SHEET_FORMAT}" v${FLOW_SHEET_VERSION}, or legacy { "nodes": [], "edges": [] }.`,
    }
  }

  if (!Array.isArray(nodesRaw) || !Array.isArray(edgesRaw)) {
    return { ok: false, error: 'nodes and edges must be arrays.' }
  }

  const seenIds = new Set<string>()
  const nodes: Node<FlowNodeData>[] = []
  for (const item of nodesRaw) {
    const n = normalizeImportedNode(item, seenIds)
    if (n) nodes.push(n)
  }

  const sorted = sortNodesParentBeforeChildren(nodes)
  const idSet = new Set(sorted.map((n) => n.id))

  const edges: Edge[] = []
  for (const item of edgesRaw) {
    const e = normalizeImportedEdge(item)
    if (e && idSet.has(e.source) && idSet.has(e.target)) edges.push(e)
  }

  return { ok: true, nodes: sorted, edges }
}
