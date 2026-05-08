import type { Node } from '@xyflow/react'

/** Walk parents from `startId` upward; true if `ancestorId` appears on the chain (start is under ancestor). */
export function isUnderAncestor(
  nodes: Node[],
  ancestorId: string,
  startId: string,
): boolean {
  let cur: string | undefined = startId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (cur === ancestorId) return true
    cur = nodes.find((n) => n.id === cur)?.parentId ?? undefined
  }
  return false
}

/**
 * Assigning `movingId` → parent `candidateParentId` would create a cycle
 * (e.g. dropping a frame onto its own descendant).
 */
export function wouldCycleParent(
  nodes: Node[],
  movingId: string,
  candidateParentId: string,
): boolean {
  if (candidateParentId === movingId) return true
  return isUnderAncestor(nodes, movingId, candidateParentId)
}
