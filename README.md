# Control Graph

A **PLC-style execution graph editor** in the browser: drag blocks from a palette, wire typed ports, group logic in resizable **frames** (with nesting), and author **inline C++** on configurable **CODE** blocks. Projects can contain **multiple sheets**; a **SHEET** block exposes typed inputs/outputs and calls another sheet by ID. Built with **React**, **TypeScript**, **Vite**, and [**React Flow**](https://reactflow.dev/) (`@xyflow/react`).

## Features

- **Block library** — Logic (AND, OR, NOT), timers (TON), counters (CTU), math/compare, PID, I/O (INPUT / OUTPUT), **CODE** (custom ports + C++ body), **SHEET** (cross-sheet call via JSON port specs + target sheet ID), **FRAME** (grouping + BOOL event input).
- **Multi-sheet projects** — Toolbar sheet picker, add/remove sheets. Clipboard **Copy project JSON** saves every sheet; **Import sheet…** loads a full project document (single-sheet JSON still imports). The default demo includes a **Main** sheet plus an **Alarms** sheet referenced by a SHEET block.
- **Typed connections** — Wires validate on `BOOL`, `INT`, `REAL`, `WORD`, `TIME`; reconnect supported; one wire per input.
- **Frames** — Drop blocks inside a frame; **nested frames** allowed; parent picked by innermost hit; cycles prevented when reparenting.
- **CODE / SHEET port specs** — `inputsSpec` / `outputsSpec` as JSON port arrays (shared parsing and hover/tooltip formatting via `codeBlockPorts.ts`).
- **Auto-layout** — Select **two or more block nodes** (same parent scope), then **Ctrl/Cmd+J**. Layout runs **asynchronously** with a status-bar spinner and elapsed time; nodes are **not draggable** while layout runs. Improvements are accepted purely on **objective score** (crossings, wire–block intersections, overlaps, spacing, left-to-right bias, frame conflicts, etc.); see `src/utils/layoutMetrics.ts`. Toggle **Layout dbg** in the toolbar for live metrics and detailed status text after a run.
- **Settings** — Double-click blocks with settings (CODE, PID, INPUT, SHEET, …); anchored panel next to the node.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build   # typecheck + production bundle
npm run lint    # ESLint
npm run preview # serve dist locally
```

## Playwright event runner

Replay arbitrary input events from CLI to validate interaction bugs (selection, undo, layout smoke tests, etc.).

```bash
# Keep dev server running in another terminal
npm run dev

# Run sample Shift-box smoke sequence
npm run pw:events -- --events-file scripts/events/shift-selection-smoke.json

# Additional ready scenarios
npm run pw:events -- --events-file scripts/events/frame-not-auto-selected.json
npm run pw:events -- --events-file scripts/events/additive-two-boxes.json
npm run pw:events -- --events-file scripts/events/ctrl-z-validation.json
npm run pw:events -- --events-file scripts/events/layout-benchmark.json
npm run pw:events -- --events-file scripts/events/layout-benchmark-all-block-types.json
npm run pw:events -- --events-file scripts/events/layout-benchmark-case-dense-cluster.json
npm run pw:events -- --events-file scripts/events/layout-benchmark-case-reverse-flow.json
npm run pw:events -- --events-file scripts/events/layout-benchmark-case-frame-pressure.json

# Shortcut: complex all-block-types benchmark
npm run pw:layout:all-types

# Saved multi-case layout benchmark suite
npm run pw:layout:suite
```

`pw:layout:all-types` drives the current default canvas in the app (no import step).

Pass inline JSON when testing custom paths:

```bash
npm run pw:events -- --events '[
  {"type":"focus","selector":".flow-wrap"},
  {"type":"keydown","key":"Shift"},
  {"type":"down","x":220,"y":180,"button":"left"},
  {"type":"move","x":680,"y":520,"steps":24},
  {"type":"up","button":"left"},
  {"type":"keyup","key":"Shift"},
  {"type":"state","label":"after-box"}
]'
```

Useful options:

- `--url http://127.0.0.1:5173`
- `--browser chromium|firefox|webkit`
- `--headed` (show browser window)
- `--screenshot tmp/result.png`

## Persistence formats

### Project JSON (primary)

Used by **Copy project JSON** and the import dialog. Top-level shape:

```json
{
  "format": "control-graph-project",
  "version": 1,
  "activeSheetId": "sheet-main",
  "sheets": [
    { "id": "sheet-main", "name": "Main", "nodes": [], "edges": [] }
  ]
}
```

Each sheet has its own `nodes` / `edges` (same node and edge fields as React Flow). **`activeSheetId`** selects which sheet opens first after import.

### Single-sheet JSON (legacy / round-trip)

Still supported by the parser for older files:

```json
{
  "format": "control-graph-sheet",
  "version": 1,
  "nodes": [],
  "edges": []
}
```

Legacy import also accepts `{ "nodes": [], "edges": [] }` without `format` / `version`. Edges whose endpoints are missing after import are dropped.

- **`nodes`** — `id`, `type` (`plcBlock` | `plcFrame`), `position`, `data`, optional `parentId`, `extent`, `style`. Block-specific fields live under `data` (e.g. CODE/SHEET `settings`).
- **`edges`** — `id`, `source`, `target`, optional `sourceHandle` / `targetHandle`, styling fields as in React Flow.

Implementation: `src/utils/flowSheetJson.ts` (`serializeFlowProject`, `parseFlowProjectJson`, plus sheet helpers).

## Project layout

| Path | Role |
|------|------|
| `src/components/FlowEditor.tsx` | Canvas, multi-sheet state, React Flow wiring, drop/drag reparent, copy/import project, layout-running UI |
| `src/components/PLCBlockNode.tsx` | Block chrome, handles, hover flyouts (CODE/SHEET port specs) |
| `src/components/PLCFrameNode.tsx` | Frame resizer + event handle |
| `src/components/BlockPalette.tsx` | Draggable palette |
| `src/components/BlockSettingsModal.tsx` | Node settings UI |
| `src/data/blockDefinitions.tsx` | Block metadata (ports, categories, settings fields) |
| `src/data/defaultFlowGraph.ts` | Default nodes/edges and extra demo sheet |
| `src/hooks/useCanvasShortcuts.ts` | Canvas shortcuts, clipboard, undo, **auto-layout** pipeline |
| `src/utils/layoutMetrics.ts` | Layout **objective** (score components and geometry helpers) |
| `src/utils/connectionValidation.ts` | Typed connection rules |
| `src/utils/flowSheetJson.ts` | Serialize / parse project + sheet |
| `src/utils/codeBlockPorts.ts` | CODE/SHEET port JSON parse, effective ports, summary lines |
| `src/utils/frameHitTest.ts` | Frame hit-testing + reattach helpers |
| `scripts/playwright-events.mjs` | CLI event replay |
| `scripts/events/*.json` | Recorded scenarios (incl. layout + Ctrl+Z checks) |

## Stack

- React 19, TypeScript, Vite 8  
- `@xyflow/react` 12  
- Zustand (optional store scaffold under `src/store/`)

## Contributing

This repo is **private**. Push with your usual GitHub auth (HTTPS token or SSH). Example:

```bash
git add -A && git commit -m "your message"
git push origin master
```

Use `git push --force origin master` only when you intentionally rewrite remote history.
