import type { Edge, InternalNode, Node } from '@xyflow/react'
import type { KeyboardEvent } from 'react'
import { useCallback, useRef } from 'react'
import type { FlowNodeData } from '../utils/connectionValidation'

type ClipNode = {
  node: Node<FlowNodeData>
  absPosition: { x: number; y: number }
}

type NodeClip = {
  nodes: ClipNode[]
  edges: Edge[]
}

function readNumericStyleSize(
  value: string | number | undefined,
): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function nodeLayoutSize(
  n: Node<FlowNodeData>,
  getInternalNode: (id: string) => InternalNode<Node> | undefined,
): { width: number; height: number } {
  const internal = getInternalNode(n.id)
  const styleWidth = readNumericStyleSize(n.style?.width as string | number | undefined)
  const styleHeight = readNumericStyleSize(n.style?.height as string | number | undefined)
  const fallbackWidth = n.type === 'plcFrame' ? 320 : 160
  const fallbackHeight = n.type === 'plcFrame' ? 220 : 120
  const width = Math.max(
    fallbackWidth,
    internal?.measured.width ?? 0,
    internal?.width ?? 0,
    styleWidth ?? 0,
  )
  const height = Math.max(
    fallbackHeight,
    internal?.measured.height ?? 0,
    internal?.height ?? 0,
    styleHeight ?? 0,
  )
  return {
    width,
    height,
  }
}

type Args = {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
  selectedIds: Set<string>
  setNodes: React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setShiftHeld: React.Dispatch<React.SetStateAction<boolean>>
  getInternalNode: (id: string) => InternalNode<Node> | undefined
  getPasteFlowPosition: () => { x: number; y: number } | null
  undoLastOperation: () => boolean
  layoutDebug: boolean
  layoutCompactness: number
  showStatus: (msg: string) => void
  makeNodeId: () => string
}

export function useCanvasShortcuts({
  nodes,
  edges,
  selectedIds,
  setNodes,
  setEdges,
  setSelectedIds,
  setShiftHeld,
  getInternalNode,
  getPasteFlowPosition,
  undoLastOperation,
  layoutDebug,
  layoutCompactness,
  showStatus,
  makeNodeId,
}: Args) {
  const copiedSelectionRef = useRef<NodeClip | null>(null)

  const cloneForClipboard = useCallback(() => {
    const selectedNodes = nodes.filter((n) => selectedIds.has(n.id))
    if (!selectedNodes.length) return null
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
    const selectedEdges = edges.filter(
      (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target),
    )
    return {
      nodes: selectedNodes.map((n) => {
        const internal = getInternalNode(n.id)
        const abs = internal?.internals.positionAbsolute ?? n.position
        return {
          node: {
            ...n,
            selected: false,
          },
          absPosition: { x: abs.x, y: abs.y },
        }
      }),
      edges: selectedEdges.map((e) => ({
        ...e,
        selected: false,
      })),
    } as NodeClip
  }, [nodes, edges, selectedIds, getInternalNode])

  const pasteClipboardSelection = useCallback(() => {
    const clip = copiedSelectionRef.current
    if (!clip || !clip.nodes.length) return false
    const anchor = getPasteFlowPosition()

    const idMap = new Map<string, string>()
    for (const { node } of clip.nodes) idMap.set(node.id, makeNodeId())
    const selectedOriginalIds = new Set(idMap.keys())
    let deltaX = 40
    let deltaY = 40
    if (anchor) {
      const minX = Math.min(...clip.nodes.map((entry) => entry.absPosition.x))
      const minY = Math.min(...clip.nodes.map((entry) => entry.absPosition.y))
      deltaX = anchor.x - minX
      deltaY = anchor.y - minY
    }

    const targetAbs = new Map<string, { x: number; y: number }>()
    for (const { node, absPosition } of clip.nodes) {
      targetAbs.set(node.id, {
        x: absPosition.x + deltaX,
        y: absPosition.y + deltaY,
      })
    }

    const pastedNodeIds = new Set<string>()
    const pastedNodes = clip.nodes.map(({ node: n }) => {
      const nextParent =
        n.parentId && selectedOriginalIds.has(n.parentId) ? idMap.get(n.parentId) : n.parentId
      const id = idMap.get(n.id)!
      const abs = targetAbs.get(n.id)!
      let nextPosition = { x: abs.x, y: abs.y }
      if (nextParent) {
        if (n.parentId && selectedOriginalIds.has(n.parentId)) {
          const parentAbs = targetAbs.get(n.parentId)
          if (parentAbs) nextPosition = { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y }
        } else {
          const parentAbs = getInternalNode(nextParent)?.internals.positionAbsolute
          if (parentAbs) nextPosition = { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y }
        }
      }
      pastedNodeIds.add(id)
      return {
        ...n,
        id,
        parentId: nextParent,
        position: nextPosition,
      } as Node<FlowNodeData>
    })

    const pastedEdges = clip.edges.map((e) => ({
      ...e,
      id: `e-${crypto.randomUUID().slice(0, 8)}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      selected: false,
    }))

    setNodes((curr) => [...curr, ...pastedNodes])
    setSelectedIds(pastedNodeIds)
    setEdges((curr) => curr.concat(pastedEdges))
    showStatus(`Pasted ${pastedNodes.length} node(s).`)
    return true
  }, [getPasteFlowPosition, makeNodeId, setNodes, setSelectedIds, setEdges, showStatus, getInternalNode])

  const autoLayoutSelection = useCallback(() => {
    const selected = nodes.filter((n) => selectedIds.has(n.id))
    if (selected.length < 2) {
      showStatus('Select at least 2 nodes for group layout.')
      return
    }

    const byParent = new Map<string, Node<FlowNodeData>[]>()
    for (const n of selected) {
      const key = n.parentId ?? '__root__'
      const list = byParent.get(key)
      if (list) list.push(n)
      else byParent.set(key, [n])
    }

    const allById = new Map(nodes.map((n) => [n.id, n] as const))
    const placements = new Map<string, { x: number; y: number }>()
    const parentResize = new Map<string, { width: number; height: number }>()
    let totalCrossingsBefore = 0
    let totalCrossingsAfter = 0
    for (const [parentKey, group] of byParent.entries()) {
      const byId = new Map(group.map((n) => [n.id, n] as const))
      const groupIds = new Set(group.map((n) => n.id))
      const nodePriority = (id: string) => {
        const node = byId.get(id)
        const blockType = node?.type === 'plcBlock' ? (node.data as { blockType?: string }).blockType : undefined
        if (blockType === 'INPUT') return -1
        if (blockType === 'OUTPUT') return 1
        return 0
      }
      const compareByFlow = (a: string, b: string) => {
        const na = byId.get(a)
        const nb = byId.get(b)
        if (!na || !nb) return 0
        const pa = nodePriority(a)
        const pb = nodePriority(b)
        if (pa !== pb) return pa - pb
        return na.position.x === nb.position.x
          ? na.position.y - nb.position.y
          : na.position.x - nb.position.x
      }

      const indegree = new Map<string, number>()
      const outgoing = new Map<string, Array<{ id: string; weight: number }>>()
      const incoming = new Map<string, Array<{ id: string; weight: number }>>()
      for (const n of group) {
        indegree.set(n.id, 0)
        outgoing.set(n.id, [])
        incoming.set(n.id, [])
      }

      const mapToGroupNode = (nodeId: string): string | null => {
        let cursor: string | undefined = nodeId
        while (cursor) {
          if (groupIds.has(cursor)) return cursor
          cursor = allById.get(cursor)?.parentId
        }
        return null
      }

      const groupEdgeWeights = new Map<string, number>()
      for (const e of edges) {
        const src = mapToGroupNode(e.source)
        const tgt = mapToGroupNode(e.target)
        if (!src || !tgt || src === tgt) continue
        const key = `${src}->${tgt}`
        groupEdgeWeights.set(key, (groupEdgeWeights.get(key) ?? 0) + 1)
      }

      const groupEdges: Array<{ source: string; target: string; weight: number }> = []
      for (const [key, weight] of groupEdgeWeights.entries()) {
        const arrowIdx = key.indexOf('->')
        const source = key.slice(0, arrowIdx)
        const target = key.slice(arrowIdx + 2)
        groupEdges.push({ source, target, weight })
        outgoing.get(source)?.push({ id: target, weight })
        incoming.get(target)?.push({ id: source, weight })
        indegree.set(target, (indegree.get(target) ?? 0) + 1)
      }

      const topo: string[] = []
      const depth = new Map<string, number>()
      const queue = [...groupIds].filter((id) => (indegree.get(id) ?? 0) === 0).sort(compareByFlow)

      while (queue.length) {
        const id = queue.shift()!
        topo.push(id)
        const d = depth.get(id) ?? 0
        for (const entry of outgoing.get(id) ?? []) {
          const target = entry.id
          depth.set(target, Math.max(depth.get(target) ?? 0, d + 1))
          indegree.set(target, (indegree.get(target) ?? 0) - 1)
          if ((indegree.get(target) ?? 0) === 0) {
            queue.push(target)
          }
        }
        queue.sort(compareByFlow)
      }

      if (topo.length < group.length) {
        const remaining = [...groupIds].filter((id) => !topo.includes(id)).sort(compareByFlow)
        for (const id of remaining) {
          const incomingDepth = groupEdges
            .filter((e) => e.target === id)
            .reduce((m, e) => Math.max(m, (depth.get(e.source) ?? 0) + 1), 0)
          depth.set(id, Math.max(depth.get(id) ?? 0, incomingDepth))
          topo.push(id)
        }
      }

      const levels = new Map<number, string[]>()
      for (const id of topo) {
        const d = depth.get(id) ?? 0
        const bucket = levels.get(d)
        if (bucket) bucket.push(id)
        else levels.set(d, [id])
      }

      const levelKeys = [...levels.keys()].sort((a, b) => a - b)
      const edgesBetweenLevels = new Map<
        string,
        Array<{ source: string; target: string; weight: number }>
      >()
      for (const e of groupEdges) {
        const ds = depth.get(e.source)
        const dt = depth.get(e.target)
        if (ds === undefined || dt === undefined || dt <= ds) continue
        if (dt - ds !== 1) continue
        const key = `${ds}->${dt}`
        const list = edgesBetweenLevels.get(key)
        if (list) list.push({ source: e.source, target: e.target, weight: e.weight })
        else edgesBetweenLevels.set(key, [{ source: e.source, target: e.target, weight: e.weight }])
      }
      const levelOrder = new Map<number, string[]>()
      for (const level of levelKeys) {
        const ids = [...(levels.get(level) ?? [])].sort((a, b) => {
          const pa = nodePriority(a)
          const pb = nodePriority(b)
          if (pa !== pb) return pa - pb
          const na = byId.get(a)
          const nb = byId.get(b)
          if (!na || !nb) return 0
          return na.position.y === nb.position.y
            ? na.position.x - nb.position.x
            : na.position.y - nb.position.y
        })
        levelOrder.set(level, ids)
      }

      const rankInLevel = () => {
        const rank = new Map<string, number>()
        for (const level of levelKeys) {
          const ids = levelOrder.get(level) ?? []
          ids.forEach((id, idx) => rank.set(id, idx))
        }
        return rank
      }
      const sortByBarycenter = (
        ids: string[],
        neighborsFor: (id: string) => Array<{ id: string; weight: number }>,
        neighborRank: Map<string, number>,
      ) => {
        const originalIndex = new Map(ids.map((id, idx) => [id, idx] as const))
        const baseIndex = new Map(
          [...ids]
            .sort((a, b) => {
              const pa = nodePriority(a)
              const pb = nodePriority(b)
              if (pa !== pb) return pa - pb
              return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
            })
            .map((id, idx) => [id, idx] as const),
        )
        const bary = new Map<string, number>()
        for (const id of ids) {
          const neighbors = neighborsFor(id).filter((entry) => neighborRank.has(entry.id))
          if (!neighbors.length) {
            bary.set(id, baseIndex.get(id) ?? 0)
            continue
          }
          const weighted = neighbors.reduce(
            (acc, entry) => {
              return {
                num: acc.num + (neighborRank.get(entry.id) ?? 0) * entry.weight,
                den: acc.den + entry.weight,
              }
            },
            { num: 0, den: 0 },
          )
          const score = weighted.den > 0 ? weighted.num / weighted.den : baseIndex.get(id) ?? 0
          bary.set(id, score)
        }
        return [...ids].sort((a, b) => {
          const da = bary.get(a) ?? 0
          const db = bary.get(b) ?? 0
          if (da !== db) return da - db
          return (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0)
        })
      }

      // Barycentric refinement to keep connected nodes vertically closer.
      for (let pass = 0; pass < 2; pass += 1) {
        let rank = rankInLevel()
        for (let i = 1; i < levelKeys.length; i += 1) {
          const level = levelKeys[i]
          const ids = levelOrder.get(level) ?? []
          levelOrder.set(level, sortByBarycenter(ids, (id) => incoming.get(id) ?? [], rank))
          rank = rankInLevel()
        }
        rank = rankInLevel()
        for (let i = levelKeys.length - 2; i >= 0; i -= 1) {
          const level = levelKeys[i]
          const ids = levelOrder.get(level) ?? []
          levelOrder.set(level, sortByBarycenter(ids, (id) => outgoing.get(id) ?? [], rank))
          rank = rankInLevel()
        }
      }

      const countCrossingsBetween = (
        leftLevel: number,
        rightLevel: number,
        leftIds: string[],
        rightIds: string[],
      ) => {
        const edgeList = edgesBetweenLevels.get(`${leftLevel}->${rightLevel}`) ?? []
        if (edgeList.length < 2) return 0
        const leftRank = new Map(leftIds.map((id, idx) => [id, idx] as const))
        const rightRank = new Map(rightIds.map((id, idx) => [id, idx] as const))
        const projected = edgeList
          .map((e) => ({
            s: leftRank.get(e.source),
            t: rightRank.get(e.target),
            w: e.weight,
          }))
          .filter((e): e is { s: number; t: number; w: number } => e.s !== undefined && e.t !== undefined)
        let crosses = 0
        for (let i = 0; i < projected.length; i += 1) {
          for (let j = i + 1; j < projected.length; j += 1) {
            const a = projected[i]
            const b = projected[j]
            if ((a.s - b.s) * (a.t - b.t) < 0) crosses += a.w * b.w
          }
        }
        return crosses
      }

      const countTotalAdjacentCrossings = (order: Map<number, string[]>) => {
        let total = 0
        for (let i = 0; i + 1 < levelKeys.length; i += 1) {
          const left = levelKeys[i]
          const right = levelKeys[i + 1]
          total += countCrossingsBetween(left, right, order.get(left) ?? [], order.get(right) ?? [])
        }
        return total
      }

      totalCrossingsBefore += countTotalAdjacentCrossings(levelOrder)

      // Local crossing minimization by adjacent swaps in each interior level.
      for (let sweep = 0; sweep < 4; sweep += 1) {
        let changed = false
        for (let li = 1; li < levelKeys.length; li += 1) {
          const level = levelKeys[li]
          const prevLevel = levelKeys[li - 1]
          const nextLevel = li + 1 < levelKeys.length ? levelKeys[li + 1] : null
          const ids = [...(levelOrder.get(level) ?? [])]
          const prevIds = levelOrder.get(prevLevel) ?? []
          const nextIds = nextLevel === null ? [] : (levelOrder.get(nextLevel) ?? [])
          for (let i = 0; i + 1 < ids.length; i += 1) {
            const currentScore =
              countCrossingsBetween(prevLevel, level, prevIds, ids) +
              (nextLevel === null ? 0 : countCrossingsBetween(level, nextLevel, ids, nextIds))
            const swapped = [...ids]
            ;[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]]
            const swappedScore =
              countCrossingsBetween(prevLevel, level, prevIds, swapped) +
              (nextLevel === null ? 0 : countCrossingsBetween(level, nextLevel, swapped, nextIds))
            if (swappedScore < currentScore) {
              ids[i] = swapped[i]
              ids[i + 1] = swapped[i + 1]
              changed = true
            }
          }
          levelOrder.set(level, ids)
        }
        if (!changed) break
      }
      totalCrossingsAfter += countTotalAdjacentCrossings(levelOrder)

      const compact = Math.min(1.35, Math.max(0.75, layoutCompactness))
      const gapX = Math.round(48 * compact)
      const gapY = Math.round(44 * compact)
      const sizeById = new Map(
        group.map((n) => [n.id, nodeLayoutSize(n, getInternalNode)] as const),
      )
      const minX = Math.min(...group.map((n) => n.position.x))
      const minY = Math.min(...group.map((n) => n.position.y))
      const estimatedColHeights = levelKeys.map((level) => {
        const ids = levelOrder.get(level) ?? []
        return ids.reduce((sum, id, idx) => {
          const h = sizeById.get(id)?.height ?? 0
          return sum + h + (idx > 0 ? gapY : 0)
        }, 0)
      })
      const compactHeight = Math.max(...estimatedColHeights, 1)
      const maxY = minY + compactHeight * compact
      const globalCenterY = (minY + maxY) / 2
      let cursorX = minX
      const targetCenterY = new Map(
        group.map((n) => {
          const size = sizeById.get(n.id) ?? nodeLayoutSize(n, getInternalNode)
          return [n.id, n.position.y + size.height / 2] as const
        }),
      )
      const groupPlacedIds: string[] = []

      const averageNeighborCenter = (
        neighbors: Array<{ id: string; weight: number }>,
        rankByLevelOrder: Map<string, number>,
      ) => {
        const usable = neighbors.filter((entry) => rankByLevelOrder.has(entry.id))
        if (!usable.length) return null
        const weighted = usable.reduce(
          (acc, entry) => {
            return {
              num: acc.num + (targetCenterY.get(entry.id) ?? globalCenterY) * entry.weight,
              den: acc.den + entry.weight,
            }
          },
          { num: 0, den: 0 },
        )
        return weighted.den > 0 ? weighted.num / weighted.den : null
      }

      // Refine desired vertical centers so connected nodes stay closer.
      for (let pass = 0; pass < 3; pass += 1) {
        const rank = rankInLevel()
        for (let i = 1; i < levelKeys.length; i += 1) {
          const level = levelKeys[i]
          for (const id of levelOrder.get(level) ?? []) {
            const avg = averageNeighborCenter(incoming.get(id) ?? [], rank)
            if (avg !== null) targetCenterY.set(id, avg)
          }
        }
        for (let i = levelKeys.length - 2; i >= 0; i -= 1) {
          const level = levelKeys[i]
          for (const id of levelOrder.get(level) ?? []) {
            const avg = averageNeighborCenter(outgoing.get(id) ?? [], rank)
            if (avg !== null) targetCenterY.set(id, avg)
          }
        }
      }

      for (const level of levelKeys) {
        const ids = [...(levelOrder.get(level) ?? [])].sort((a, b) => {
          const dy = (targetCenterY.get(a) ?? globalCenterY) - (targetCenterY.get(b) ?? globalCenterY)
          if (Math.abs(dy) > 0.001) return dy
          return nodePriority(a) - nodePriority(b)
        })
        const halfHeights = new Map(
          ids.map((id) => [id, (sizeById.get(id)?.height ?? 0) / 2] as const),
        )
        const centers = new Map(
          ids.map((id) => [id, targetCenterY.get(id) ?? globalCenterY] as const),
        )
        const minCenter =
          ids.length > 0 ? minY + (halfHeights.get(ids[0]) ?? 0) : minY
        const maxCenter =
          ids.length > 0 ? maxY - (halfHeights.get(ids[ids.length - 1]) ?? 0) : maxY
        const sep = (a: string, b: string) =>
          (halfHeights.get(a) ?? 0) + (halfHeights.get(b) ?? 0) + gapY

        // Iterative 1D relaxation: pull toward graph targets + enforce non-overlap.
        for (let iter = 0; iter < 10; iter += 1) {
          for (const id of ids) {
            const c = centers.get(id) ?? globalCenterY
            const t = targetCenterY.get(id) ?? globalCenterY
            centers.set(id, c * 0.68 + t * 0.32)
          }
          for (let i = 1; i < ids.length; i += 1) {
            const prev = ids[i - 1]
            const curr = ids[i]
            const minCurr = (centers.get(prev) ?? globalCenterY) + sep(prev, curr)
            if ((centers.get(curr) ?? globalCenterY) < minCurr) centers.set(curr, minCurr)
          }
          for (let i = ids.length - 2; i >= 0; i -= 1) {
            const curr = ids[i]
            const next = ids[i + 1]
            const maxCurr = (centers.get(next) ?? globalCenterY) - sep(curr, next)
            if ((centers.get(curr) ?? globalCenterY) > maxCurr) centers.set(curr, maxCurr)
          }
          if (ids.length) {
            const first = ids[0]
            const last = ids[ids.length - 1]
            const under = minCenter - (centers.get(first) ?? minCenter)
            const over = (centers.get(last) ?? maxCenter) - maxCenter
            const shift = under > 0 ? under : over > 0 ? -over : 0
            if (shift !== 0) {
              for (const id of ids) centers.set(id, (centers.get(id) ?? globalCenterY) + shift)
            }
          }
        }

        let colMaxWidth = 0
        for (const id of ids) {
          const node = byId.get(id)
          if (!node) continue
          const size = sizeById.get(node.id) ?? nodeLayoutSize(node, getInternalNode)
          const center = centers.get(id) ?? globalCenterY
          const cursorY = center - size.height / 2
          placements.set(node.id, { x: cursorX, y: cursorY })
          groupPlacedIds.push(node.id)
          targetCenterY.set(node.id, center)
          if (size.width > colMaxWidth) colMaxWidth = size.width
        }
        cursorX += colMaxWidth + gapX
      }

      if (parentKey !== '__root__' && groupPlacedIds.length) {
        const topPadding = Math.round(24 * compact)
        const minPlacedY = Math.min(...groupPlacedIds.map((id) => placements.get(id)?.y ?? 0))
        if (minPlacedY < topPadding) {
          const delta = topPadding - minPlacedY
          for (const id of groupPlacedIds) {
            const p = placements.get(id)
            if (!p) continue
            placements.set(id, { x: p.x, y: p.y + delta })
            const size = sizeById.get(id)
            if (size) targetCenterY.set(id, p.y + delta + size.height / 2)
          }
        }
      }

      if (parentKey !== '__root__') {
        const parentNode = nodes.find((n) => n.id === parentKey)
        if (!parentNode || parentNode.type !== 'plcFrame') continue
        const parentSize = nodeLayoutSize(parentNode, getInternalNode)
        let maxRight = 0
        let maxBottom = 0
        for (const n of group) {
          const pos = placements.get(n.id)
          const size = sizeById.get(n.id) ?? nodeLayoutSize(n, getInternalNode)
          if (!pos) continue
          maxRight = Math.max(maxRight, pos.x + size.width)
          maxBottom = Math.max(maxBottom, pos.y + size.height)
        }
        const padding = Math.round(24 * compact)
        parentResize.set(parentKey, {
          width: Math.max(parentSize.width, maxRight + padding),
          height: Math.max(parentSize.height, maxBottom + padding),
        })
      }
    }

    setNodes((curr) =>
      curr.map((n) => {
        const p = placements.get(n.id)
        const resize = parentResize.get(n.id)
        if (!p && !resize) return n
        return {
          ...n,
          ...(p ? { position: p } : {}),
          ...(resize && n.type === 'plcFrame'
            ? {
                style: {
                  ...(n.style ?? {}),
                  width: resize.width,
                  height: resize.height,
                },
              }
            : {}),
        }
      }),
    )
    if (layoutDebug) {
      showStatus(
        `Auto-layout applied to ${selected.length} node(s). Crossings: ${totalCrossingsBefore} -> ${totalCrossingsAfter}.`,
      )
    } else {
      showStatus(`Auto-layout applied to ${selected.length} selected node(s).`)
    }
  }, [nodes, selectedIds, edges, getInternalNode, setNodes, showStatus, layoutDebug, layoutCompactness])

  const handleCanvasKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Shift') setShiftHeld(true)
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable === true
      if (isTyping) return

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'c') {
        const clip = cloneForClipboard()
        if (clip) {
          copiedSelectionRef.current = clip
          showStatus(`Copied ${clip.nodes.length} node(s).`)
        } else {
          showStatus('Nothing selected to copy.')
        }
        e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (pasteClipboardSelection()) e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        setSelectedIds(new Set(nodes.map((n) => n.id)))
        showStatus(`Selected ${nodes.length} node(s).`)
        e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (undoLastOperation()) e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'j') {
        autoLayoutSelection()
        e.preventDefault()
      }
    },
    [
      setShiftHeld,
      cloneForClipboard,
      pasteClipboardSelection,
      autoLayoutSelection,
      showStatus,
      setSelectedIds,
      nodes,
      undoLastOperation,
    ],
  )

  const handleCanvasKeyUp = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Shift') setShiftHeld(false)
    },
    [setShiftHeld],
  )

  return {
    handleCanvasKeyDown,
    handleCanvasKeyUp,
  }
}

