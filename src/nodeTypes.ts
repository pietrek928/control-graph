import type { NodeTypes } from '@xyflow/react'
import { PLCBlockNode } from './components/PLCBlockNode'
import { PLCFrameNode } from './components/PLCFrameNode'

/** Defined at module scope so React Flow does not treat types as new each render */
export const nodeTypes = {
  plcBlock: PLCBlockNode,
  plcFrame: PLCFrameNode,
} as NodeTypes
