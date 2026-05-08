import type { InternalNode, Node, XYPosition } from '@xyflow/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowNodeData } from '../utils/connectionValidation'

export type SelectionBoxState = {
  active: boolean
  mode: 'add' | 'remove'
  startX: number
  startY: number
  endX: number
  endY: number
}

type Args = {
  nodes: Node<FlowNodeData>[]
  setNodes: React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>
  getNodes: () => Node<FlowNodeData>[]
  getInternalNode: (id: string) => InternalNode<Node> | undefined
  screenToFlowPosition: (p: XYPosition) => XYPosition
}

const UI_OVERLAY_SELECTOR =
  '.flow-status, .flow-sheet-import, .react-flow__controls, .react-flow__minimap'

export function useSelectionController({
  nodes,
  setNodes,
  getNodes,
  getInternalNode,
  screenToFlowPosition,
}: Args) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [showSelectionDebug, setShowSelectionDebug] = useState(false)
  const [preBoxDebugCount, setPreBoxDebugCount] = useState(0)
  const preBoxSelectionRef = useRef<Set<string>>(new Set())
  const ignoreNodeClickUntilRef = useRef(0)
  const startedSelectionInCaptureRef = useRef(false)

  const selectionCount = selectedIds.size
  const renderedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: selectedIds.has(n.id) })),
    [nodes, selectedIds],
  )

  const onNodeClickSelect = useCallback(
    (event: ReactMouseEvent, node: Node<FlowNodeData>) => {
      if (Date.now() < ignoreNodeClickUntilRef.current) return
      const additive = event.shiftKey
      setSelectedIds((curr) => {
        const next = new Set(curr)
        if (additive) {
          if (next.has(node.id)) next.delete(node.id)
          else next.add(node.id)
          return next
        }
        return new Set([node.id])
      })
    },
    [],
  )

  const onPaneClickClearSelection = useCallback((event: ReactMouseEvent) => {
    if (event.shiftKey) return
    setSelectedIds((curr) => (curr.size ? new Set() : curr))
  }, [])

  const handleCanvasMouseDownCapture = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      startedSelectionInCaptureRef.current = false
      if (e.shiftKey) setShiftHeld(true)
      if ((e.button !== 0 && e.button !== 2) || !e.shiftKey) return
      const target = e.target as HTMLElement
      const insideUi = Boolean(target.closest(UI_OVERLAY_SELECTOR))
      if (insideUi) return

      // Ensure keyboard shortcuts can work right after first interaction.
      e.currentTarget.focus()

      preBoxSelectionRef.current = new Set(
        getNodes()
          .filter((n) => n.selected)
          .map((n) => n.id),
      )
      setPreBoxDebugCount(preBoxSelectionRef.current.size)
      ignoreNodeClickUntilRef.current = Date.now() + 250
      startedSelectionInCaptureRef.current = true

      e.preventDefault()
      e.stopPropagation()
      setSelectionBox({
        active: true,
        mode: e.button === 2 ? 'remove' : 'add',
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      })
    },
    [getNodes],
  )

  const handleCanvasMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (startedSelectionInCaptureRef.current) {
      startedSelectionInCaptureRef.current = false
      return
    }
    if (e.shiftKey) setShiftHeld(true)
    if (e.button === 0 && e.shiftKey) {
      const target = e.target as HTMLElement
      const insideUi = Boolean(target.closest(UI_OVERLAY_SELECTOR))
      if (insideUi) return
      e.preventDefault()
      e.stopPropagation()
      ignoreNodeClickUntilRef.current = Date.now() + 250
      setSelectionBox({
        active: true,
        mode: 'add',
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      })
      setPreBoxDebugCount(preBoxSelectionRef.current.size)
      return
    }
    if (e.button !== 2 || !e.shiftKey) return
    e.preventDefault()
    e.stopPropagation()
    preBoxSelectionRef.current = new Set(
      getNodes()
        .filter((n) => n.selected)
        .map((n) => n.id),
    )
    ignoreNodeClickUntilRef.current = Date.now() + 250
    setSelectionBox({
      active: true,
      mode: 'remove',
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    })
    setPreBoxDebugCount(preBoxSelectionRef.current.size)
  }, [getNodes])

  const handleCanvasContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.shiftKey) e.preventDefault()
  }, [])

  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
    }
    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
    }
    window.addEventListener('keydown', onWindowKeyDown)
    window.addEventListener('keyup', onWindowKeyUp)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
      window.removeEventListener('keyup', onWindowKeyUp)
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      setSelectionBox((prev) => {
        if (!prev?.active) return prev
        return { ...prev, endX: e.clientX, endY: e.clientY }
      })
    }

    const finishSelectionBoxOnMouseUp = () => {
      const box = selectionBox
      if (!box?.active) return

      const minX = Math.min(box.startX, box.endX)
      const maxX = Math.max(box.startX, box.endX)
      const minY = Math.min(box.startY, box.endY)
      const maxY = Math.max(box.startY, box.endY)
      const p1 = screenToFlowPosition({ x: minX, y: minY })
      const p2 = screenToFlowPosition({ x: maxX, y: maxY })
      const flowMinX = Math.min(p1.x, p2.x)
      const flowMaxX = Math.max(p1.x, p2.x)
      const flowMinY = Math.min(p1.y, p2.y)
      const flowMaxY = Math.max(p1.y, p2.y)
      const baseSelected = new Set(preBoxSelectionRef.current)

      setNodes((curr) =>
        curr.map((n) => {
          const internal = getInternalNode(n.id)
          const abs = internal?.internals.positionAbsolute ?? n.position
          const styleWidth =
            n.style && typeof n.style.width === 'number' ? n.style.width : undefined
          const styleHeight =
            n.style && typeof n.style.height === 'number' ? n.style.height : undefined
          const w = internal?.measured.width ?? styleWidth ?? 112
          const h = internal?.measured.height ?? styleHeight ?? 78
          const left = abs.x
          const right = abs.x + w
          const top = abs.y
          const bottom = abs.y + h

          const overlapW = Math.max(0, Math.min(right, flowMaxX) - Math.max(left, flowMinX))
          const overlapH = Math.max(0, Math.min(bottom, flowMaxY) - Math.max(top, flowMinY))
          const intersects = overlapW > 0 && overlapH > 0
          const nodeFullyInside =
            left >= flowMinX && right <= flowMaxX && top >= flowMinY && bottom <= flowMaxY

          let hit = intersects || nodeFullyInside
          if (n.type === 'plcFrame') {
            // Prevent accidental frame captures; only select a frame if fully enclosed.
            hit = nodeFullyInside
          }

          if (box.mode === 'remove') {
            if (hit) baseSelected.delete(n.id)
            return n
          }
          if (hit) baseSelected.add(n.id)
          return n
        }),
      )
      setSelectedIds(new Set(baseSelected))
      setSelectionBox(null)
      ignoreNodeClickUntilRef.current = Date.now() + 150
    }

    if (selectionBox?.active) {
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', finishSelectionBoxOnMouseUp, { once: true })
      return () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', finishSelectionBoxOnMouseUp)
      }
    }
  }, [selectionBox, screenToFlowPosition, getInternalNode, setNodes])

  return {
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
  }
}

