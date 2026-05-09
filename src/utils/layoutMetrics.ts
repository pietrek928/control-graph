export const FRAME_FALLBACK_SIZE = { width: 320, height: 220 } as const
export const BLOCK_FALLBACK_SIZE = { width: 112, height: 78 } as const

export function readNumericStyleSize(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function fallbackNodeSize(nodeType: string | undefined) {
  return nodeType === 'plcFrame' ? FRAME_FALLBACK_SIZE : BLOCK_FALLBACK_SIZE
}

export function layoutObjectiveScore(
  crossings: number,
  wireLength: number,
  area: number,
  overlapCount = 0,
  overlapArea = 0,
  lineBlockIntersectionCount = 0,
  farPenalty = 0,
  shortPenalty = 0,
  lowXPenalty = 0,
  backwardPenalty = 0,
  blockProximityPenalty = 0,
  frameConflictCount = 0,
  frameConflictArea = 0,
) {
  // Prioritize visual cleanliness (crossings / wires through blocks / overlaps), then L→R flow, then size.
  const crossingLog = Math.log1p(Math.max(0, crossings))
  const lineBlockLog = Math.log1p(Math.max(0, lineBlockIntersectionCount))
  const overlapLog = Math.log1p(Math.max(0, overlapCount))
  return (
    crossings * 26000 +
    crossings * crossings * 2200 +
    crossingLog * 18000 +
    overlapCount * 28000 +
    overlapCount * overlapCount * 9200 +
    overlapLog * 24000 +
    lineBlockIntersectionCount * 15000 +
    lineBlockLog * 12000 +
    overlapArea * 0.62 +
    frameConflictCount * 13000 +
    frameConflictArea * 0.38 +
    Math.log1p(Math.max(0, wireLength)) * 1180 +
    farPenalty * 320 +
    shortPenalty * 410 +
    lowXPenalty * 520 +
    backwardPenalty * 480 +
    blockProximityPenalty * 480 +
    area * 0.055
  )
}

export function preferredNeighborDistance(
  sourceWidth: number,
  targetWidth: number,
  baseGapX = 48,
) {
  return Math.max(118, (sourceWidth + targetWidth) * 0.5) + baseGapX * 0.74
}

export function connectionLengthPenalties(distance: number, preferredDistance: number) {
  const minDistance = Math.max(138, preferredDistance * 0.88)
  const maxDistance = preferredDistance * 1.06
  const shortExcess = Math.max(0, minDistance - distance)
  const farExcess = Math.max(0, distance - maxDistance)
  return {
    shortPenalty: Math.log1p(shortExcess),
    farPenalty: Math.log1p(farExcess),
  }
}

export function lowXDistancePenalty(dxAbs: number, preferredDistance: number) {
  const minXDistance = Math.max(152, preferredDistance * 0.94)
  return Math.log1p(Math.max(0, minXDistance - dxAbs))
}

export function backwardDirectionPenalty(dx: number, preferredDistance: number) {
  const minForwardDx = Math.max(58, preferredDistance * 0.48)
  return Math.log1p(Math.max(0, minForwardDx - dx))
}

export function blockPairProximityPenalty(
  gapX: number,
  gapY: number,
  minGapX = 40,
  minGapY = 18,
) {
  const xDeficit = Math.max(0, minGapX - gapX)
  const yDeficit = Math.max(0, minGapY - gapY)
  if (xDeficit <= 0 && yDeficit <= 0) return 0
  return Math.log1p(xDeficit) + 0.4 * Math.log1p(yDeficit)
}

function segOrientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by)
  if (Math.abs(v) < 1e-6) return 0
  return v > 0 ? 1 : -1
}

export function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
) {
  const o1 = segOrientation(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y)
  const o2 = segOrientation(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y)
  const o3 = segOrientation(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y)
  const o4 = segOrientation(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y)
  return o1 !== o2 && o3 !== o4
}

export function segmentIntersectsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
) {
  const pointInRect = (p: { x: number; y: number }) =>
    p.x > rect.left && p.x < rect.right && p.y > rect.top && p.y < rect.bottom

  if (pointInRect(a) || pointInRect(b)) return true

  const r1 = { x: rect.left, y: rect.top }
  const r2 = { x: rect.right, y: rect.top }
  const r3 = { x: rect.right, y: rect.bottom }
  const r4 = { x: rect.left, y: rect.bottom }
  return (
    segmentsIntersect(a, b, r1, r2) ||
    segmentsIntersect(a, b, r2, r3) ||
    segmentsIntersect(a, b, r3, r4) ||
    segmentsIntersect(a, b, r4, r1)
  )
}
