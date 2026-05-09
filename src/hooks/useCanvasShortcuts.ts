import type { Edge, InternalNode, Node } from '@xyflow/react'
import type { KeyboardEvent } from 'react'
import { useCallback, useRef } from 'react'
import type { FlowNodeData } from '../utils/connectionValidation'
import {
  blockPairProximityPenalty,
  backwardDirectionPenalty,
  connectionLengthPenalties,
  fallbackNodeSize,
  layoutObjectiveScore,
  lowXDistancePenalty,
  preferredNeighborDistance,
  readNumericStyleSize,
  segmentIntersectsRect,
  segmentsIntersect,
} from '../utils/layoutMetrics'

type ClipNode = {
  node: Node<FlowNodeData>
  absPosition: { x: number; y: number }
}

type NodeClip = {
  nodes: ClipNode[]
  edges: Edge[]
}

function nodeLayoutSize(
  n: Node<FlowNodeData>,
  getInternalNode: (id: string) => InternalNode<Node> | undefined,
): { width: number; height: number } {
  const internal = getInternalNode(n.id)
  const styleWidth = readNumericStyleSize(n.style?.width as string | number | undefined)
  const styleHeight = readNumericStyleSize(n.style?.height as string | number | undefined)
  const fallback = fallbackNodeSize(n.type)
  const width = Math.max(
    fallback.width,
    internal?.measured.width ?? 0,
    internal?.width ?? 0,
    styleWidth ?? 0,
  )
  const height = Math.max(
    fallback.height,
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
  showStatus: (msg: string) => void
  setLayoutRunning: React.Dispatch<React.SetStateAction<boolean>>
  makeNodeId: () => string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function computeAdaptiveCompactness({
  nodeCount,
  levelCount,
  maxLevelWidth,
  edgeCount,
  crossingsBefore,
  weightedEdgeSpan,
}: {
  nodeCount: number
  levelCount: number
  maxLevelWidth: number
  edgeCount: number
  crossingsBefore: number
  weightedEdgeSpan: number
}) {
  const fanOut = edgeCount / Math.max(nodeCount, 1)
  const crossingPressure = crossingsBefore / Math.max(edgeCount, 1)

  let compact = 0.94
  compact += clamp((nodeCount - 6) * 0.012, 0, 0.22)
  compact += clamp((maxLevelWidth - 3) * 0.026, 0, 0.18)
  compact += clamp((fanOut - 1.1) * 0.15, 0, 0.18)
  compact += clamp(crossingPressure * 0.07, 0, 0.16)
  // Long-span links benefit from tighter columns to reduce wire length.
  compact -= clamp((weightedEdgeSpan - 1.1) * 0.065, 0, 0.1)
  compact -= clamp((2 - levelCount) * 0.04, 0, 0.08)
  return clamp(compact, 0.88, 1.3)
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
  showStatus,
  setLayoutRunning,
  makeNodeId,
}: Args) {
  const copiedSelectionRef = useRef<NodeClip | null>(null)
  const layoutRunningRef = useRef(false)

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

  const autoLayoutSelection = useCallback(async () => {
    if (layoutRunningRef.current) {
      showStatus('Layout is already running.')
      return
    }
    const selectedBlocks = nodes.filter((n) => selectedIds.has(n.id) && n.type === 'plcBlock')
    const targetBlocks = selectedBlocks.length >= 2
      ? selectedBlocks
      : selectedIds.size === 0
        ? nodes.filter((n) => n.type === 'plcBlock')
        : selectedBlocks
    if (targetBlocks.length < 2) {
      showStatus('Select at least 2 block nodes for group layout.')
      return
    }
    layoutRunningRef.current = true
    setLayoutRunning(true)
    const maybeYield = (() => {
      let tick = 0
      return async (step = 1) => {
        tick += step
        if (tick >= 6) {
          tick = 0
          await yieldToBrowser()
        }
      }
    })()
    showStatus(`Layout running for ${targetBlocks.length} block(s)…`)
    await yieldToBrowser()
    try {

    const byParent = new Map<string, Node<FlowNodeData>[]>()
    for (const n of targetBlocks) {
      const key = n.parentId ?? '__root__'
      const list = byParent.get(key)
      if (list) list.push(n)
      else byParent.set(key, [n])
    }

    const allById = new Map(nodes.map((n) => [n.id, n] as const))
    const placements = new Map<string, { x: number; y: number }>()
    const parentResize = new Map<string, { width: number; height: number }>()
    const targetBlockIds = new Set(targetBlocks.map((n) => n.id))
    const initialTargetPositions = new Map(
      targetBlocks.map((n) => [n.id, { x: n.position.x, y: n.position.y }] as const),
    )
    const computeGlobalObjective = (
      positions: Map<string, { x: number; y: number }>,
      frameResizeOverride = new Map<string, { width: number; height: number }>(),
    ) => {
      const geometry = new Map<
        string,
        { cx: number; cy: number; left: number; top: number; right: number; bottom: number; parentId: string | null }
      >()
      for (const n of targetBlocks) {
        const pos = positions.get(n.id) ?? n.position
        const size = nodeLayoutSize(n, getInternalNode)
        geometry.set(n.id, {
          cx: pos.x + size.width / 2,
          cy: pos.y + size.height / 2,
          left: pos.x,
          top: pos.y,
          right: pos.x + size.width,
          bottom: pos.y + size.height,
          parentId: n.parentId ?? null,
        })
      }

      let minLeft = Number.POSITIVE_INFINITY
      let minTop = Number.POSITIVE_INFINITY
      let maxRight = Number.NEGATIVE_INFINITY
      let maxBottom = Number.NEGATIVE_INFINITY
      for (const g of geometry.values()) {
        minLeft = Math.min(minLeft, g.left)
        minTop = Math.min(minTop, g.top)
        maxRight = Math.max(maxRight, g.right)
        maxBottom = Math.max(maxBottom, g.bottom)
      }
      const area =
        Number.isFinite(minLeft) && Number.isFinite(minTop)
          ? Math.max(1, maxRight - minLeft) * Math.max(1, maxBottom - minTop)
          : 0

      const edgeSegs: Array<{ source: string; target: string; s: { x: number; y: number }; t: { x: number; y: number } }> = []
      let wireLength = 0
      let farPenalty = 0
      let shortPenalty = 0
      let lowXPenalty = 0
      let backwardPenalty = 0
      for (const e of edges) {
        if (!targetBlockIds.has(e.source) || !targetBlockIds.has(e.target)) continue
        const source = geometry.get(e.source)
        const target = geometry.get(e.target)
        if (!source || !target) continue
        const dist = Math.hypot(source.cx - target.cx, source.cy - target.cy)
        wireLength += dist
        const srcW = source.right - source.left
        const tgtW = target.right - target.left
        const preferred = preferredNeighborDistance(srcW, tgtW, 48)
        const penalties = connectionLengthPenalties(dist, preferred)
        farPenalty += penalties.farPenalty
        shortPenalty += penalties.shortPenalty
        lowXPenalty += lowXDistancePenalty(Math.abs(source.cx - target.cx), preferred)
        backwardPenalty += backwardDirectionPenalty(target.cx - source.cx, preferred)
        edgeSegs.push({
          source: e.source,
          target: e.target,
          s: { x: source.cx, y: source.cy },
          t: { x: target.cx, y: target.cy },
        })
      }

      let crossings = 0
      for (let i = 0; i < edgeSegs.length; i += 1) {
        for (let j = i + 1; j < edgeSegs.length; j += 1) {
          const a = edgeSegs[i]
          const b = edgeSegs[j]
          if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) {
            continue
          }
          if (segmentsIntersect(a.s, a.t, b.s, b.t)) crossings += 1
        }
      }

      let lineBlockIntersectionCount = 0
      for (const seg of edgeSegs) {
        for (const [id, rect] of geometry.entries()) {
          if (id === seg.source || id === seg.target) continue
          if (segmentIntersectsRect(seg.s, seg.t, rect)) lineBlockIntersectionCount += 1
        }
      }

      let overlapCount = 0
      let overlapArea = 0
      let blockProximityPenalty = 0
      const rectList = [...geometry.values()]
      for (let i = 0; i < rectList.length; i += 1) {
        for (let j = i + 1; j < rectList.length; j += 1) {
          const a = rectList[i]
          const b = rectList[j]
          const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (overlapW > 0 && overlapH > 0) {
            overlapCount += 1
            overlapArea += overlapW * overlapH
          } else if (a.parentId === b.parentId) {
            const gapX = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
            const gapY = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
            blockProximityPenalty += blockPairProximityPenalty(gapX, gapY)
          }
        }
      }

      const frameRects = nodes
        .filter((n) => n.type === 'plcFrame')
        .map((n) => {
          const internal = getInternalNode(n.id)
          const abs = internal?.internals.positionAbsolute ?? n.position
          const fallback = fallbackNodeSize(n.type)
          const styleWidth = readNumericStyleSize(n.style?.width as string | number | undefined)
          const styleHeight = readNumericStyleSize(n.style?.height as string | number | undefined)
          const override = frameResizeOverride.get(n.id)
          const width = Math.max(
            override?.width ?? 0,
            fallback.width,
            internal?.measured.width ?? 0,
            internal?.width ?? 0,
            styleWidth ?? 0,
          )
          const height = Math.max(
            override?.height ?? 0,
            fallback.height,
            internal?.measured.height ?? 0,
            internal?.height ?? 0,
            styleHeight ?? 0,
          )
          return {
            id: n.id,
            left: abs.x,
            top: abs.y,
            right: abs.x + width,
            bottom: abs.y + height,
          }
        })
      const isDescendantOf = (nodeId: string, frameId: string) => {
        let parentId = allById.get(nodeId)?.parentId
        while (parentId) {
          if (parentId === frameId) return true
          parentId = allById.get(parentId)?.parentId
        }
        return false
      }
      let frameConflictCount = 0
      let frameConflictArea = 0
      for (const [id, g] of geometry.entries()) {
        for (const frame of frameRects) {
          if (isDescendantOf(id, frame.id)) continue
          const overlapW = Math.min(g.right, frame.right) - Math.max(g.left, frame.left)
          const overlapH = Math.min(g.bottom, frame.bottom) - Math.max(g.top, frame.top)
          if (overlapW > 0 && overlapH > 0) {
            frameConflictCount += 1
            frameConflictArea += overlapW * overlapH
          }
        }
      }

      return {
        score: layoutObjectiveScore(
          crossings,
          wireLength,
          area,
          overlapCount,
          overlapArea,
          lineBlockIntersectionCount,
          farPenalty,
          shortPenalty,
          lowXPenalty,
          backwardPenalty,
          blockProximityPenalty,
          frameConflictCount,
          frameConflictArea,
        ),
        crossings,
        wireLength,
        area,
      }
    }
    let totalCrossingsBefore = 0
    let totalCrossingsAfter = 0
    let totalScoreBefore = 0
    let totalScoreAfter = 0
    let totalWeightedWireLength = 0
    let totalLayoutArea = 0
    for (const [parentKey, group] of byParent.entries()) {
      await maybeYield(2)
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
      const groupEdgeInstances: Array<{ source: string; target: string }> = []
      for (const e of edges) {
        const src = mapToGroupNode(e.source)
        const tgt = mapToGroupNode(e.target)
        if (!src || !tgt || src === tgt) continue
        const key = `${src}->${tgt}`
        groupEdgeWeights.set(key, (groupEdgeWeights.get(key) ?? 0) + 1)
        groupEdgeInstances.push({ source: src, target: tgt })
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
      const maxLevelWidth = Math.max(...levelKeys.map((level) => levelOrder.get(level)?.length ?? 0), 1)

      const rankInLevel = (order: Map<number, string[]>) => {
        const rank = new Map<string, number>()
        for (const level of levelKeys) {
          const ids = order.get(level) ?? []
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
        const medianRank = new Map<string, number>()
        const strongestNeighborRank = new Map<string, number>()
        const connectivityWeight = new Map<string, number>()
        for (const id of ids) {
          const neighbors = neighborsFor(id).filter((entry) => neighborRank.has(entry.id))
          if (!neighbors.length) {
            bary.set(id, baseIndex.get(id) ?? 0)
            medianRank.set(id, baseIndex.get(id) ?? 0)
            strongestNeighborRank.set(id, baseIndex.get(id) ?? 0)
            connectivityWeight.set(id, 0)
            continue
          }
          const byRank = [...neighbors].sort(
            (a, b) => (neighborRank.get(a.id) ?? 0) - (neighborRank.get(b.id) ?? 0),
          )
          const totalWeight = byRank.reduce((sum, n) => sum + n.weight, 0)
          let cumulative = 0
          let weightedMedian = neighborRank.get(byRank[0].id) ?? (baseIndex.get(id) ?? 0)
          for (const n of byRank) {
            cumulative += n.weight
            if (cumulative >= totalWeight * 0.5) {
              weightedMedian = neighborRank.get(n.id) ?? weightedMedian
              break
            }
          }
          const strongest = byRank.reduce((best, n) => (n.weight > best.weight ? n : best), byRank[0])
          strongestNeighborRank.set(id, neighborRank.get(strongest.id) ?? weightedMedian)
          connectivityWeight.set(id, totalWeight)
          medianRank.set(id, weightedMedian)
          const weighted = neighbors.reduce(
            (acc, entry) => {
              return {
                num: acc.num + (neighborRank.get(entry.id) ?? 0) * entry.weight,
                den: acc.den + entry.weight,
              }
            },
            { num: 0, den: 0 },
          )
          const avg = weighted.den > 0 ? weighted.num / weighted.den : baseIndex.get(id) ?? 0
          const score = avg * 0.68 + weightedMedian * 0.32
          bary.set(id, score)
        }
        return [...ids].sort((a, b) => {
          const da = bary.get(a) ?? 0
          const db = bary.get(b) ?? 0
          if (da !== db) return da - db
          const ma = medianRank.get(a) ?? 0
          const mb = medianRank.get(b) ?? 0
          if (ma !== mb) return ma - mb
          const sa = strongestNeighborRank.get(a) ?? 0
          const sb = strongestNeighborRank.get(b) ?? 0
          if (sa !== sb) return sa - sb
          const wa = connectivityWeight.get(a) ?? 0
          const wb = connectivityWeight.get(b) ?? 0
          if (wa !== wb) return wb - wa
          return (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0)
        })
      }

      const baryPasses = Math.min(7, 3 + Math.floor(groupEdges.length / 10))
      // Barycentric refinement to keep connected nodes vertically closer.
      for (let pass = 0; pass < baryPasses; pass += 1) {
        await maybeYield()
        let rank = rankInLevel(levelOrder)
        for (let i = 1; i < levelKeys.length; i += 1) {
          const level = levelKeys[i]
          const ids = levelOrder.get(level) ?? []
          levelOrder.set(level, sortByBarycenter(ids, (id) => incoming.get(id) ?? [], rank))
          rank = rankInLevel(levelOrder)
        }
        rank = rankInLevel(levelOrder)
        for (let i = levelKeys.length - 2; i >= 0; i -= 1) {
          const level = levelKeys[i]
          const ids = levelOrder.get(level) ?? []
          levelOrder.set(level, sortByBarycenter(ids, (id) => outgoing.get(id) ?? [], rank))
          rank = rankInLevel(levelOrder)
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
      const countProjectedCrossings = (order: Map<number, string[]>) => {
        const rank = rankInLevel(order)
        const projected = groupEdges
          .map((e) => {
            const ds = depth.get(e.source)
            const dt = depth.get(e.target)
            const sy = rank.get(e.source)
            const ty = rank.get(e.target)
            if (ds === undefined || dt === undefined || sy === undefined || ty === undefined || ds === dt) {
              return null
            }
            return {
              source: e.source,
              target: e.target,
              w: e.weight,
              a: { x: ds, y: sy },
              b: { x: dt, y: ty },
            }
          })
          .filter(
            (
              edge,
            ): edge is {
              source: string
              target: string
              w: number
              a: { x: number; y: number }
              b: { x: number; y: number }
            } => Boolean(edge),
          )
        let crosses = 0
        for (let i = 0; i < projected.length; i += 1) {
          for (let j = i + 1; j < projected.length; j += 1) {
            const a = projected[i]
            const b = projected[j]
            if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) {
              continue
            }
            if (segmentsIntersect(a.a, a.b, b.a, b.b)) crosses += a.w * b.w
          }
        }
        return crosses
      }

      const groupCrossingsBefore = countTotalAdjacentCrossings(levelOrder)

      const permutationsOf = (ids: string[]) => {
        if (ids.length <= 1) return [ids]
        const out: string[][] = []
        for (let i = 0; i < ids.length; i += 1) {
          const head = ids[i]
          const tail = [...ids.slice(0, i), ...ids.slice(i + 1)]
          for (const p of permutationsOf(tail)) out.push([head, ...p])
        }
        return out
      }

      const levelOrderCost = (
        level: number,
        ids: string[],
        prevLevel: number | null,
        nextLevel: number | null,
        prevIds: string[],
        nextIds: string[],
      ) => {
        const currentRank = new Map(ids.map((id, idx) => [id, idx] as const))
        const prevRank = new Map(prevIds.map((id, idx) => [id, idx] as const))
        const nextRank = new Map(nextIds.map((id, idx) => [id, idx] as const))
        let localCrossings = 0
        if (prevLevel !== null) {
          localCrossings += countCrossingsBetween(prevLevel, level, prevIds, ids)
        }
        if (nextLevel !== null) {
          localCrossings += countCrossingsBetween(level, nextLevel, ids, nextIds)
        }
        let localStretch = 0
        for (const id of ids) {
          const rank = currentRank.get(id) ?? 0
          let weightedDeviation = 0
          let totalWeight = 0
          for (const e of incoming.get(id) ?? []) {
            const nr = prevRank.get(e.id)
            if (nr === undefined) continue
            weightedDeviation += Math.abs(rank - nr) * e.weight
            totalWeight += e.weight
          }
          for (const e of outgoing.get(id) ?? []) {
            const nr = nextRank.get(e.id)
            if (nr === undefined) continue
            weightedDeviation += Math.abs(rank - nr) * e.weight
            totalWeight += e.weight
          }
          if (totalWeight > 0) localStretch += weightedDeviation / totalWeight
        }
        return localCrossings * 72 + localStretch
      }

      const cloneLevelOrder = (order: Map<number, string[]>) => {
        const next = new Map<number, string[]>()
        for (const [level, ids] of order.entries()) next.set(level, [...ids])
        return next
      }
      const swapSweeps = Math.min(
        11,
        5 + Math.floor(groupEdges.length / 7) + Math.max(0, maxLevelWidth - 3),
      )
      const windowSize = 3
      const windowPermutations = permutationsOf(new Array(windowSize).fill(0).map((_, i) => `${i}`))
      const optimizeLevelOrder = async (startOrder: Map<number, string[]>, seed: number) => {
        const working = cloneLevelOrder(startOrder)
        if (seed > 0) {
          for (let li = 1; li < levelKeys.length; li += 1) {
            const level = levelKeys[li]
            const ids = [...(working.get(level) ?? [])]
            if (ids.length < 3) continue
            const pivot = (seed + li) % (ids.length - 1)
            ;[ids[pivot], ids[pivot + 1]] = [ids[pivot + 1], ids[pivot]]
            if (ids.length >= 4 && seed % 2 === 0) {
              const pivot2 = (pivot + 2) % ids.length
              const prev = (pivot2 - 1 + ids.length) % ids.length
              ;[ids[prev], ids[pivot2]] = [ids[pivot2], ids[prev]]
            }
            working.set(level, ids)
          }
        }

        for (let sweep = 0; sweep < swapSweeps; sweep += 1) {
          await maybeYield()
          let changed = false
          for (let li = 1; li < levelKeys.length; li += 1) {
            const level = levelKeys[li]
            const prevLevel = li > 0 ? levelKeys[li - 1] : null
            const nextLevel = li + 1 < levelKeys.length ? levelKeys[li + 1] : null
            const ids = [...(working.get(level) ?? [])]
            const prevIds = prevLevel === null ? [] : (working.get(prevLevel) ?? [])
            const nextIds = nextLevel === null ? [] : (working.get(nextLevel) ?? [])

            // First, explore all permutations in 3-node windows.
            for (let start = 0; start + windowSize <= ids.length; start += 1) {
              const currentScore = levelOrderCost(level, ids, prevLevel, nextLevel, prevIds, nextIds)
              const slice = ids.slice(start, start + windowSize)
              let bestScore = currentScore
              let bestSlice = slice
              for (const permIdx of windowPermutations) {
                const permuted = permIdx.map((token) => slice[Number(token)])
                let unchanged = true
                for (let k = 0; k < windowSize; k += 1) {
                  if (permuted[k] !== slice[k]) {
                    unchanged = false
                    break
                  }
                }
                if (unchanged) continue
                const candidate = [...ids]
                candidate.splice(start, windowSize, ...permuted)
                const candidateScore = levelOrderCost(level, candidate, prevLevel, nextLevel, prevIds, nextIds)
                if (candidateScore < bestScore - 0.0001) {
                  bestScore = candidateScore
                  bestSlice = permuted
                }
              }
              if (bestSlice !== slice) {
                ids.splice(start, windowSize, ...bestSlice)
                changed = true
              }
            }

            // Then fallback to adjacent swaps for final small cleanups.
            for (let i = 0; i + 1 < ids.length; i += 1) {
              const currentScore = levelOrderCost(level, ids, prevLevel, nextLevel, prevIds, nextIds)
              const candidate = [...ids]
              ;[candidate[i], candidate[i + 1]] = [candidate[i + 1], candidate[i]]
              const candidateScore = levelOrderCost(level, candidate, prevLevel, nextLevel, prevIds, nextIds)
              if (candidateScore < currentScore - 0.0001) {
                ids[i] = candidate[i]
                ids[i + 1] = candidate[i + 1]
                changed = true
              }
            }
            working.set(level, ids)
          }
          if (!changed) break
        }
        return working
      }
      const scoreLevelOrder = (order: Map<number, string[]>) => {
        const crossingScore = countTotalAdjacentCrossings(order)
        const projectedCrossingScore = countProjectedCrossings(order)
        const rank = rankInLevel(order)
        let stretchScore = 0
        for (const e of groupEdges) {
          const sourceRank = rank.get(e.source)
          const targetRank = rank.get(e.target)
          if (sourceRank === undefined || targetRank === undefined) continue
          stretchScore += Math.abs(sourceRank - targetRank) * e.weight
        }
        return crossingScore * 1300 + projectedCrossingScore * 900 + stretchScore
      }

      const searchSeeds = Math.min(12, 4 + Math.floor(Math.max(0, maxLevelWidth - 2) / 2))
      let bestOrder = cloneLevelOrder(levelOrder)
      let bestOrderScore = scoreLevelOrder(bestOrder)
      for (let seed = 0; seed < searchSeeds; seed += 1) {
        const candidate = await optimizeLevelOrder(levelOrder, seed)
        const candidateScore = scoreLevelOrder(candidate)
        if (candidateScore < bestOrderScore - 0.0001) {
          bestOrder = candidate
          bestOrderScore = candidateScore
        }
      }
      for (const [level, ids] of bestOrder.entries()) {
        levelOrder.set(level, [...ids])
      }
      const weightedEdgeSpan = (() => {
        let totalWeight = 0
        let weightedSpan = 0
        for (const e of groupEdges) {
          const ds = depth.get(e.source)
          const dt = depth.get(e.target)
          if (ds === undefined || dt === undefined) continue
          const span = Math.max(1, dt - ds)
          totalWeight += e.weight
          weightedSpan += span * e.weight
        }
        return totalWeight > 0 ? weightedSpan / totalWeight : 1
      })()
      const compact = computeAdaptiveCompactness({
        nodeCount: group.length,
        levelCount: levelKeys.length,
        maxLevelWidth,
        edgeCount: groupEdges.length,
        crossingsBefore: groupCrossingsBefore,
        weightedEdgeSpan,
      })
      const baseGapX = Math.round(48 * compact)
      const gapY = Math.round(44 * compact)
      const sizeById = new Map(
        group.map((n) => [n.id, nodeLayoutSize(n, getInternalNode)] as const),
      )
      const isUnderParentScope = (node: Node<FlowNodeData>) => {
        if (parentKey === '__root__') return !node.parentId
        let cursor: string | undefined = node.parentId
        while (cursor) {
          if (cursor === parentKey) return true
          cursor = allById.get(cursor)?.parentId
        }
        return false
      }
      const foreignRects = nodes
        .filter((n) => n.type === 'plcBlock')
        .filter((n) => !groupIds.has(n.id))
        .filter((n) => isUnderParentScope(n))
        .map((n) => {
          const internal = getInternalNode(n.id)
          const abs = internal?.internals.positionAbsolute ?? n.position
          const size = nodeLayoutSize(n, getInternalNode)
          return {
            id: n.id,
            left: abs.x,
            top: abs.y,
            right: abs.x + size.width,
            bottom: abs.y + size.height,
          }
        })
      const evaluateObjective = (positions: Map<string, { x: number; y: number }>) => {
        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxRight = Number.NEGATIVE_INFINITY
        let maxBottom = Number.NEGATIVE_INFINITY
        const centers = new Map<string, { x: number; y: number }>()
        for (const n of group) {
          const pos = positions.get(n.id)
          const size = sizeById.get(n.id)
          if (!pos || !size) continue
          minX = Math.min(minX, pos.x)
          minY = Math.min(minY, pos.y)
          maxRight = Math.max(maxRight, pos.x + size.width)
          maxBottom = Math.max(maxBottom, pos.y + size.height)
          centers.set(n.id, { x: pos.x + size.width / 2, y: pos.y + size.height / 2 })
        }
        const area =
          Number.isFinite(minX) && Number.isFinite(minY)
            ? Math.max(1, maxRight - minX) * Math.max(1, maxBottom - minY)
            : 0
        const rects = [...centers.keys()]
          .map((id) => {
            const pos = positions.get(id)
            const size = sizeById.get(id)
            if (!pos || !size) return null
            return {
              id,
              left: pos.x,
              top: pos.y,
              right: pos.x + size.width,
              bottom: pos.y + size.height,
            }
          })
          .filter((r): r is { id: string; left: number; top: number; right: number; bottom: number } => Boolean(r))
        let overlapCount = 0
        let overlapArea = 0
        let blockProximityPenalty = 0
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const a = rects[i]
            const b = rects[j]
            const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (overlapW > 0 && overlapH > 0) {
              overlapCount += 1
              overlapArea += overlapW * overlapH
            } else {
              const gapX = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
              const gapY = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
              blockProximityPenalty += blockPairProximityPenalty(gapX, gapY)
            }
          }
        }
        for (const a of rects) {
          for (const b of foreignRects) {
            const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (overlapW > 0 && overlapH > 0) {
              overlapCount += 1
              overlapArea += overlapW * overlapH
            }
          }
        }
        let wireLength = 0
        let farPenalty = 0
        let shortPenalty = 0
        let lowXPenalty = 0
        let backwardPenalty = 0
        const edgeSegs: Array<{ source: string; target: string; s: { x: number; y: number }; t: { x: number; y: number } }> = []
        const blockFallback = fallbackNodeSize('plcBlock')
        for (const e of groupEdgeInstances) {
          const source = centers.get(e.source)
          const target = centers.get(e.target)
          if (!source || !target) continue
          const dist = Math.hypot(source.x - target.x, source.y - target.y)
          wireLength += dist
          const sourceSize = sizeById.get(e.source)
          const targetSize = sizeById.get(e.target)
          const preferred = preferredNeighborDistance(
            sourceSize?.width ?? blockFallback.width,
            targetSize?.width ?? blockFallback.width,
            baseGapX,
          )
          const penalties = connectionLengthPenalties(dist, preferred)
          farPenalty += penalties.farPenalty
          shortPenalty += penalties.shortPenalty
          lowXPenalty += lowXDistancePenalty(Math.abs(source.x - target.x), preferred)
          backwardPenalty += backwardDirectionPenalty(target.x - source.x, preferred)
          edgeSegs.push({
            source: e.source,
            target: e.target,
            s: { x: source.x, y: source.y },
            t: { x: target.x, y: target.y },
          })
        }
        let geometricCrossings = 0
        for (let i = 0; i < edgeSegs.length; i += 1) {
          for (let j = i + 1; j < edgeSegs.length; j += 1) {
            const a = edgeSegs[i]
            const b = edgeSegs[j]
            if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) {
              continue
            }
            if (segmentsIntersect(a.s, a.t, b.s, b.t)) geometricCrossings += 1
          }
        }
        let lineBlockIntersectionCount = 0
        for (const seg of edgeSegs) {
          for (const rect of rects) {
            if (rect.id === seg.source || rect.id === seg.target) continue
            if (segmentIntersectsRect(seg.s, seg.t, rect)) lineBlockIntersectionCount += 1
          }
        }
        return {
          area,
          wireLength,
          farPenalty,
          shortPenalty,
          lowXPenalty,
          backwardPenalty,
          blockProximityPenalty,
          crossings: geometricCrossings,
          overlapCount,
          overlapArea,
          lineBlockIntersectionCount,
          frameConflictCount: 0,
          frameConflictArea: 0,
          score: layoutObjectiveScore(
            geometricCrossings,
            wireLength,
            area,
            overlapCount,
            overlapArea,
            lineBlockIntersectionCount,
            farPenalty,
            shortPenalty,
            lowXPenalty,
            backwardPenalty,
            blockProximityPenalty,
          ),
        }
      }
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
      const verticalScale = 0.9 + (compact - 1) * 0.22
      const maxY = minY + compactHeight * clamp(verticalScale, 0.82, 1.08)
      const globalCenterY = (minY + maxY) / 2
      let cursorX = minX
      const levelGapAfter = new Map<number, number>()
      for (let i = 0; i + 1 < levelKeys.length; i += 1) {
        const leftLevel = levelKeys[i]
        const rightLevel = levelKeys[i + 1]
        const adjacentEdges = edgesBetweenLevels.get(`${leftLevel}->${rightLevel}`) ?? []
        const edgeWeight = adjacentEdges.reduce((sum, e) => sum + e.weight, 0)
        const crossings = countCrossingsBetween(
          leftLevel,
          rightLevel,
          levelOrder.get(leftLevel) ?? [],
          levelOrder.get(rightLevel) ?? [],
        )
        const widthPressure =
          ((levelOrder.get(leftLevel)?.length ?? 0) + (levelOrder.get(rightLevel)?.length ?? 0)) / 2
        let gap = baseGapX
        // Dense adjacent links should pull columns closer to reduce wire length.
        gap -= clamp(edgeWeight * 1.6, 0, 12)
        // Crossing-heavy boundaries get extra spacing for readability.
        gap += clamp(crossings * 0.08, 0, 18)
        // Wide levels need a bit more air to avoid visual clutter.
        gap += clamp((widthPressure - 3) * 2.4, 0, 10)
        const minGap = Math.round(20 * compact)
        const maxGap = Math.round(64 * compact)
        levelGapAfter.set(leftLevel, Math.round(clamp(gap, minGap, maxGap)))
      }
      const targetCenterY = new Map(
        group.map((n) => {
          const size = sizeById.get(n.id) ?? nodeLayoutSize(n, getInternalNode)
          return [n.id, n.position.y + size.height / 2] as const
        }),
      )
      const groupPlacedIds: string[] = []
      const initialPositions = new Map(group.map((n) => [n.id, { x: n.position.x, y: n.position.y }] as const))
      const initialBounds = (() => {
        let left = Number.POSITIVE_INFINITY
        let top = Number.POSITIVE_INFINITY
        let right = Number.NEGATIVE_INFINITY
        let bottom = Number.NEGATIVE_INFINITY
        for (const n of group) {
          const pos = initialPositions.get(n.id)
          const size = sizeById.get(n.id)
          if (!pos || !size) continue
          left = Math.min(left, pos.x)
          top = Math.min(top, pos.y)
          right = Math.max(right, pos.x + size.width)
          bottom = Math.max(bottom, pos.y + size.height)
        }
        if (!Number.isFinite(left) || !Number.isFinite(top)) {
          return { left: minX, top: minY, width: 1, height: 1 }
        }
        return {
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        }
      })()
      const fragmentGroups = (() => {
        const adjacency = new Map<string, Set<string>>()
        for (const n of group) adjacency.set(n.id, new Set())
        for (const e of groupEdges) {
          adjacency.get(e.source)?.add(e.target)
          adjacency.get(e.target)?.add(e.source)
        }
        const remaining = new Set(group.map((n) => n.id))
        const fragments: string[][] = []
        while (remaining.size) {
          const seed = remaining.values().next().value as string
          const queue = [seed]
          remaining.delete(seed)
          const ids: string[] = []
          while (queue.length) {
            const id = queue.shift()!
            ids.push(id)
            for (const neighbor of adjacency.get(id) ?? []) {
              if (!remaining.has(neighbor)) continue
              remaining.delete(neighbor)
              queue.push(neighbor)
            }
          }
          fragments.push(ids)
        }
        return fragments
      })()

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
        const rank = rankInLevel(levelOrder)
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
        const incomingPlacedAnchor = (id: string) => {
          const links = incoming.get(id) ?? []
          if (!links.length) return null
          let num = 0
          let den = 0
          for (const link of links) {
            const pos = placements.get(link.id)
            const size = sizeById.get(link.id)
            if (!pos || !size) continue
            num += (pos.y + size.height / 2) * link.weight
            den += link.weight
          }
          return den > 0 ? num / den : null
        }
        const desiredCenter = (id: string) => {
          const target = targetCenterY.get(id) ?? globalCenterY
          const anchor = incomingPlacedAnchor(id)
          return anchor === null ? target : anchor * 0.72 + target * 0.28
        }
        const ids = [...(levelOrder.get(level) ?? [])].sort((a, b) => {
          const dy = desiredCenter(a) - desiredCenter(b)
          if (Math.abs(dy) > 0.001) return dy
          return nodePriority(a) - nodePriority(b)
        })
        const halfHeights = new Map(
          ids.map((id) => [id, (sizeById.get(id)?.height ?? 0) / 2] as const),
        )
        const centers = new Map(
          ids.map((id) => [id, desiredCenter(id)] as const),
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
            const t = desiredCenter(id)
            centers.set(id, c * 0.64 + t * 0.36)
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
        cursorX += colMaxWidth + (levelGapAfter.get(level) ?? baseGapX)
      }

      // Keep blocks out of nested frame bodies in the same parent plane.
      const childFrames = nodes
        .filter((n) => n.type === 'plcFrame')
        .filter((n) => {
          const pid = n.parentId ?? '__root__'
          return pid === parentKey
        })
        .map((n) => {
          const styleWidth = readNumericStyleSize(n.style?.width as string | number | undefined)
          const styleHeight = readNumericStyleSize(n.style?.height as string | number | undefined)
          const frameWidth = Math.max(220, styleWidth ?? 320)
          const frameHeight = Math.max(140, styleHeight ?? 220)
          return {
            id: n.id,
            left: n.position.x,
            top: n.position.y,
            right: n.position.x + frameWidth,
            bottom: n.position.y + frameHeight,
          }
        })
      if (childFrames.length) {
        const avoidPad = Math.round(16 * compact)
        for (const id of groupPlacedIds) {
          const pos = placements.get(id)
          const size = sizeById.get(id)
          if (!pos || !size) continue
          let nextX = pos.x
          for (const frame of childFrames) {
            const overlaps =
              nextX < frame.right &&
              nextX + size.width > frame.left &&
              pos.y < frame.bottom &&
              pos.y + size.height > frame.top
            if (!overlaps) continue
            nextX = Math.max(nextX, frame.right + avoidPad)
          }
          if (nextX !== pos.x) placements.set(id, { x: nextX, y: pos.y })
        }
      }

      const frameConflictFor = (positions: Map<string, { x: number; y: number }>) => {
        if (!childFrames.length) return { count: 0, area: 0 }
        let count = 0
        let area = 0
        for (const n of group) {
          const pos = positions.get(n.id)
          const size = sizeById.get(n.id)
          if (!pos || !size) continue
          const left = pos.x
          const top = pos.y
          const right = pos.x + size.width
          const bottom = pos.y + size.height
          for (const frame of childFrames) {
            const overlapW = Math.min(right, frame.right) - Math.max(left, frame.left)
            const overlapH = Math.min(bottom, frame.bottom) - Math.max(top, frame.top)
            if (overlapW > 0 && overlapH > 0) {
              count += 1
              area += overlapW * overlapH
            }
          }
        }
        return { count, area }
      }

      const clonePositions = (src: Map<string, { x: number; y: number }>) =>
        new Map([...src.entries()].map(([id, pos]) => [id, { x: pos.x, y: pos.y }] as const))
      const capPlacementSpread = (
        positions: Map<string, { x: number; y: number }>,
        widthScale = 1.55,
        heightScale = 1.3,
      ) => {
        let left = Number.POSITIVE_INFINITY
        let top = Number.POSITIVE_INFINITY
        let right = Number.NEGATIVE_INFINITY
        let bottom = Number.NEGATIVE_INFINITY
        for (const id of groupPlacedIds) {
          const pos = positions.get(id)
          const size = sizeById.get(id)
          if (!pos || !size) continue
          left = Math.min(left, pos.x)
          top = Math.min(top, pos.y)
          right = Math.max(right, pos.x + size.width)
          bottom = Math.max(bottom, pos.y + size.height)
        }
        if (!Number.isFinite(left) || !Number.isFinite(top)) return
        const width = Math.max(1, right - left)
        const height = Math.max(1, bottom - top)
        // Never crush an expanded layout back into the overlapping starting bbox — that
        // erases crossings/overlap fixes and yields "no beneficial layout" on messy inputs.
        const maxWidth = Math.max(
          initialBounds.width * widthScale,
          initialBounds.width + baseGapX * 3,
          width * 0.966,
        )
        const maxHeight = Math.max(
          initialBounds.height * heightScale,
          initialBounds.height + gapY * 4,
          height * 0.966,
        )
        const scaleX = width > maxWidth ? maxWidth / width : 1
        const scaleY = height > maxHeight ? maxHeight / height : 1
        if (scaleX >= 0.999 && scaleY >= 0.999) return
        for (const id of groupPlacedIds) {
          const pos = positions.get(id)
          if (!pos) continue
          positions.set(id, {
            x: left + (pos.x - left) * scaleX,
            y: top + (pos.y - top) * scaleY,
          })
        }
      }
      const applyFragmentArrangement = (
        positions: Map<string, { x: number; y: number }>,
        mode: 'none' | 'xAsc' | 'xDesc' | 'yAsc' | 'diag',
      ) => {
        if (mode === 'none' || fragmentGroups.length < 2) return
        const bounds = fragmentGroups
          .map((ids) => {
            let minLeft = Number.POSITIVE_INFINITY
            let minTop = Number.POSITIVE_INFINITY
            let maxRight = Number.NEGATIVE_INFINITY
            let maxBottom = Number.NEGATIVE_INFINITY
            for (const id of ids) {
              const pos = positions.get(id)
              const size = sizeById.get(id)
              if (!pos || !size) continue
              minLeft = Math.min(minLeft, pos.x)
              minTop = Math.min(minTop, pos.y)
              maxRight = Math.max(maxRight, pos.x + size.width)
              maxBottom = Math.max(maxBottom, pos.y + size.height)
            }
            if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) return null
            return {
              ids,
              minLeft,
              minTop,
              maxRight,
              maxBottom,
              width: Math.max(1, maxRight - minLeft),
              height: Math.max(1, maxBottom - minTop),
              cx: (minLeft + maxRight) / 2,
              cy: (minTop + maxBottom) / 2,
            }
          })
          .filter(
            (
              fragment,
            ): fragment is {
              ids: string[]
              minLeft: number
              minTop: number
              maxRight: number
              maxBottom: number
              width: number
              height: number
              cx: number
              cy: number
            } => Boolean(fragment),
          )
        if (bounds.length < 2) return
        const ordered = [...bounds]
        if (mode === 'xAsc') ordered.sort((a, b) => a.cx - b.cx)
        else if (mode === 'xDesc') ordered.sort((a, b) => b.cx - a.cx)
        else if (mode === 'yAsc') ordered.sort((a, b) => a.cy - b.cy)
        else ordered.sort((a, b) => (a.cx + a.cy * 0.65) - (b.cx + b.cy * 0.65))
        const fragmentGapX = Math.round(baseGapX * 1.24)
        const fragmentGapY = Math.round(gapY * 1.12)
        if (mode === 'yAsc') {
          let cursorY = minY
          for (const fragment of ordered) {
            const targetMinY = cursorY
            const targetMinX = minX + (fragment.cx - minX) * 0.12
            const deltaX = targetMinX - fragment.minLeft
            const deltaY = targetMinY - fragment.minTop
            for (const id of fragment.ids) {
              const pos = positions.get(id)
              if (!pos) continue
              positions.set(id, { x: pos.x + deltaX, y: pos.y + deltaY })
            }
            cursorY += fragment.height + fragmentGapY
          }
          return
        }
        let cursorX = minX
        for (const fragment of ordered) {
          const targetMinX = cursorX
          const targetMinY = clamp(fragment.minTop, minY, maxY - fragment.height)
          const deltaX = targetMinX - fragment.minLeft
          const deltaY = targetMinY - fragment.minTop
          for (const id of fragment.ids) {
            const pos = positions.get(id)
            if (!pos) continue
            positions.set(id, { x: pos.x + deltaX, y: pos.y + deltaY })
          }
          cursorX += fragment.width + fragmentGapX
        }
      }

      const pushOutOfFrames = (positions: Map<string, { x: number; y: number }>, pad: number) => {
        if (!childFrames.length) return
        for (const id of groupPlacedIds) {
          const pos = positions.get(id)
          const size = sizeById.get(id)
          if (!pos || !size) continue
          let nextX = pos.x
          let nextY = pos.y
          for (const frame of childFrames) {
            const overlaps =
              nextX < frame.right &&
              nextX + size.width > frame.left &&
              nextY < frame.bottom &&
              nextY + size.height > frame.top
            if (!overlaps) continue
            const overlapW = Math.min(nextX + size.width, frame.right) - Math.max(nextX, frame.left)
            const overlapH = Math.min(nextY + size.height, frame.bottom) - Math.max(nextY, frame.top)
            const selfCx = nextX + size.width / 2
            const selfCy = nextY + size.height / 2
            const frameCx = (frame.left + frame.right) / 2
            const frameCy = (frame.top + frame.bottom) / 2
            if (overlapW <= overlapH) {
              const sign = selfCx >= frameCx ? 1 : -1
              nextX += sign * (overlapW + pad)
            } else {
              const sign = selfCy >= frameCy ? 1 : -1
              nextY += sign * (overlapH + pad)
            }
          }
          if (Math.abs(nextX - pos.x) > 0.1 || Math.abs(nextY - pos.y) > 0.1) {
            positions.set(id, { x: nextX, y: nextY })
          }
        }
      }

      const applyDeoverlap = (
        positions: Map<string, { x: number; y: number }>,
        iterations: number,
        gapScale: number,
      ) => {
        const deoverlapGapX = Math.round(baseGapX * 0.14 * gapScale)
        const deoverlapGapY = Math.round(gapY * 0.2 * gapScale)
        for (let iter = 0; iter < iterations; iter += 1) {
          let moved = false
          for (let i = 0; i < groupPlacedIds.length; i += 1) {
            const idA = groupPlacedIds[i]
            const posA = positions.get(idA)
            const sizeA = sizeById.get(idA)
            if (!posA || !sizeA) continue
            for (let j = i + 1; j < groupPlacedIds.length; j += 1) {
              const idB = groupPlacedIds[j]
              const posB = positions.get(idB)
              const sizeB = sizeById.get(idB)
              if (!posB || !sizeB) continue
              const overlapW = Math.min(posA.x + sizeA.width, posB.x + sizeB.width) - Math.max(posA.x, posB.x)
              const overlapH =
                Math.min(posA.y + sizeA.height, posB.y + sizeB.height) - Math.max(posA.y, posB.y)
              if (overlapW <= 0 || overlapH <= 0) continue
              const pushX = (overlapW + deoverlapGapX) / 2
              const pushY = (overlapH + deoverlapGapY) / 2
              const moveBRight = posB.x + sizeB.width / 2 >= posA.x + sizeA.width / 2
              if (pushX < pushY) {
                const delta = moveBRight ? pushX : -pushX
                positions.set(idA, { x: posA.x - delta, y: posA.y })
                positions.set(idB, { x: posB.x + delta, y: posB.y })
              } else {
                positions.set(idA, { x: posA.x, y: posA.y - pushY })
                positions.set(idB, { x: posB.x, y: posB.y + pushY })
              }
              moved = true
            }
          }
          if (!moved) break
        }
      }

      const applyCompaction = (
        positions: Map<string, { x: number; y: number }>,
        sweeps: number,
        compactScale: number,
      ) => {
        const compactGapX = Math.max(24, Math.round(baseGapX * 0.36 * compactScale))
        const leftStep = (baseGapX + 20) * compactScale
        for (let sweep = 0; sweep < sweeps; sweep += 1) {
          const idsByX = [...groupPlacedIds].sort((a, b) => (positions.get(a)?.x ?? 0) - (positions.get(b)?.x ?? 0))
          for (const id of idsByX) {
            const pos = positions.get(id)
            const size = sizeById.get(id)
            if (!pos || !size) continue
            let minAllowedX = minX
            for (const otherId of groupPlacedIds) {
              if (otherId === id) continue
              const op = positions.get(otherId)
              const os = sizeById.get(otherId)
              if (!op || !os) continue
              const verticalOverlap = pos.y < op.y + os.height && pos.y + size.height > op.y
              if (!verticalOverlap) continue
              if (op.x <= pos.x) {
                minAllowedX = Math.max(minAllowedX, op.x + os.width + compactGapX)
              }
            }
            let candidateX = Math.max(minAllowedX, pos.x - leftStep)
            for (const frame of childFrames) {
              const overlaps =
                candidateX < frame.right &&
                candidateX + size.width > frame.left &&
                pos.y < frame.bottom &&
                pos.y + size.height > frame.top
              if (overlaps) candidateX = Math.max(candidateX, frame.right + compactGapX)
            }
            if (candidateX < pos.x - 0.5) positions.set(id, { x: candidateX, y: pos.y })
          }
        }
      }

      const applyAxisSeparation = (
        positions: Map<string, { x: number; y: number }>,
        passes: number,
        pad = 12,
      ) => {
        for (let pass = 0; pass < passes; pass += 1) {
          let moved = false
          for (let i = 0; i < groupPlacedIds.length; i += 1) {
            const aId = groupPlacedIds[i]
            const aPos = positions.get(aId)
            const aSize = sizeById.get(aId)
            if (!aPos || !aSize) continue
            for (let j = i + 1; j < groupPlacedIds.length; j += 1) {
              const bId = groupPlacedIds[j]
              const bPos = positions.get(bId)
              const bSize = sizeById.get(bId)
              if (!bPos || !bSize) continue
              const overlapW = Math.min(aPos.x + aSize.width, bPos.x + bSize.width) - Math.max(aPos.x, bPos.x)
              const overlapH = Math.min(aPos.y + aSize.height, bPos.y + bSize.height) - Math.max(aPos.y, bPos.y)
              if (overlapW <= 0 || overlapH <= 0) continue
              const aCx = aPos.x + aSize.width / 2
              const bCx = bPos.x + bSize.width / 2
              const aCy = aPos.y + aSize.height / 2
              const bCy = bPos.y + bSize.height / 2
              if (overlapW <= overlapH) {
                const delta = overlapW + pad
                const sign = bCx >= aCx ? 1 : -1
                positions.set(bId, { x: bPos.x + sign * delta, y: bPos.y })
              } else {
                const delta = overlapH + pad
                const sign = bCy >= aCy ? 1 : -1
                positions.set(bId, { x: bPos.x, y: bPos.y + sign * delta })
              }
              moved = true
            }
          }
          if (!moved) break
        }
      }
      const applyMinimumBlockGap = (
        positions: Map<string, { x: number; y: number }>,
        passes: number,
        padX = 28,
        padY = 14,
      ) => {
        for (let pass = 0; pass < passes; pass += 1) {
          let moved = false
          for (let i = 0; i < groupPlacedIds.length; i += 1) {
            const aId = groupPlacedIds[i]
            const aPos = positions.get(aId)
            const aSize = sizeById.get(aId)
            if (!aPos || !aSize) continue
            for (let j = i + 1; j < groupPlacedIds.length; j += 1) {
              const bId = groupPlacedIds[j]
              const bPos = positions.get(bId)
              const bSize = sizeById.get(bId)
              if (!bPos || !bSize) continue
              const aLeft = aPos.x
              const aRight = aPos.x + aSize.width
              const aTop = aPos.y
              const aBottom = aPos.y + aSize.height
              const bLeft = bPos.x
              const bRight = bPos.x + bSize.width
              const bTop = bPos.y
              const bBottom = bPos.y + bSize.height
              const centerDx = (bLeft + bSize.width / 2) - (aLeft + aSize.width / 2)
              const centerDy = (bTop + bSize.height / 2) - (aTop + aSize.height / 2)
              const gapX = bLeft >= aLeft ? bLeft - aRight : aLeft - bRight
              const gapY = bTop >= aTop ? bTop - aBottom : aTop - bBottom
              const needX = gapX < padX
              const needY = gapY < padY
              if (!needX && !needY) continue
              if (needX && (!needY || gapX <= gapY)) {
                const delta = (padX - gapX) + 1
                const sign = centerDx >= 0 ? 1 : -1
                positions.set(bId, { x: bPos.x + sign * delta, y: bPos.y })
              } else {
                const delta = (padY - gapY) + 1
                const sign = centerDy >= 0 ? 1 : -1
                positions.set(bId, { x: bPos.x, y: bPos.y + sign * delta })
              }
              moved = true
            }
          }
          if (!moved) break
        }
      }
      const applyForeignOverlapEscape = (
        positions: Map<string, { x: number; y: number }>,
        passes: number,
        pad = 10,
      ) => {
        if (!foreignRects.length) return
        for (let pass = 0; pass < passes; pass += 1) {
          let moved = false
          for (const id of groupPlacedIds) {
            const pos = positions.get(id)
            const size = sizeById.get(id)
            if (!pos || !size) continue
            let nextX = pos.x
            let nextY = pos.y
            for (const foreign of foreignRects) {
              const overlapW = Math.min(nextX + size.width, foreign.right) - Math.max(nextX, foreign.left)
              const overlapH = Math.min(nextY + size.height, foreign.bottom) - Math.max(nextY, foreign.top)
              if (overlapW <= 0 || overlapH <= 0) continue
              const selfCx = nextX + size.width / 2
              const selfCy = nextY + size.height / 2
              const foreignCx = (foreign.left + foreign.right) / 2
              const foreignCy = (foreign.top + foreign.bottom) / 2
              if (overlapW <= overlapH) {
                const sign = selfCx >= foreignCx ? 1 : -1
                nextX += sign * (overlapW + pad)
              } else {
                const sign = selfCy >= foreignCy ? 1 : -1
                nextY += sign * (overlapH + pad)
              }
            }
            if (Math.abs(nextX - pos.x) > 0.1 || Math.abs(nextY - pos.y) > 0.1) {
              positions.set(id, { x: nextX, y: nextY })
              moved = true
            }
          }
          if (!moved) break
        }
      }

      const levelBuckets = new Map<number, string[]>()
      for (const id of groupPlacedIds) {
        const d = depth.get(id) ?? 0
        const bucket = levelBuckets.get(d)
        if (bucket) bucket.push(id)
        else levelBuckets.set(d, [id])
      }
      const applyDirectionalSeparation = (
        positions: Map<string, { x: number; y: number }>,
        passes: number,
        separationScale: number,
      ) => {
        const blockFallback = fallbackNodeSize('plcBlock')
        for (let pass = 0; pass < passes; pass += 1) {
          let shifted = false
          for (const e of groupEdgeInstances) {
            const sourcePos = positions.get(e.source)
            const targetPos = positions.get(e.target)
            const sourceSize = sizeById.get(e.source) ?? blockFallback
            const targetSize = sizeById.get(e.target) ?? blockFallback
            if (!sourcePos || !targetPos) continue
            const sourceDepth = depth.get(e.source) ?? 0
            const targetDepth = depth.get(e.target) ?? 0
            if (targetDepth <= sourceDepth) continue
            const sourceCx = sourcePos.x + sourceSize.width / 2
            const targetCx = targetPos.x + targetSize.width / 2
            const preferred = preferredNeighborDistance(sourceSize.width, targetSize.width, baseGapX)
            const minDx = Math.max(146, preferred * (0.88 * separationScale))
            const dx = targetCx - sourceCx
            if (dx < minDx) {
              const delta = minDx - dx
              const targetDepth = depth.get(e.target) ?? 0
              for (const [bucketDepth, bucketIds] of levelBuckets.entries()) {
                if (bucketDepth < targetDepth) continue
                for (const id of bucketIds) {
                  const pos = positions.get(id)
                  if (!pos) continue
                  positions.set(id, { x: pos.x + delta, y: pos.y })
                }
              }
              shifted = true
            }
          }
          pushOutOfFrames(positions, Math.round(16 * compact))
          if (!shifted) break
        }
      }

      const evaluateWithFrameConflicts = (positions: Map<string, { x: number; y: number }>) => {
        const objective = evaluateObjective(positions)
        const frameConflict = frameConflictFor(positions)
        objective.frameConflictCount = frameConflict.count
        objective.frameConflictArea = frameConflict.area
        objective.score = layoutObjectiveScore(
          objective.crossings,
          objective.wireLength,
          objective.area,
          objective.overlapCount,
          objective.overlapArea,
          objective.lineBlockIntersectionCount,
          objective.farPenalty,
          objective.shortPenalty,
          objective.lowXPenalty,
          objective.backwardPenalty,
          objective.blockProximityPenalty,
          frameConflict.count,
          frameConflict.area,
        )
        return objective
      }

      const isBetterCandidate = (
        a: ReturnType<typeof evaluateWithFrameConflicts>,
        b: ReturnType<typeof evaluateWithFrameConflicts>,
      ) => a.score < b.score - 0.01

      const seedPositions = clonePositions(placements)
      const preliminaryBefore = evaluateWithFrameConflicts(initialPositions)
      const variantProfiles = [
        { deoverlapIterations: 10, compactionSweeps: 3, directionalPasses: 4, axisPasses: 1, foreignPasses: 1 },
        { deoverlapIterations: 12, compactionSweeps: 2, directionalPasses: 4, axisPasses: 2, foreignPasses: 2 },
        { deoverlapIterations: 8, compactionSweeps: 4, directionalPasses: 3, axisPasses: 0, foreignPasses: 2 },
        { deoverlapIterations: 16, compactionSweeps: 1, directionalPasses: 5, axisPasses: 3, foreignPasses: 4 },
        { deoverlapIterations: 14, compactionSweeps: 2, directionalPasses: 5, axisPasses: 2, foreignPasses: 3 },
        { deoverlapIterations: 9, compactionSweeps: 5, directionalPasses: 3, axisPasses: 1, foreignPasses: 1 },
      ]
      const fragmentModes: Array<'none' | 'xAsc' | 'xDesc' | 'yAsc' | 'diag'> =
        fragmentGroups.length >= 2
          ? fragmentGroups.length <= 4
            ? ['none', 'xAsc', 'xDesc', 'yAsc', 'diag']
            : ['none', 'xAsc', 'xDesc', 'diag']
          : ['none']
      const shiftCandidates = [
        { x: 0, y: 0 },
        { x: Math.round(baseGapX * 0.5), y: 0 },
        { x: -Math.round(baseGapX * 0.5), y: 0 },
        { x: 0, y: Math.round(gapY * 0.9) },
        { x: 0, y: -Math.round(gapY * 0.9) },
        { x: Math.round(baseGapX * 1.05), y: 0 },
        { x: -Math.round(baseGapX * 1.05), y: 0 },
        { x: Math.round(baseGapX * 0.6), y: Math.round(gapY * 0.7) },
        { x: -Math.round(baseGapX * 0.6), y: -Math.round(gapY * 0.7) },
      ]
      const applyShift = (
        positions: Map<string, { x: number; y: number }>,
        shiftX: number,
        shiftY: number,
      ) => {
        if (shiftX === 0 && shiftY === 0) return
        for (const id of groupPlacedIds) {
          const p = positions.get(id)
          if (!p) continue
          positions.set(id, { x: p.x + shiftX, y: p.y + shiftY })
        }
      }
      const runCandidatePipeline = (
        positions: Map<string, { x: number; y: number }>,
        cfg: {
          deoverlapIterations: number
          axisPasses: number
          foreignPasses: number
          compactionSweeps: number
          directionalPasses: number
          minGapX: number
          minGapY: number
          spreadScaleX: number
          spreadScaleY: number
        },
      ) => {
        applyDeoverlap(positions, cfg.deoverlapIterations, 1)
        if (cfg.axisPasses > 0) applyAxisSeparation(positions, cfg.axisPasses, 12)
        if (cfg.foreignPasses > 0) applyForeignOverlapEscape(positions, cfg.foreignPasses, 12)
        applyCompaction(positions, cfg.compactionSweeps, 1)
        applyMinimumBlockGap(positions, 2, cfg.minGapX, cfg.minGapY)
        applyDirectionalSeparation(positions, cfg.directionalPasses, 1)
        applyMinimumBlockGap(positions, 2, cfg.minGapX, cfg.minGapY)
        // Final tidy: squeeze out avoidable overlaps, then compact leftover slack.
        applyAxisSeparation(positions, 1, 10)
        applyDeoverlap(positions, 3, 0.9)
        applyCompaction(positions, 1, 0.75)
        applyMinimumBlockGap(positions, 2, cfg.minGapX, cfg.minGapY)
        pushOutOfFrames(positions, Math.round(16 * compact))
        capPlacementSpread(positions, cfg.spreadScaleX, cfg.spreadScaleY)
      }
      const optimizeLocalPlacement = async (
        positions: Map<string, { x: number; y: number }>,
        objective: ReturnType<typeof evaluateWithFrameConflicts>,
      ) => {
        let bestPositions = clonePositions(positions)
        let bestObjective = objective
        const localMinGapX = Math.max(24, Math.round(baseGapX * 0.58))
        const localMinGapY = Math.max(12, Math.round(gapY * 0.38))
        const nodeImportance = new Map<string, number>()
        for (const id of groupPlacedIds) {
          const inWeight = (incoming.get(id) ?? []).reduce((sum, e) => sum + e.weight, 0)
          const outWeight = (outgoing.get(id) ?? []).reduce((sum, e) => sum + e.weight, 0)
          nodeImportance.set(id, inWeight + outWeight)
        }
        const orderedIds = [...groupPlacedIds].sort(
          (a, b) => (nodeImportance.get(b) ?? 0) - (nodeImportance.get(a) ?? 0),
        )
        const movementScales = [1, 0.62, 0.34]

        for (const scale of movementScales) {
          await maybeYield()
          const stepX = Math.max(8, Math.round(baseGapX * 0.34 * scale))
          const stepY = Math.max(6, Math.round(gapY * 0.34 * scale))
          const halfX = Math.max(4, Math.round(stepX * 0.55))
          const halfY = Math.max(4, Math.round(stepY * 0.55))
          const deltas = [
            { x: stepX, y: 0 },
            { x: -stepX, y: 0 },
            { x: 0, y: stepY },
            { x: 0, y: -stepY },
            { x: stepX, y: stepY },
            { x: stepX, y: -stepY },
            { x: -stepX, y: stepY },
            { x: -stepX, y: -stepY },
            { x: halfX, y: 0 },
            { x: -halfX, y: 0 },
            { x: 0, y: halfY },
            { x: 0, y: -halfY },
          ]

          for (let pass = 0; pass < 2; pass += 1) {
            let improved = false
            for (const id of orderedIds) {
              let nodeImproved = false
              for (let localIter = 0; localIter < 2; localIter += 1) {
                const origin = bestPositions.get(id)
                if (!origin) break
                let nodeBestPositions = bestPositions
                let nodeBestObjective = bestObjective
                for (const delta of deltas) {
                  const candidate = clonePositions(bestPositions)
                  candidate.set(id, { x: origin.x + delta.x, y: origin.y + delta.y })
                  applyAxisSeparation(candidate, 1, 9)
                  applyMinimumBlockGap(candidate, 1, localMinGapX, localMinGapY)
                  pushOutOfFrames(candidate, Math.round(16 * compact))
                  capPlacementSpread(candidate, 1.62, 1.38)
                  const candidateObjective = evaluateWithFrameConflicts(candidate)
                  if (isBetterCandidate(candidateObjective, nodeBestObjective)) {
                    nodeBestPositions = candidate
                    nodeBestObjective = candidateObjective
                  }
                }
                if (nodeBestPositions !== bestPositions) {
                  bestPositions = nodeBestPositions
                  bestObjective = nodeBestObjective
                  improved = true
                  nodeImproved = true
                } else {
                  break
                }
              }
              if (nodeImproved) continue
            }
            if (!improved) break
          }
        }

        return { positions: bestPositions, objective: bestObjective }
      }
      const refineCandidate = async (positions: Map<string, { x: number; y: number }>) => {
        let best = clonePositions(positions)
        let bestObjective = evaluateWithFrameConflicts(best)
        for (let settle = 0; settle < 2; settle += 1) {
          await maybeYield()
          const refined = clonePositions(best)
          runCandidatePipeline(refined, {
            deoverlapIterations: 8,
            axisPasses: 1,
            foreignPasses: 1,
            compactionSweeps: 2,
            directionalPasses: 2,
            minGapX: 28,
            minGapY: 14,
            spreadScaleX: 1.5,
            spreadScaleY: 1.28,
          })
          let refinedObjective = evaluateWithFrameConflicts(refined)
          const locallyOptimized = await optimizeLocalPlacement(refined, refinedObjective)
          if (isBetterCandidate(locallyOptimized.objective, refinedObjective)) {
            refinedObjective = locallyOptimized.objective
            for (const [id, pos] of locallyOptimized.positions.entries()) {
              refined.set(id, { x: pos.x, y: pos.y })
            }
          }
          if (!isBetterCandidate(refinedObjective, bestObjective)) break
          best = refined
          bestObjective = refinedObjective
        }
        return { positions: best, objective: bestObjective }
      }

      let bestVariantPositions: Map<string, { x: number; y: number }> | null = null
      let bestVariantObjective: ReturnType<typeof evaluateWithFrameConflicts> | null = null
      for (const profile of variantProfiles) {
        for (const shift of shiftCandidates) {
          for (const fragmentMode of fragmentModes) {
            await maybeYield()
            const candidate = clonePositions(seedPositions)
            applyShift(candidate, shift.x, shift.y)
            applyFragmentArrangement(candidate, fragmentMode)
            runCandidatePipeline(candidate, {
              deoverlapIterations: profile.deoverlapIterations,
              axisPasses: profile.axisPasses,
              foreignPasses: profile.foreignPasses,
              compactionSweeps: profile.compactionSweeps,
              directionalPasses: profile.directionalPasses,
              minGapX: 32,
              minGapY: 14,
              spreadScaleX: 1.64,
              spreadScaleY: 1.38,
            })
            const refined = await refineCandidate(candidate)
            if (!bestVariantObjective || isBetterCandidate(refined.objective, bestVariantObjective)) {
              bestVariantObjective = refined.objective
              bestVariantPositions = refined.positions
            }
          }
        }
      }
      if (bestVariantPositions) {
        for (const [id, pos] of bestVariantPositions.entries()) placements.set(id, { x: pos.x, y: pos.y })
      }

      const objectiveBefore = preliminaryBefore
      let objectiveAfter = bestVariantObjective ?? evaluateWithFrameConflicts(placements)
      const minScoreGain = Math.max(0.5, objectiveBefore.score * 0.00006)
      const acceptLayout = objectiveAfter.score < objectiveBefore.score - minScoreGain
      if (!acceptLayout) {
        for (const [id, pos] of initialPositions.entries()) {
          placements.set(id, { x: pos.x, y: pos.y })
        }
      } else {
        objectiveAfter = bestVariantObjective ?? objectiveAfter
      }

      if (acceptLayout && parentKey !== '__root__' && groupPlacedIds.length) {
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

      if (acceptLayout && parentKey !== '__root__') {
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

    const globalBefore = computeGlobalObjective(initialTargetPositions)
    const globalAfter = computeGlobalObjective(placements, parentResize)
    const globalMinScoreGain = Math.max(1.5, globalBefore.score * 0.00028)
    const acceptGlobalLayout = globalAfter.score < globalBefore.score - globalMinScoreGain
    if (!acceptGlobalLayout) {
      for (const [id, pos] of initialTargetPositions.entries()) {
        placements.set(id, { x: pos.x, y: pos.y })
      }
      parentResize.clear()
      totalCrossingsBefore = globalBefore.crossings
      totalCrossingsAfter = globalBefore.crossings
      totalScoreBefore = globalBefore.score
      totalScoreAfter = globalBefore.score
      totalLayoutArea = globalBefore.area
      totalWeightedWireLength = globalBefore.wireLength
    } else {
      totalCrossingsBefore = globalBefore.crossings
      totalCrossingsAfter = globalAfter.crossings
      totalScoreBefore = globalBefore.score
      totalScoreAfter = globalAfter.score
      totalLayoutArea = globalAfter.area
      totalWeightedWireLength = globalAfter.wireLength
    }

    let movedCount = 0
    for (const n of nodes) {
      const p = placements.get(n.id)
      if (p) {
        const dx = Math.abs((n.position.x ?? 0) - p.x)
        const dy = Math.abs((n.position.y ?? 0) - p.y)
        if (dx > 0.5 || dy > 0.5) movedCount += 1
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
    const changed = movedCount > 0
    if (layoutDebug) {
      if (changed) {
        showStatus(
          `Auto-layout ${targetBlocks.length} block(s) · score ${Math.round(totalScoreBefore)} -> ${Math.round(totalScoreAfter)} · crossings ${totalCrossingsBefore} -> ${totalCrossingsAfter} · wire ${Math.round(totalWeightedWireLength)} · area ${Math.round(totalLayoutArea)}.`,
        )
      } else {
        showStatus(
          `Layout kept current arrangement (${targetBlocks.length} block(s)); no better score found.`,
        )
      }
    } else {
      if (changed) {
        showStatus(`Auto-layout applied to ${targetBlocks.length} selected block node(s).`)
      } else {
        showStatus(`Layout found no beneficial changes for ${targetBlocks.length} block node(s).`)
      }
    }
    } finally {
      layoutRunningRef.current = false
      setLayoutRunning(false)
    }
  }, [nodes, selectedIds, edges, getInternalNode, setNodes, showStatus, layoutDebug, setLayoutRunning])

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
        void autoLayoutSelection()
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

