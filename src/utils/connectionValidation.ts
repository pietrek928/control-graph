import type { Edge, Node } from '@xyflow/react'
import type { PlcNodeData } from '../components/PLCBlockNode'
import { getBlockDefinition } from '../data/blockDefinitions'
import { getEffectiveBlockPorts } from './codeBlockPorts'
import type { FrameNodeData } from '../types/frame'
import type { DataType } from '../types/plc'

/** Canvas node data (PLC blocks + group frames) */
export type FlowNodeData = PlcNodeData | FrameNodeData

function parseHandle(handle: string | null | undefined): {
  side: 'in' | 'out'
  portId: string
} | null {
  if (!handle) return null
  if (handle.startsWith('in:')) return { side: 'in', portId: handle.slice(3) }
  if (handle.startsWith('out:')) return { side: 'out', portId: handle.slice(4) }
  return null
}

function portTypeForHandle(
  node: Node<FlowNodeData>,
  handle: string | null | undefined,
): DataType | undefined {
  if (node.type === 'plcFrame') {
    return handle === 'in:event' ? 'BOOL' : undefined
  }
  const data = node.data as PlcNodeData
  const def = getBlockDefinition(data.blockType)
  if (!def) return undefined
  const { inputs, outputs } = getEffectiveBlockPorts(data.blockType, data.settings)
  const parsed = parseHandle(handle)
  if (!parsed) return undefined
  if (parsed.side === 'in') {
    const p = inputs.find((x) => x.id === parsed.portId)
    return p?.type
  }
  const p = outputs.find((x) => x.id === parsed.portId)
  return p?.type
}

/** Types must match for a valid PLC wire */
export function areTypesCompatible(a: DataType, b: DataType): boolean {
  return a === b
}

/** Accepts connections during drag or serialized edges */
export function isValidTypedConnection(
  connection: {
    source: string | null
    target: string | null
    sourceHandle?: string | null
    targetHandle?: string | null
  },
  nodes: Node<FlowNodeData>[],
): boolean {
  const { source, sourceHandle, target, targetHandle } = connection
  if (!source || !target) return false
  if (source === target) return false

  const srcNode = nodes.find((n) => n.id === source)
  const tgtNode = nodes.find((n) => n.id === target)
  if (!srcNode || !tgtNode) return false

  if (srcNode.type === 'plcFrame') return false

  const outType = portTypeForHandle(srcNode, sourceHandle)
  const inType = portTypeForHandle(tgtNode, targetHandle)
  if (!outType || !inType) return false

  return areTypesCompatible(outType, inType)
}

/** One wire per input port (typical PLC discipline) */
export function inputAlreadyConnected(
  edges: Edge[],
  target: string,
  targetHandle: string | null,
  excludeEdgeId?: string,
): boolean {
  if (!targetHandle) return false
  return edges.some(
    (e) =>
      e.id !== excludeEdgeId && e.target === target && e.targetHandle === targetHandle,
  )
}
