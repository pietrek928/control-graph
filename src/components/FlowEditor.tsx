import {
  Background,
  Controls,
  MarkerType,
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
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts'
import { useNodeReparenting } from '../hooks/useNodeReparenting'
import { useSelectionController } from '../hooks/useSelectionController'
import { nodeTypes } from '../nodeTypes'
import type { FlowNodeData } from '../utils/connectionValidation'
import { pickParentFrameAtPoint } from '../utils/frameHitTest'
import { defaultSettingsForBlock, type SettingsRecord } from '../utils/blockSettings'
import { BlockSettingsModal } from './BlockSettingsModal'
import type { PlcNodeData } from './PLCBlockNode'
import type { FrameNodeData } from '../types/frame'
import {
  inputAlreadyConnected,
  isValidTypedConnection,
} from '../utils/connectionValidation'
import { parseFlowSheetJson, serializeFlowSheet } from '../utils/flowSheetJson'
import { DND_MIME } from './BlockPalette'
import './FlowEditor.css'

const defaultViewport = { x: 0, y: 0, zoom: 1 }

function makeNodeId() {
  return `n-${crypto.randomUUID().slice(0, 8)}`
}

const initialNodes: Node<FlowNodeData>[] = [
  {
    id: 'f-main',
    type: 'plcFrame',
    position: { x: 60, y: 80 },
    style: { width: 860, height: 470 },
    data: { label: 'MAIN SEQUENCE' },
  },
  {
    id: 'f-nested',
    type: 'plcFrame',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 500, y: 180 },
    style: { width: 300, height: 220 },
    data: { label: 'SAFETY LOGIC' },
  },
  {
    id: 'n-input-sp',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 40, y: 70 },
    data: {
      blockType: 'INPUT',
      label: 'SP',
      settings: { tag: 'AI_SP', note: 'Setpoint (REAL)' },
    },
  },
  {
    id: 'n-input-pv',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 40, y: 170 },
    data: {
      blockType: 'INPUT',
      label: 'PV',
      settings: { tag: 'AI_PV', note: 'Process variable (REAL)' },
    },
  },
  {
    id: 'n-pid',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 210, y: 120 },
    data: {
      blockType: 'PID',
      label: 'PID',
      settings: { kp: 1.2, ki: 0.08, kd: 0.02, directAction: true },
    },
  },
  {
    id: 'n-add',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 210, y: 300 },
    data: { blockType: 'ADD', label: 'ADD' },
  },
  {
    id: 'n-ctu',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 390, y: 260 },
    data: { blockType: 'CTU', label: 'CTU' },
  },
  {
    id: 'n-gt',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 390, y: 360 },
    data: { blockType: 'GT', label: 'GT' },
  },
  {
    id: 'n-code',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 560, y: 80 },
    data: {
      blockType: 'CODE',
      label: 'CODE',
      settings: {
        inputsSpec:
          '[{"id":"in0","label":"IN0","type":"BOOL"},{"id":"in1","label":"IN1","type":"BOOL"}]',
        outputsSpec: '[{"id":"out0","label":"OUT0","type":"BOOL"}]',
        code: '// Example custom logic\nbool out0 = in0 && !in1;\n',
      },
    },
  },
  {
    id: 'n-and',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 560, y: 180 },
    data: { blockType: 'AND', label: 'AND' },
  },
  {
    id: 'n-ton',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 560, y: 280 },
    data: { blockType: 'TON', label: 'TON' },
  },
  {
    id: 'n-output-cv',
    type: 'plcBlock',
    parentId: 'f-main',
    extent: 'parent',
    position: { x: 730, y: 120 },
    data: {
      blockType: 'OUTPUT',
      label: 'CV_OUT',
      settings: { tag: 'QW0', note: 'Control output writeback (REAL)' },
    },
  },
  {
    id: 'n-not',
    type: 'plcBlock',
    parentId: 'f-nested',
    extent: 'parent',
    position: { x: 36, y: 46 },
    data: { blockType: 'NOT', label: 'NOT' },
  },
]

const edgeArrow = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  color: '#38bdf8',
} as const

const edgeStyle = { stroke: '#38bdf8', strokeWidth: 2 }

type UndoSnapshot = {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
  selectedIds: string[]
}

const initialEdges: Edge[] = [
  {
    id: 'e-sp-pid',
    source: 'n-input-sp',
    sourceHandle: 'out:value',
    target: 'n-pid',
    targetHandle: 'in:sp',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-pv-pid',
    source: 'n-input-pv',
    sourceHandle: 'out:value',
    target: 'n-pid',
    targetHandle: 'in:pv',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-pid-output',
    source: 'n-pid',
    sourceHandle: 'out:out',
    target: 'n-output-cv',
    targetHandle: 'in:value',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-add-ctu',
    source: 'n-add',
    sourceHandle: 'out:out',
    target: 'n-ctu',
    targetHandle: 'in:pv',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-add-gt',
    source: 'n-add',
    sourceHandle: 'out:out',
    target: 'n-gt',
    targetHandle: 'in:a',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-ctu-gt',
    source: 'n-ctu',
    sourceHandle: 'out:cv',
    target: 'n-gt',
    targetHandle: 'in:b',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-gt-and',
    source: 'n-gt',
    sourceHandle: 'out:out',
    target: 'n-and',
    targetHandle: 'in:in2',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-not-code',
    source: 'n-not',
    sourceHandle: 'out:out',
    target: 'n-code',
    targetHandle: 'in:in0',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-code-and',
    source: 'n-code',
    sourceHandle: 'out:out0',
    target: 'n-and',
    targetHandle: 'in:in1',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-and-ton',
    source: 'n-and',
    sourceHandle: 'out:out',
    target: 'n-ton',
    targetHandle: 'in:in',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
  {
    id: 'e-ton-frame',
    source: 'n-ton',
    sourceHandle: 'out:q',
    target: 'f-main',
    targetHandle: 'in:event',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
]

function FlowCanvas() {
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [status, setStatus] = useState<string | null>(null)
  const [settingsModalNodeId, setSettingsModalNodeId] = useState<string | null>(null)
  const [sheetImportOpen, setSheetImportOpen] = useState(false)
  const [sheetImportText, setSheetImportText] = useState('')
  const [showLayoutDebug, setShowLayoutDebug] = useState(false)
  const [layoutCompactness, setLayoutCompactness] = useState(1)
  const statusClearRef = useRef<number>(0)
  const reconnectingEdgeIdRef = useRef<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const undoStackRef = useRef<UndoSnapshot[]>([])
  const lastSnapshotRef = useRef<UndoSnapshot | null>(null)
  const lastSnapshotKeyRef = useRef<string | null>(null)
  const isApplyingUndoRef = useRef(false)

  const showStatus = useCallback((msg: string) => {
    setStatus(msg)
    window.clearTimeout(statusClearRef.current)
    statusClearRef.current = window.setTimeout(() => setStatus(null), 3200)
  }, [])

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
            style: edgeStyle,
            markerEnd: edgeArrow,
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
      const node: Node<PlcNodeData> = {
        id: makeNodeId(),
        type: 'plcBlock',
        position,
        data: {
          blockType,
          label: def?.label ?? blockType,
          settings: defaultSettingsForBlock(blockType),
        },
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      }
      setNodes((nds) => [...nds, node])
    },
    [getInternalNode, getNodes, screenToFlowPosition, setNodes],
  )

  const handleCopyFlowSheet = useCallback(async () => {
    try {
      const text = serializeFlowSheet(nodes, edges)
      await navigator.clipboard.writeText(text)
      showStatus('Copied full sheet JSON (all blocks & wires) to clipboard.')
    } catch {
      showStatus('Could not copy sheet — check clipboard permission.')
    }
  }, [nodes, edges, showStatus])

  const handleLoadFlowSheet = useCallback(() => {
    const result = parseFlowSheetJson(sheetImportText)
    if (!result.ok) {
      showStatus(`Sheet JSON: ${result.error}`)
      return
    }
    setNodes(result.nodes)
    setEdges(result.edges)
    setSelectedIds(new Set())
    queueMicrotask(() => {
      fitView({ padding: 0.2 })
    })
    setSettingsModalNodeId(null)
    setSheetImportOpen(false)
    setSheetImportText('')
    showStatus(`Loaded sheet (${result.nodes.length} nodes, ${result.edges.length} edges).`)
  }, [sheetImportText, setNodes, setEdges, setSelectedIds, showStatus, fitView])

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
    layoutCompactness,
    showStatus,
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
        nodesDraggable={!shiftHeld}
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
          style: edgeStyle,
          markerEnd: edgeArrow,
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
        <div className="flow-sheet-import" role="dialog" aria-label="Import sheet JSON">
          <p className="flow-sheet-import__title">Paste sheet JSON</p>
          <textarea
            className="flow-sheet-import__textarea"
            spellCheck={false}
            placeholder='{ "format": "control-graph-sheet", "version": 1, "nodes": [], "edges": [] }'
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
          <button type="button" className="flow-status__io-btn" onClick={() => void handleCopyFlowSheet()}>
            Copy sheet JSON
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
          <button
            type="button"
            className="flow-status__io-btn"
            onClick={() =>
              setLayoutCompactness((v) => {
                if (v <= 0.86) return 1
                if (v <= 1.01) return 1.18
                return 0.84
              })
            }
          >
            Layout: {layoutCompactness <= 0.86 ? 'Compact' : layoutCompactness >= 1.1 ? 'Airy' : 'Normal'}
          </button>
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
