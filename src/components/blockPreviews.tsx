import type { CSSProperties, FC, ReactElement } from 'react'
import { cloneElement, isValidElement } from 'react'
import './blockPreviews.css'

const svgBase: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
}

/** Small illustrative SVGs — artwork fills the whole viewBox so nodes show solid glyphs */

export function PreviewAND() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="10" fill="#0891b2" stroke="#0e7490" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="38"
        fontWeight="700"
        fontFamily="system-ui"
      >
        &
      </text>
    </svg>
  )
}

export function PreviewOR() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="10" fill="#6366f1" stroke="#4f46e5" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="26"
        fontWeight="700"
        fontFamily="system-ui"
      >
        ≥1
      </text>
    </svg>
  )
}

export function PreviewNOT() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="10" fill="#f472b6" stroke="#be185d" strokeWidth="2" />
      <polygon points="28,14 56,28 28,42" fill="#fce7f3" stroke="#be185d" strokeWidth="1.5" />
      <circle cx="58" cy="28" r="9" fill="#fce7f3" stroke="#be185d" strokeWidth="2" />
      <text x="54.5" y="33" fill="#9d174d" fontSize="13" fontWeight="800">
        1
      </text>
    </svg>
  )
}

export function PreviewTON() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#fcd34d" stroke="#d97706" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#78350f"
        fontSize="22"
        fontWeight="800"
      >
        TON
      </text>
      <path d="M56 18 v18 M48 27 h16" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function PreviewCTU() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#86efac" stroke="#16a34a" strokeWidth="2" />
      <text x="12" y="32" fill="#14532d" fontSize="17" fontWeight="800">
        CTU
      </text>
      <text x="56" y="34" textAnchor="middle" fill="#14532d" fontSize="26" fontWeight="800">
        +
      </text>
    </svg>
  )
}

export function PreviewADD() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#e0e7ff" stroke="#4338ca" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#312e81"
        fontSize="52"
        fontWeight="800"
      >
        +
      </text>
    </svg>
  )
}

export function PreviewGT() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#fee2e2" stroke="#dc2626" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#991b1b"
        fontSize="56"
        fontWeight="800"
      >
        &gt;
      </text>
    </svg>
  )
}

export function PreviewMOVE() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#ddd6fe" stroke="#6d28d9" strokeWidth="2" />
      <path d="M18 28 h36 M38 20 v16" stroke="#5b21b6" strokeWidth="3" strokeLinecap="round" />
      <polygon points="58,28 50,23 50,33" fill="#5b21b6" />
    </svg>
  )
}

export function PreviewPID() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#fb923c" stroke="#c2410c" strokeWidth="2" />
      <text
        x="40"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#431407"
        fontSize="22"
        fontWeight="800"
        fontFamily="system-ui"
      >
        PID
      </text>
      <path
        d="M12 44 Q40 38 68 44"
        fill="none"
        stroke="#9a3412"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PreviewFRAME() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect
        x="4"
        y="6"
        width="72"
        height="44"
        rx="8"
        fill="rgba(15,23,42,0.6)"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <circle cx="14" cy="28" r="5" fill="#020617" stroke="#0ea5e9" strokeWidth="2" />
      <text x="26" y="22" fill="#94a3b8" fontSize="10" fontWeight="700">
        FRAME
      </text>
      <text x="26" y="38" fill="#64748b" fontSize="8" fontWeight="600">
        nested OK
      </text>
    </svg>
  )
}

export function PreviewCODE() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
      <text
        x="40"
        y="22"
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="11"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
      >
        {'{ }'}
      </text>
      <text
        x="40"
        y="40"
        textAnchor="middle"
        fill="#38bdf8"
        fontSize="10"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
      >
        C++
      </text>
    </svg>
  )
}

export function PreviewINPUT() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
      <text x="14" y="33" fill="#e2e8f0" fontSize="14" fontWeight="700">
        IN
      </text>
      <path d="M44 28 h22 M56 22 v12" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
      <polygon points="72,28 64,23 64,33" fill="#38bdf8" />
    </svg>
  )
}

export function PreviewOUTPUT() {
  return (
    <svg viewBox="0 0 80 56" style={svgBase} aria-hidden>
      <rect width="80" height="56" rx="8" fill="#1f2937" stroke="#94a3b8" strokeWidth="2" />
      <text x="36" y="33" fill="#e2e8f0" fontSize="14" fontWeight="700">
        OUT
      </text>
      <polygon points="16,28 24,23 24,33" fill="#f97316" />
      <path d="M24 28 h22 M36 22 v12" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const previews: Record<string, FC> = {
  AND: PreviewAND,
  OR: PreviewOR,
  NOT: PreviewNOT,
  TON: PreviewTON,
  CTU: PreviewCTU,
  ADD: PreviewADD,
  GT: PreviewGT,
  MOVE: PreviewMOVE,
  PID: PreviewPID,
  INPUT: PreviewINPUT,
  OUTPUT: PreviewOUTPUT,
  CODE: PreviewCODE,
  FRAME: PreviewFRAME,
}

export function BlockPreview({
  blockType,
  variant = 'palette',
}: {
  blockType: string
  /** `node`: stretch artwork to fill the PLC block body */
  variant?: 'palette' | 'node'
}) {
  const Cmp = previews[blockType] ?? PreviewAND
  const inner = <Cmp />

  if (variant !== 'node') {
    return inner
  }

  if (!isValidElement(inner)) {
    return inner
  }

  return (
    <div className="block-preview block-preview--fill">
      {cloneElement(inner as ReactElement<{ preserveAspectRatio?: string; style?: CSSProperties }>, {
        preserveAspectRatio: 'xMidYMid meet',
        style: {
          width: '100%',
          height: '100%',
          display: 'block',
        },
      })}
    </div>
  )
}
