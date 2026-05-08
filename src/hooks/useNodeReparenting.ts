import type { InternalNode, Node } from '@xyflow/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback } from 'react'
import type { FlowNodeData } from '../utils/connectionValidation'
import {
  nodeCenterFlow,
  pickParentFrameAtPoint,
  reattachNodeToParent,
} from '../utils/frameHitTest'

type Args = {
  setNodes: React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>
  getInternalNode: (id: string) => InternalNode<Node> | undefined
}

export function useNodeReparenting({ setNodes, getInternalNode }: Args) {
  const onNodeDragStart = useCallback(
    (e: ReactMouseEvent, _node: Node<FlowNodeData>, dragged: Node<FlowNodeData>[]) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const draggedIds = new Set(dragged.map((n) => n.id))
      setNodes((curr) =>
        curr.map((n) => {
          if (!draggedIds.has(n.id) || !n.parentId) return n
          return reattachNodeToParent(n, getInternalNode, null) as Node<FlowNodeData>
        }),
      )
    },
    [getInternalNode, setNodes],
  )

  const onNodeDragStop = useCallback(
    (e: ReactMouseEvent, _node: Node<FlowNodeData>, dragged: Node<FlowNodeData>[]) => {
      // Ctrl/Cmd drag explicitly means "pull out from frame", so skip auto-reparenting.
      if (e.ctrlKey || e.metaKey) return
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

  return { onNodeDragStart, onNodeDragStop }
}

