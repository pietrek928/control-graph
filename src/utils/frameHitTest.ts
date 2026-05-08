import type { InternalNode, Node, XYPosition } from '@xyflow/react'
import { wouldCycleParent } from './frameHierarchy'

type GetInternal = (id: string) => InternalNode<Node> | undefined

function frameRect(
  n: Node,
  getInternal: GetInternal,
): { x: number; y: number; w: number; h: number } | null {
  if (n.type !== 'plcFrame') return null
  const internal = getInternal(n.id)
  const abs = internal?.internals.positionAbsolute
  if (!abs) return null
  const mw = internal.measured.width
  const mh = internal.measured.height
  const sw = n.style?.width
  const sh = n.style?.height
  const w = mw ?? (typeof sw === 'number' ? sw : parseFloat(String(sw ?? '320')) || 320)
  const h = mh ?? (typeof sh === 'number' ? sh : parseFloat(String(sh ?? '220')) || 220)
  return { x: abs.x, y: abs.y, w, h }
}

function contains(rect: { x: number; y: number; w: number; h: number }, p: XYPosition): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
}

/** Frames containing `flowPoint`, smallest area first (innermost nested frame first). */
export function framesContainingPointSorted(
  nodes: Node[],
  flowPoint: XYPosition,
  getInternal: GetInternal,
): { id: string; area: number }[] {
  const hits: { id: string; area: number }[] = []
  for (const n of nodes) {
    if (n.type !== 'plcFrame') continue
    const r = frameRect(n, getInternal)
    if (!r || !contains(r, flowPoint)) continue
    hits.push({ id: n.id, area: r.w * r.h })
  }
  hits.sort((a, b) => a.area - b.area)
  return hits
}

/**
 * Innermost frame that may legally become the parent at `flowPoint`.
 * Skips the dragged node itself and any choice that would cycle parent links.
 */
export function pickParentFrameAtPoint(
  nodes: Node[],
  flowPoint: XYPosition,
  getInternal: GetInternal,
  movingId?: string,
): string | null {
  const sorted = framesContainingPointSorted(nodes, flowPoint, getInternal)
  for (const { id } of sorted) {
    if (movingId && id === movingId) continue
    if (movingId && wouldCycleParent(nodes, movingId, id)) continue
    return id
  }
  return null
}

/** Absolute center of node in flow coordinates (for drag-end hit testing). */
export function nodeCenterFlow(
  nodeId: string,
  nodes: Node[],
  getInternal: GetInternal,
): XYPosition | null {
  const n = nodes.find((x) => x.id === nodeId)
  if (!n) return null
  const internal = getInternal(nodeId)
  const abs = internal?.internals.positionAbsolute ?? n.position
  const w = internal?.measured.width ?? 112
  const h = internal?.measured.height ?? 78
  return { x: abs.x + w / 2, y: abs.y + h / 2 }
}

/** Apply new parent (or top-level) using current absolute geometry from `getInternal`. */
export function reattachNodeToParent(
  n: Node,
  getInternal: GetInternal,
  newParentId: string | null,
): Node {
  const internal = getInternal(n.id)
  const abs = internal?.internals.positionAbsolute
  if (!abs) return n

  if (!newParentId) {
    return {
      ...n,
      parentId: undefined,
      extent: undefined,
      position: { x: abs.x, y: abs.y },
    }
  }

  const pInt = getInternal(newParentId)
  const pAbs = pInt?.internals.positionAbsolute
  if (!pAbs) return n

  return {
    ...n,
    parentId: newParentId,
    extent: 'parent',
    position: { x: abs.x - pAbs.x, y: abs.y - pAbs.y },
  }
}
