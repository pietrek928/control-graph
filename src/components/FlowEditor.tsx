import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  reconnectEdge,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBlockDefinition } from '../data/blockDefinitions'
import {
  DEFAULT_ALARMS_SHEET_ID,
  DEFAULT_MAIN_SHEET_ID,
  defaultAlarmsSheetEdges,
  defaultAlarmsSheetNodes,
  defaultFlowEdgeArrow,
  defaultFlowEdges,
  defaultFlowEdgeStyle,
  defaultFlowNodes,
} from '../data/defaultFlowGraph'
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts'
import { useNodeReparenting } from '../hooks/useNodeReparenting'
import { useSelectionController } from '../hooks/useSelectionController'
import { nodeTypes } from '../nodeTypes'
import type { FlowNodeData } from '../utils/connectionValidation'
import { pickParentFrameAtPoint } from '../utils/frameHitTest'
import { defaultSettingsForBlock, type SettingsRecord } from '../utils/blockSettings'
import {
  blockPairProximityPenalty,
  backwardDirectionPenalty,
  connectionLengthPenalties,
  fallbackNodeSize,
  layoutObjectiveScore,
  lowXDistancePenalty,
  preferredNeighborDistance,
  readNumericStyleSize,
  segmentIntersectsRect,
  segmentsIntersect,
} from '../utils/layoutMetrics'
import { BlockSettingsModal } from './BlockSettingsModal'
import type { PlcNodeData } from './PLCBlockNode'
import type { FrameNodeData } from '../types/frame'
import {
  inputAlreadyConnected,
  isValidTypedConnection,
} from '../utils/connectionValidation'
import {
  parseFlowProjectJson,
  serializeFlowProject,
  type FlowProjectSheet,
} from '../utils/flowSheetJson'
import { DND_MIME } from './BlockPalette'
import './FlowEditor.css'

const defaultViewport = { x: 0, y: 0, zoom: 1 }

function makeNodeId() {
  return `n-${crypto.randomUUID().slice(0, 8)}`
}

type UndoSnapshot = {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
  selectedIds: string[]
}

const DEFAULT_SHEET_ID = DEFAULT_MAIN_SHEET_ID

function makeSheetId() {
  return `sheet-${crypto.randomUUID().slice(0, 8)}`
}

function parsePortSpecArray(raw: unknown): Array<{ id: string; label: string; type: string }> {
  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item, idx) => {
        const idRaw = typeof item.id === 'string' ? item.id : `p${idx}`
        const id = idRaw.replace(/[^a-zA-Z0-9_]/g, '') || `p${idx}`
        const label = typeof item.label === 'string' && item.label.trim() ? item.label : id
        const type = typeof item.type === 'string' && item.type.trim() ? item.type.toUpperCase() : 'BOOL'
        return { id, label, type }
      })
  } catch {
    return []
  }
}

function inferSheetInterfacePorts(nodes: Node<FlowNodeData>[]) {
  const inputs: Array<{ id: string; label: string; type: string }> = []
  const outputs: Array<{ id: string; label: string; type: string }> = []
  for (const node of nodes) {
    if (node.type !== 'plcBlock') continue
    const data = node.data as PlcNodeData
    if (data.blockType === 'INPUT') {
      const id = String(data.settings?.tag ?? data.label ?? node.id)
      inputs.push({ id, label: data.label ?? id, type: 'REAL' })
    } else if (data.blockType === 'OUTPUT') {
      const id = String(data.settings?.tag ?? data.label ?? node.id)
      outputs.push({ id, label: data.label ?? id, type: 'REAL' })
    }
  }
  if (!inputs.length) inputs.push({ id: 'in0', label: 'IN0', type: 'BOOL' })
  if (!outputs.length) outputs.push({ id: 'out0', label: 'OUT0', type: 'BOOL' })
  return {
    inputsJson: JSON.stringify(inputs, null, 2),
    outputsJson: JSON.stringify(outputs, null, 2),
  }
}

function createDefaultProjectSheets(): FlowProjectSheet[] {
  return [
    {
      id: DEFAULT_MAIN_SHEET_ID,
      name: 'Main',
      nodes: defaultFlowNodes,
      edges: defaultFlowEdges,
    },
    {
      id: DEFAULT_ALARMS_SHEET_ID,
      name: 'Alarms',
      nodes: defaultAlarmsSheetNodes,
      edges: defaultAlarmsSheetEdges,
    },
  ]
}

function createEmptyProjectSheet(name: string): FlowProjectSheet {
  const id = makeSheetId()
  const inputNodeId = `n-sheet-input-${id.slice(-4)}`
  const outputNodeId = `n-sheet-output-${id.slice(-4)}`
  return {
    id,
    name,
    nodes: [
      {
        id: inputNodeId,
        type: 'plcBlock',
        position: { x: 140, y: 180 },
        data: {
          blockType: 'INPUT',
          label: 'IN',
          settings: defaultSettingsForBlock('INPUT'),
        },
      },
      {
        id: outputNodeId,
        type: 'plcBlock',
        position: { x: 480, y: 180 },
        data: {
          blockType: 'OUTPUT',
          label: 'OUT',
          settings: defaultSettingsForBlock('OUTPUT'),
        },
      },
    ],
    edges: [],
  }
}

function FlowCanvas() {
  const [projectSheets, setProjectSheets] = useState<FlowProjectSheet[]>(() =>
    createDefaultProjectSheets(),
  )
  const [activeSheetId, setActiveSheetId] = useState<string>(DEFAULT_SHEET_ID)
  const activeSheet = useMemo(
    () => projectSheets.find((s) => s.id === activeSheetId) ?? projectSheets[0],
    [projectSheets, activeSheetId],
  )
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>(activeSheet?.nodes ?? defaultFlowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(activeSheet?.edges ?? defaultFlowEdges)
  const [status, setStatus] = useState<string | null>(null)
  const [settingsModalNodeId, setSettingsModalNodeId] = useState<string | null>(null)
  const [sheetImportOpen, setSheetImportOpen] = useState(false)
  const [sheetImportText, setSheetImportText] = useState('')
  const [newSheetName, setNewSheetName] = useState('')
  const [showLayoutDebug, setShowLayoutDebug] = useState(false)
  const [layoutRunning, setLayoutRunning] = useState(false)
  const [layoutElapsedMs, setLayoutElapsedMs] = useState(0)
  const layoutStartedAtRef = useRef<number>(0)
  const statusClearRef = useRef<number>(0)
  const reconnectingEdgeIdRef = useRef<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const undoStackRef = useRef<UndoSnapshot[]>([])
  const lastSnapshotRef = useRef<UndoSnapshot | null>(null)
  const lastSnapshotKeyRef = useRef<string | null>(null)
  const isApplyingUndoRef = useRef(false)
  const isSwitchingSheetRef = useRef(false)

  const showStatus = useCallback((msg: string) => {
    setStatus(msg)
    window.clearTimeout(statusClearRef.current)
    statusClearRef.current = window.setTimeout(() => setStatus(null), 3200)
  }, [])

  useEffect(() => {
    if (!layoutRunning) {
      setLayoutElapsedMs(0)
      return
    }
    layoutStartedAtRef.current = performance.now()
    setLayoutElapsedMs(0)
    const id = window.setInterval(() => {
      setLayoutElapsedMs(performance.now() - layoutStartedAtRef.current)
    }, 100)
    return () => window.clearInterval(id)
  }, [layoutRunning])

  const { screenToFlowPosition, getNodes, getEdges, getInternalNode, fitView } = useReactFlow()

  const {
    selectedIds,
    setSelectedIds,
    renderedNodes,
    selectionCount,
    shiftHeld,
    setShiftHeld,
    selectionBox,
    showSelectionDebug,
    setShowSelectionDebug,
    preBoxDebugCount,
    onNodeClickSelect,
    onPaneClickClearSelection,
    handleCanvasMouseDownCapture,
    handleCanvasMouseDown,
    handleCanvasContextMenu,
  } = useSelectionController({
    nodes,
    setNodes,
    getNodes: () => getNodes() as Node<FlowNodeData>[],
    getInternalNode,
    screenToFlowPosition,
  })

  useEffect(() => {
    if (!activeSheet) return
    isSwitchingSheetRef.current = true
    setNodes(activeSheet.nodes)
    setEdges(activeSheet.edges)
    setSelectedIds(new Set())
    queueMicrotask(() => {
      isSwitchingSheetRef.current = false
    })
  }, [activeSheet?.id, setNodes, setEdges, setSelectedIds])

  useEffect(() => {
    if (!activeSheet || isSwitchingSheetRef.current) return
    setProjectSheets((prev) =>
      prev.map((sheet) =>
        sheet.id === activeSheet.id
          ? {
              ...sheet,
              nodes,
              edges,
            }
          : sheet,
      ),
    )
  }, [nodes, edges, activeSheet?.id])

  useEffect(() => {
    setProjectSheets((prev) => {
      const byId = new Map(prev.map((sheet) => [sheet.id, sheet] as const))
      let changed = false
      const next = prev.map((sheet) => {
        let sheetChanged = false
        const nextNodes = sheet.nodes.map((node) => {
          if (node.type !== 'plcBlock') return node
          const data = node.data as PlcNodeData
          if (data.blockType !== 'SHEET') return node
          const targetSheetId = String(data.settings?.sheetId ?? '').trim()
          if (!targetSheetId || targetSheetId === sheet.id) return node
          const targetSheet = byId.get(targetSheetId)
          if (!targetSheet) return node
          const inferred = inferSheetInterfacePorts(targetSheet.nodes)
          const currentInputs = parsePortSpecArray(data.settings?.inputsSpec)
          const currentOutputs = parsePortSpecArray(data.settings?.outputsSpec)
          const inferredInputs = parsePortSpecArray(inferred.inputsJson)
          const inferredOutputs = parsePortSpecArray(inferred.outputsJson)
          const inputsSame = JSON.stringify(currentInputs) === JSON.stringify(inferredInputs)
          const outputsSame = JSON.stringify(currentOutputs) === JSON.stringify(inferredOutputs)
          const labelMatchesSheet = data.label === targetSheet.name
          if (inputsSame && outputsSame && labelMatchesSheet) return node
          sheetChanged = true
          changed = true
          return {
            ...node,
            data: {
              ...data,
              label: targetSheet.name,
              settings: {
                ...data.settings,
                inputsSpec: inferred.inputsJson,
                outputsSpec: inferred.outputsJson,
              },
            },
          } as Node<FlowNodeData>
        })
        if (!sheetChanged) return sheet
        return { ...sheet, nodes: nextNodes }
      })
      return changed ? next : prev
    })
  }, [projectSheets])

  const renderedNodesWithOverlapState = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n] as const))
    const frameRects = nodes
      .filter((n) => n.type === 'plcFrame')
      .map((n) => {
        const internal = getInternalNode(n.id)
        const abs = internal?.internals.positionAbsolute ?? n.position
        const styleWidth =
          n.style && typeof n.style.width === 'number' ? n.style.width : undefined
        const styleHeight =
          n.style && typeof n.style.height === 'number' ? n.style.height : undefined
        const w = internal?.measured.width ?? styleWidth ?? 320
        const h = internal?.measured.height ?? styleHeight ?? 220
        return { id: n.id, left: abs.x, top: abs.y, right: abs.x + w, bottom: abs.y + h }
      })

    const logicallyInsideFrame = (node: Node<FlowNodeData>, frameId: string) => {
      let parentId = node.parentId
      while (parentId) {
        if (parentId === frameId) return true
        parentId = byId.get(parentId)?.parentId
      }
      return false
    }

    const intersects = (
      a: { left: number; top: number; right: number; bottom: number },
      b: { left: number; top: number; right: number; bottom: number },
    ) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

    const conflictIds = new Set<string>()
    for (const n of nodes) {
      if (n.type !== 'plcBlock') continue
      const internal = getInternalNode(n.id)
      const abs = internal?.internals.positionAbsolute ?? n.position
      const w = internal?.measured.width ?? 112
      const h = internal?.measured.height ?? 78
      const rect = { left: abs.x, top: abs.y, right: abs.x + w, bottom: abs.y + h }

      for (const frame of frameRects) {
        if (!intersects(rect, frame)) continue
        if (logicallyInsideFrame(n, frame.id)) continue
        conflictIds.add(n.id)
        break
      }
    }

    return renderedNodes.map((n) => {
      const hasConflict = conflictIds.has(n.id)
      const baseClass = n.className ?? ''
      const nextClass = hasConflict
        ? `${baseClass} node-intersection-invalid`.trim()
        : baseClass.replace(/\bnode-intersection-invalid\b/g, '').trim()
      return nextClass === baseClass ? n : { ...n, className: nextClass }
    })
  }, [nodes, renderedNodes, getInternalNode])

  const liveLayoutMetrics = useMemo(() => {
    if (!showLayoutDebug || selectedIds.size < 2) return null
    const selected = nodes.filter((n) => selectedIds.has(n.id))
    if (selected.length < 2) return null
    const selectedSet = new Set(selected.map((n) => n.id))
    const selectedTypeById = new Map(selected.map((n) => [n.id, n.type] as const))
    const selectedById = new Map(selected.map((n) => [n.id, n] as const))
    const geometry = new Map<string, { cx: number; cy: number; left: number; top: number; right: number; bottom: number }>()

    for (const n of selected) {
      const internal = getInternalNode(n.id)
      const abs = internal?.internals.positionAbsolute ?? n.position
      const styleWidth = readNumericStyleSize(n.style?.width as string | number | undefined)
      const styleHeight = readNumericStyleSize(n.style?.height as string | number | undefined)
      const fallback = fallbackNodeSize(n.type)
      const width = Math.max(fallback.width, internal?.measured.width ?? 0, internal?.width ?? 0, styleWidth ?? 0)
      const height = Math.max(
        fallback.height,
        internal?.measured.height ?? 0,
        internal?.height ?? 0,
        styleHeight ?? 0,
      )
      geometry.set(n.id, {
        cx: abs.x + width / 2,
        cy: abs.y + height / 2,
        left: abs.x,
        top: abs.y,
        right: abs.x + width,
        bottom: abs.y + height,
      })
    }

    let minLeft = Number.POSITIVE_INFINITY
    let minTop = Number.POSITIVE_INFINITY
    let maxRight = Number.NEGATIVE_INFINITY
    let maxBottom = Number.NEGATIVE_INFINITY
    for (const g of geometry.values()) {
      minLeft = Math.min(minLeft, g.left)
      minTop = Math.min(minTop, g.top)
      maxRight = Math.max(maxRight, g.right)
      maxBottom = Math.max(maxBottom, g.bottom)
    }
    const area =
      Number.isFinite(minLeft) && Number.isFinite(minTop)
        ? Math.max(1, maxRight - minLeft) * Math.max(1, maxBottom - minTop)
        : 0

    const edgeSegs: Array<{ source: string; target: string; s: { x: number; y: number }; t: { x: number; y: number } }> = []
    let wireLength = 0
    let farPenalty = 0
    let shortPenalty = 0
    let lowXPenalty = 0
    let backwardPenalty = 0
    const blockRects = new Map<
      string,
      { left: number; top: number; right: number; bottom: number; parentId: string | null }
    >()
    for (const e of edges) {
      if (!selectedSet.has(e.source) || !selectedSet.has(e.target)) continue
      if (
        selectedTypeById.get(e.source) !== 'plcBlock' ||
        selectedTypeById.get(e.target) !== 'plcBlock'
      ) {
        continue
      }
      const source = geometry.get(e.source)
      const target = geometry.get(e.target)
      if (!source || !target) continue
      const dist = Math.hypot(source.cx - target.cx, source.cy - target.cy)
      wireLength += dist
      const srcW = source.right - source.left
      const tgtW = target.right - target.left
      const preferred = preferredNeighborDistance(srcW, tgtW, 48)
      const penalties = connectionLengthPenalties(dist, preferred)
      farPenalty += penalties.farPenalty
      shortPenalty += penalties.shortPenalty
      lowXPenalty += lowXDistancePenalty(Math.abs(source.cx - target.cx), preferred)
      backwardPenalty += backwardDirectionPenalty(target.cx - source.cx, preferred)
      edgeSegs.push({
        source: e.source,
        target: e.target,
        s: { x: source.cx, y: source.cy },
        t: { x: target.cx, y: target.cy },
      })
    }
    for (const n of selected) {
      if (n.type !== 'plcBlock') continue
      const g = geometry.get(n.id)
      if (!g) continue
      blockRects.set(n.id, {
        left: g.left,
        top: g.top,
        right: g.right,
        bottom: g.bottom,
        parentId: n.parentId ?? null,
      })
    }

    let crossings = 0
    for (let i = 0; i < edgeSegs.length; i += 1) {
      for (let j = i + 1; j < edgeSegs.length; j += 1) {
        const a = edgeSegs[i]
        const b = edgeSegs[j]
        if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) {
          continue
        }
        if (segmentsIntersect(a.s, a.t, b.s, b.t)) crossings += 1
      }
    }
    let lineBlockIntersectionCount = 0
    for (const seg of edgeSegs) {
      for (const [id, rect] of blockRects.entries()) {
        if (id === seg.source || id === seg.target) continue
        if (segmentIntersectsRect(seg.s, seg.t, rect)) lineBlockIntersectionCount += 1
      }
    }

    let overlapCount = 0
    let overlapArea = 0
    let blockProximityPenalty = 0
    const rectList = [...blockRects.values()]
    for (let i = 0; i < rectList.length; i += 1) {
      for (let j = i + 1; j < rectList.length; j += 1) {
        const a = rectList[i]
        const b = rectList[j]
        const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapW > 0 && overlapH > 0) {
          overlapCount += 1
          overlapArea += overlapW * overlapH
        } else if (a.parentId === b.parentId) {
          const gapX = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
          const gapY = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
          blockProximityPenalty += blockPairProximityPenalty(gapX, gapY)
        }
      }
    }

    const selectedFrames = selected
      .filter((n) => n.type === 'plcFrame')
      .map((n) => {
        const g = geometry.get(n.id)
        if (!g) return null
        return { id: n.id, left: g.left, top: g.top, right: g.right, bottom: g.bottom }
      })
      .filter(
        (f): f is { id: string; left: number; top: number; right: number; bottom: number } =>
          Boolean(f),
      )
    const isDescendantOf = (nodeId: string, frameId: string) => {
      let parentId = selectedById.get(nodeId)?.parentId
      while (parentId) {
        if (parentId === frameId) return true
        parentId = selectedById.get(parentId)?.parentId
      }
      return false
    }
    let frameConflictCount = 0
    let frameConflictArea = 0
    for (const n of selected) {
      if (n.type !== 'plcBlock') continue
      const g = geometry.get(n.id)
      if (!g) continue
      for (const f of selectedFrames) {
        if (isDescendantOf(n.id, f.id)) continue
        const overlapW = Math.min(g.right, f.right) - Math.max(g.left, f.left)
        const overlapH = Math.min(g.bottom, f.bottom) - Math.max(g.top, f.top)
        if (overlapW > 0 && overlapH > 0) {
          frameConflictCount += 1
          frameConflictArea += overlapW * overlapH
        }
      }
    }

    const score = layoutObjectiveScore(
      crossings,
      wireLength,
      area,
      overlapCount,
      overlapArea,
      lineBlockIntersectionCount,
      farPenalty,
      shortPenalty,
      lowXPenalty,
      backwardPenalty,
      blockProximityPenalty,
      frameConflictCount,
      frameConflictArea,
    )
    return {
      score,
      crossings,
      wireLength,
      area,
      overlapCount,
      lineBlockIntersectionCount,
      farPenalty,
      shortPenalty,
      lowXPenalty,
      backwardPenalty,
      blockProximityPenalty,
      frameConflictCount,
    }
  }, [showLayoutDebug, selectedIds, nodes, edges, getInternalNode])

  const makeUndoSnapshot = useCallback(
    (ns: Node<FlowNodeData>[], es: Edge[], sel: Set<string>): UndoSnapshot => ({
      nodes: structuredClone(ns),
      edges: structuredClone(es),
      selectedIds: [...sel].sort(),
    }),
    [],
  )

  useEffect(() => {
    const snapshot = makeUndoSnapshot(nodes, edges, selectedIds)
    const key = JSON.stringify(snapshot)
    if (lastSnapshotKeyRef.current === null) {
      lastSnapshotRef.current = snapshot
      lastSnapshotKeyRef.current = key
      return
    }
    if (lastSnapshotKeyRef.current === key) return

    if (isApplyingUndoRef.current) {
      isApplyingUndoRef.current = false
    } else if (lastSnapshotRef.current) {
      const nextUndo = undoStackRef.current.concat(lastSnapshotRef.current)
      // Keep bounded history to avoid unbounded memory growth.
      undoStackRef.current = nextUndo.length > 100 ? nextUndo.slice(nextUndo.length - 100) : nextUndo
    }

    lastSnapshotRef.current = snapshot
    lastSnapshotKeyRef.current = key
  }, [nodes, edges, selectedIds, makeUndoSnapshot])

  const undoLastOperation = useCallback(() => {
    const prev = undoStackRef.current.pop()
    if (!prev) {
      showStatus('Nothing to undo.')
      return false
    }
    isApplyingUndoRef.current = true
    setNodes(structuredClone(prev.nodes))
    setEdges(structuredClone(prev.edges))
    setSelectedIds(new Set(prev.selectedIds))
    showStatus('Undo applied.')
    return true
  }, [setNodes, setEdges, setSelectedIds, showStatus])

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const list = getNodes() as Node<FlowNodeData>[]
      if (!isValidTypedConnection(connection, list)) {
        return false
      }
      const eds = getEdges()
      const exclude =
        reconnectingEdgeIdRef.current === null ? undefined : reconnectingEdgeIdRef.current
      if (
        connection.target &&
        inputAlreadyConnected(eds, connection.target, connection.targetHandle ?? null, exclude)
      ) {
        return false
      }
      return true
    },
    [getNodes, getEdges],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      const list = getNodes() as Node<FlowNodeData>[]
      if (!isValidTypedConnection(params, list)) {
        showStatus('Invalid wire: port types must match.')
        return
      }
      if (
        params.target &&
        inputAlreadyConnected(getEdges(), params.target, params.targetHandle ?? null)
      ) {
        showStatus('That input is already connected.')
        return
      }
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
              style: defaultFlowEdgeStyle,
              markerEnd: defaultFlowEdgeArrow,
          },
          eds,
        ),
      )
    },
    [getNodes, getEdges, setEdges, showStatus],
  )

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const list = getNodes() as Node<FlowNodeData>[]
      if (!isValidTypedConnection(newConnection, list)) {
        showStatus('Invalid reconnect: port types must match.')
        return
      }
      const eds = getEdges()
      if (
        newConnection.target &&
        inputAlreadyConnected(
          eds,
          newConnection.target,
          newConnection.targetHandle ?? null,
          oldEdge.id,
        )
      ) {
        showStatus('That input is already connected.')
        return
      }
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els))
    },
    [getNodes, getEdges, setEdges, showStatus],
  )

  const onReconnectStart = useCallback((_event: ReactMouseEvent, edge: Edge) => {
    reconnectingEdgeIdRef.current = edge.id
  }, [])

  const onReconnectEnd = useCallback(() => {
    reconnectingEdgeIdRef.current = null
  }, [])

  const onNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node<FlowNodeData>) => {
      if (node.type !== 'plcBlock') return
      const data = node.data as PlcNodeData
      const def = getBlockDefinition(data.blockType)
      if (!def?.settingsFields?.length) {
        showStatus('This block has no settings — double-click CODE, PID, INPUT, or OUTPUT.')
        return
      }
      setSettingsModalNodeId(node.id)
    },
    [showStatus],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      const structural = changes.filter((c) => c.type !== 'select')
      if (structural.length) {
        setNodes((curr) => applyNodeChanges(structural, curr))
      }
      const removed = changes
        .filter((c) => c.type === 'remove')
        .map((c) => c.id)
      if (removed.length) {
        setSelectedIds((curr) => {
          const next = new Set(curr)
          for (const id of removed) next.delete(id)
          return next
        })
      }
    },
    [setNodes, setSelectedIds],
  )

  const onApplySettings = useCallback(
    (nodeId: string, settings: SettingsRecord) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId || n.type !== 'plcBlock') return n
          const prev = n.data as PlcNodeData
          return { ...n, data: { ...prev, settings } }
        }),
      )
    },
    [setNodes],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const blockType = e.dataTransfer.getData(DND_MIME)
      if (!blockType) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const currentNodes = getNodes() as Node<FlowNodeData>[]
      const parentId = pickParentFrameAtPoint(currentNodes, pos, getInternalNode)
      let position = pos
      if (parentId) {
        const pAbs = getInternalNode(parentId)?.internals.positionAbsolute
        if (pAbs) position = { x: pos.x - pAbs.x, y: pos.y - pAbs.y }
      }

      if (blockType === 'FRAME') {
        const frameNode: Node<FrameNodeData> = {
          id: makeNodeId(),
          type: 'plcFrame',
          position,
          style: { width: 320, height: 220 },
          data: { label: 'FRAME' },
          ...(parentId ? { parentId, extent: 'parent' as const } : {}),
        }
        setNodes((nds) => [...nds, frameNode])
        return
      }

      const def = getBlockDefinition(blockType)
      let settings = defaultSettingsForBlock(blockType)
      let initialLabel = def?.label ?? blockType
      if (blockType === 'SHEET') {
        const target = projectSheets.find((s) => s.id !== activeSheetId)
        if (target) {
          const inferred = inferSheetInterfacePorts(target.nodes)
          settings = {
            ...settings,
            sheetId: target.id,
            inputsSpec: inferred.inputsJson,
            outputsSpec: inferred.outputsJson,
          }
          initialLabel = target.name
        }
      }
      const node: Node<PlcNodeData> = {
        id: makeNodeId(),
        type: 'plcBlock',
        position,
        data: {
          blockType,
          label: initialLabel,
          settings,
        },
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      }
      setNodes((nds) => [...nds, node])
    },
    [activeSheetId, getInternalNode, getNodes, projectSheets, screenToFlowPosition, setNodes],
  )

  const handleCopyFlowSheet = useCallback(async () => {
    try {
      const mergedSheets = projectSheets.map((sheet) =>
        sheet.id === activeSheetId
          ? {
              ...sheet,
              nodes,
              edges,
            }
          : sheet,
      )
      const text = serializeFlowProject(mergedSheets, activeSheetId)
      await navigator.clipboard.writeText(text)
      showStatus(`Copied project JSON (${mergedSheets.length} sheet(s)).`)
    } catch {
      showStatus('Could not copy project — check clipboard permission.')
    }
  }, [projectSheets, activeSheetId, nodes, edges, showStatus])

  const handleLoadFlowSheet = useCallback(() => {
    const result = parseFlowProjectJson(sheetImportText)
    if (!result.ok) {
      showStatus(`Project JSON: ${result.error}`)
      return
    }
    setProjectSheets(result.sheets)
    setActiveSheetId(result.activeSheetId)
    const loaded = result.sheets.find((sheet) => sheet.id === result.activeSheetId) ?? result.sheets[0]
    isSwitchingSheetRef.current = true
    setNodes(loaded.nodes)
    setEdges(loaded.edges)
    setSelectedIds(new Set())
    queueMicrotask(() => {
      isSwitchingSheetRef.current = false
      fitView({ padding: 0.2 })
    })
    setSettingsModalNodeId(null)
    setSheetImportOpen(false)
    setSheetImportText('')
    showStatus(
      `Loaded project (${result.sheets.length} sheet(s)); active "${loaded.name}" (${loaded.nodes.length} nodes, ${loaded.edges.length} edges).`,
    )
  }, [sheetImportText, setNodes, setEdges, setSelectedIds, showStatus, fitView])

  const handleAddSheet = useCallback(() => {
    const baseName = newSheetName.trim() || `Sheet ${projectSheets.length + 1}`
    const next = createEmptyProjectSheet(baseName)
    setProjectSheets((prev) => [...prev, next])
    setActiveSheetId(next.id)
    setNewSheetName('')
    showStatus(`Added sheet "${next.name}".`)
  }, [newSheetName, projectSheets.length, showStatus])

  const handleDeleteActiveSheet = useCallback(() => {
    if (projectSheets.length <= 1) {
      showStatus('Project must keep at least one sheet.')
      return
    }
    const idx = projectSheets.findIndex((s) => s.id === activeSheetId)
    const removed = projectSheets[idx]
    const remaining = projectSheets.filter((s) => s.id !== activeSheetId)
    const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0]
    setProjectSheets(remaining)
    setActiveSheetId(fallback.id)
    showStatus(`Removed sheet "${removed?.name ?? activeSheetId}".`)
  }, [projectSheets, activeSheetId, showStatus])

  const { onNodeDragStart, onNodeDragStop } = useNodeReparenting({ setNodes, getInternalNode })

  const { handleCanvasKeyDown, handleCanvasKeyUp } = useCanvasShortcuts({
    nodes,
    edges,
    selectedIds,
    setNodes,
    setEdges,
    setSelectedIds,
    setShiftHeld,
    getInternalNode,
    getPasteFlowPosition: () => {
      const p = lastPointerClientRef.current
      return p ? screenToFlowPosition(p) : null
    },
    undoLastOperation,
    layoutDebug: showLayoutDebug,
    showStatus,
    setLayoutRunning,
    makeNodeId,
  })

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="flow-wrap"
      onKeyDown={handleCanvasKeyDown}
      onKeyUp={handleCanvasKeyUp}
      onBlur={() => setShiftHeld(false)}
      onMouseDownCapture={handleCanvasMouseDownCapture}
      onMouseDown={(e) => {
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
        wrapRef.current?.focus()
        handleCanvasMouseDown(e)
      }}
      onMouseMove={(e) => {
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
      }}
      onContextMenu={handleCanvasContextMenu}
    >
      <ReactFlow
        nodes={renderedNodesWithOverlapState}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClickSelect}
        onPaneClick={onPaneClickClearSelection}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultViewport={defaultViewport}
        multiSelectionKeyCode={['Shift']}
        selectionKeyCode={['Shift']}
        selectionOnDrag={false}
        selectNodesOnDrag={false}
        elementsSelectable={false}
        nodesDraggable={!shiftHeld && !layoutRunning}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Backspace', 'Delete']}
        isValidConnection={isValidConnection}
        connectionRadius={28}
        edgesReconnectable
        reconnectRadius={16}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onNodeDoubleClick={onNodeDoubleClick}
        defaultMarkerColor="#38bdf8"
        defaultEdgeOptions={{
          animated: true,
          style: defaultFlowEdgeStyle,
          markerEnd: defaultFlowEdgeArrow,
        }}
      >
        <Background gap={20} size={1} color="rgba(148,163,184,0.15)" />
        <Controls className="flow-controls" showInteractive={false} />
        <MiniMap
          className="flow-minimap"
          zoomable
          pannable
          nodeStrokeWidth={3}
          maskColor="rgba(15,23,42,0.85)"
        />
        <BlockSettingsModal
          key={settingsModalNodeId ?? 'closed'}
          nodeId={settingsModalNodeId}
          nodes={nodes}
          onClose={() => setSettingsModalNodeId(null)}
          onApply={onApplySettings}
        />
      </ReactFlow>
      {sheetImportOpen ? (
        <div className="flow-sheet-import" role="dialog" aria-label="Import project JSON">
          <p className="flow-sheet-import__title">Paste project JSON</p>
          <textarea
            className="flow-sheet-import__textarea"
            spellCheck={false}
            placeholder='{ "format": "control-graph-project", "version": 1, "activeSheetId": "sheet-main", "sheets": [] }'
            value={sheetImportText}
            onChange={(e) => setSheetImportText(e.target.value)}
          />
          <div className="flow-sheet-import__actions">
            <button type="button" className="flow-sheet-import__btn primary" onClick={handleLoadFlowSheet}>
              Load sheet
            </button>
            <button
              type="button"
              className="flow-sheet-import__btn"
              onClick={() => {
                setSheetImportOpen(false)
                setSheetImportText('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {selectionBox?.active ? (
        <div
          className={
            selectionBox.mode === 'remove' ? 'flow-unselect-box' : 'flow-select-box'
          }
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
          }}
          aria-hidden
        />
      ) : null}
      {showSelectionDebug ? (
        <div className="flow-selection-debug" role="status">
          <div>selected: {selectionCount}</div>
          <div>shiftHeld: {shiftHeld ? 'yes' : 'no'}</div>
          <div>preBox: {preBoxDebugCount}</div>
          <div>
            box:{' '}
            {selectionBox
              ? `${selectionBox.mode} (${Math.round(selectionBox.startX)},${Math.round(
                  selectionBox.startY,
                )})→(${Math.round(selectionBox.endX)},${Math.round(selectionBox.endY)})`
              : 'none'}
          </div>
        </div>
      ) : null}
      <footer className="flow-status" role="status">
        {status ? <span className="flow-status__msg">{status}</span> : null}
        <div className="flow-status__io">
          {layoutRunning ? (
            <span
              className="flow-status__layout-running"
              role="status"
              aria-live="polite"
              aria-label={`Layout running, ${(layoutElapsedMs / 1000).toFixed(1)} seconds`}
            >
              <span className="flow-status__spinner" aria-hidden />
              <span className="flow-status__layout-running-text">
                Layout running… {(layoutElapsedMs / 1000).toFixed(1)}s
              </span>
            </span>
          ) : null}
          <select
            className="flow-status__io-btn"
            value={activeSheet?.id ?? activeSheetId}
            onChange={(e) => setActiveSheetId(e.target.value)}
            title="Active sheet"
          >
            {projectSheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name}
              </option>
            ))}
          </select>
          <input
            className="flow-status__io-btn"
            value={newSheetName}
            onChange={(e) => setNewSheetName(e.target.value)}
            placeholder="New sheet name"
            aria-label="New sheet name"
          />
          <button type="button" className="flow-status__io-btn" onClick={handleAddSheet}>
            Add sheet
          </button>
          <button type="button" className="flow-status__io-btn" onClick={handleDeleteActiveSheet}>
            Remove sheet
          </button>
          <button type="button" className="flow-status__io-btn" onClick={() => void handleCopyFlowSheet()}>
            Copy project JSON
          </button>
          <button
            type="button"
            className="flow-status__io-btn"
            onClick={() => setShowSelectionDebug((v) => !v)}
            aria-pressed={showSelectionDebug}
          >
            {showSelectionDebug ? 'Hide sel debug' : 'Sel debug'}
          </button>
          <button
            type="button"
            className="flow-status__io-btn"
            onClick={() => setShowLayoutDebug((v) => !v)}
            aria-pressed={showLayoutDebug}
          >
            {showLayoutDebug ? 'Hide layout dbg' : 'Layout dbg'}
          </button>
          {showLayoutDebug && liveLayoutMetrics ? (
            <span className="flow-status__io-metric">
              Score {Math.round(liveLayoutMetrics.score)} · X {liveLayoutMetrics.crossings} · W{' '}
              {Math.round(liveLayoutMetrics.wireLength)} · P {Math.round(liveLayoutMetrics.farPenalty)} · S{' '}
              {Math.round(liveLayoutMetrics.shortPenalty)} · HX {Math.round(liveLayoutMetrics.lowXPenalty)} · R{' '}
              {Math.round(liveLayoutMetrics.backwardPenalty)} · BP{' '}
              {Math.round(liveLayoutMetrics.blockProximityPenalty)} · LB {liveLayoutMetrics.lineBlockIntersectionCount} · O{' '}
              {liveLayoutMetrics.overlapCount} · F {liveLayoutMetrics.frameConflictCount} · A{' '}
              {Math.round(liveLayoutMetrics.area)}
            </span>
          ) : null}
          <button
            type="button"
            className="flow-status__io-btn"
            onClick={() => setSheetImportOpen((o) => !o)}
            aria-expanded={sheetImportOpen}
          >
            {sheetImportOpen ? 'Close import' : 'Import sheet…'}
          </button>
        </div>
        <div className="flow-shortcuts" aria-label="Keyboard shortcuts">
          <button type="button" className="flow-shortcuts__btn" aria-label="Show keyboard shortcuts">
            Shortcuts
          </button>
          <div className="flow-shortcuts__tooltip" role="tooltip">
            <span className="flow-shortcuts__item">
              <kbd>Shift</kbd>+<kbd>Click/Drag</kbd> select
            </span>
            <span className="flow-shortcuts__item">
              <kbd>Shift</kbd>+<kbd>Right Drag</kbd> unselect
            </span>
            <span className="flow-shortcuts__item">
              <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> copy
            </span>
            <span className="flow-shortcuts__item">
              <kbd>Ctrl/Cmd</kbd>+<kbd>V</kbd> paste
            </span>
            <span className="flow-shortcuts__item">
              <kbd>Del</kbd> delete
            </span>
            <span className="flow-shortcuts__item">
              <kbd>Ctrl/Cmd</kbd>+<kbd>J</kbd> layout
            </span>
          </div>
        </div>
        <span className="flow-status__tip">
          Drag blocks · Multi-select + drag works · Ctrl/Cmd+C copy · Ctrl/Cmd+V paste · Ctrl/Cmd+J
          auto-layout · Selected: {selectionCount}
        </span>
      </footer>
    </div>
  )
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  )
}
