import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import type { FrameNodeData } from '../types/frame'
import './PLCFrameNode.css'

function PLCFrameNodeInner(props: NodeProps<Node<FrameNodeData, 'plcFrame'>>) {
  const { data, selected } = props

  return (
    <div className="plc-frame">
      <NodeResizer
        minWidth={180}
        minHeight={120}
        maxWidth={2000}
        maxHeight={2000}
        isVisible={selected}
        lineClassName="plc-frame__resize-line"
        handleClassName="plc-frame__resize-handle"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in:event"
        className="plc-frame__evt-handle"
        isConnectable
      />
      <div className="plc-frame__chrome">
        <span className="plc-frame__title">{data.label}</span>
        <span className="plc-frame__badge">EVT · BOOL</span>
      </div>
    </div>
  )
}

export const PLCFrameNode = memo(PLCFrameNodeInner)
