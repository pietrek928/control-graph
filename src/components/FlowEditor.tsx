import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useRef, useState } from 'react'
import { getBlockDefinition } from '../data/blockDefinitions'
import { nodeTypes } from '../nodeTypes'
import type { FlowNodeData } from '../utils/connectionValidation'
import {
  nodeCenterFlow,
  pickParentFrameAtPoint,
  reattachNodeToParent,
} from '../utils/frameHitTest'
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
    id: 'n-add',
    type: 'plcBlock',
    position: { x: 80, y: 120 },
    data: { blockType: 'ADD', label: 'ADD' },
  },
  {
    id: 'n-gt',
    type: 'plcBlock',
    position: { x: 420, y: 100 },
    data: { blockType: 'GT', label: 'GT' },
  },
]

const edgeArrow = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  color: '#38bdf8',
} as const

const edgeStyle = { stroke: '#38bdf8', strokeWidth: 2 }

const initialEdges: Edge[] = [
  {
    id: 'e-demo',
    source: 'n-add',
    sourceHandle: 'out:out',
    target: 'n-gt',
    targetHandle: 'in:a',
    animated: true,
    style: edgeStyle,
    markerEnd: edgeArrow,
  },
]

function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [status, setStatus] = useState<string | null>(null)
  const [settingsModalNodeId, setSettingsModalNodeId] = useState<string | null>(null)
  const [sheetImportOpen, setSheetImportOpen] = useState(false)
  const [sheetImportText, setSheetImportText] = useState('')
  const statusClearRef = useRef<number>(0)
  const reconnectingEdgeIdRef = useRef<string | null>(null)

  const showStatus = useCallback((msg: string) => {
    setStatus(msg)
    window.clearTimeout(statusClearRef.current)
    statusClearRef.current = window.setTimeout(() => setStatus(null), 3200)
  }, [])

  const { screenToFlowPosition, getNodes, getEdges, getInternalNode, fitView } = useReactFlow()

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
        showStatus('This block has no settings — double-click CODE, PID, or INPUT.')
        return
      }
      setSettingsModalNodeId(node.id)
    },
    [showStatus],
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
    queueMicrotask(() => {
      fitView({ padding: 0.2 })
    })
    setSettingsModalNodeId(null)
    setSheetImportOpen(false)
    setSheetImportText('')
    showStatus(`Loaded sheet (${result.nodes.length} nodes, ${result.edges.length} edges).`)
  }, [sheetImportText, setNodes, setEdges, showStatus, fitView])

  const onNodeDragStop = useCallback(
    (_e: ReactMouseEvent, _node: Node<FlowNodeData>, dragged: Node<FlowNodeData>[]) => {
      setNodes((curr) => {
        let next: Node<FlowNodeData>[] = curr
        for (const d of dragged) {
          const center = nodeCenterFlow(d.id, next, getInternalNode)
          if (!center) continue
          const parentId = pickParentFrameAtPoint(next, center, getInternalNode, d.id)
          const curNode = next.find((n) => n.id === d.id)
          if (!curNode) continue
          if ((curNode.parentId ?? null) === (parentId ?? null)) continue
          next = next.map((n) =>
            n.id === d.id
              ? (reattachNodeToParent(n, getInternalNode, parentId) as Node<FlowNodeData>)
              : n,
          )
        }
        return next
      })
    },
    [getInternalNode, setNodes],
  )

  return (
    <div className="flow-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultViewport={defaultViewport}
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
      <footer className="flow-status" role="status">
        {status ? <span className="flow-status__msg">{status}</span> : null}
        <div className="flow-status__io">
          <button type="button" className="flow-status__io-btn" onClick={() => void handleCopyFlowSheet()}>
            Copy sheet JSON
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
        <span className="flow-status__tip">
          Drag blocks · Copy/import JSON for the whole canvas · Double-click CODE / PID / INPUT for settings
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
