# Control Graph

A **PLC-style execution graph editor** in the browser: drag blocks from a palette, wire typed ports, group logic in resizable **frames** (with nesting), and author **inline C++** on configurable **CODE** blocks. Built with **React**, **TypeScript**, **Vite**, and [**React Flow**](https://reactflow.dev/) (`@xyflow/react`).

## Features

- **Block library** — Logic (AND, OR, NOT), timers (TON), counters (CTU), math/compare, PID, I/O (INPUT), **CODE** (custom ports + C++ body), **FRAME** (grouping + BOOL event input).
- **Typed connections** — Wires validate on `BOOL`, `INT`, `REAL`, `WORD`, `TIME`; reconnect supported; one wire per input.
- **Frames** — Drop blocks inside a frame; **nested frames** allowed; parent picked by innermost hit; cycles prevented when reparenting.
- **CODE block** — `inputsSpec` / `outputsSpec` as JSON port lists; C++ body in settings; live JSON hints when editing.
- **Settings** — Double-click blocks with settings (CODE, PID, INPUT); anchored panel next to the node.
- **Sheet persistence** — **Copy sheet JSON** / **Import sheet…** exports or replaces the **entire canvas** (all nodes, edges, positions, `parentId`, block `data`). Format: `control-graph-sheet` v1 (see below).

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

Replay arbitrary input events from CLI to validate interaction bugs.

```bash
# Keep dev server running in another terminal
npm run dev

# Run sample Shift-box smoke sequence
npm run pw:events -- --events-file scripts/events/shift-selection-smoke.json

# Additional ready scenarios
npm run pw:events -- --events-file scripts/events/frame-not-auto-selected.json
npm run pw:events -- --events-file scripts/events/additive-two-boxes.json
```

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

## Sheet JSON format

Used by **Copy sheet JSON** and **Import sheet**. Top-level object:

```json
{
  "format": "control-graph-sheet",
  "version": 1,
  "nodes": [],
  "edges": []
}
```

- **`nodes`** — `id`, `type` (`plcBlock` | `plcFrame`), `position`, `data`, optional `parentId`, `extent`, `style`. Block-specific fields (e.g. CODE `settings`) live under `data`.
- **`edges`** — `id`, `source`, `target`, optional `sourceHandle` / `targetHandle`, styling fields as in React Flow.

Legacy import also accepts `{ "nodes": [], "edges": [] }` without `format` / `version`. Edges whose endpoints are missing after import are dropped.

## Project layout

| Path | Role |
|------|------|
| `src/components/FlowEditor.tsx` | Canvas, React Flow wiring, drop/drag reparent, sheet copy/import |
| `src/components/PLCBlockNode.tsx` | Block chrome, handles, hover flyout |
| `src/components/PLCFrameNode.tsx` | Frame resizer + event handle |
| `src/components/BlockPalette.tsx` | Draggable palette |
| `src/components/BlockSettingsModal.tsx` | Node settings UI |
| `src/data/blockDefinitions.tsx` | Block metadata (ports, categories, settings fields) |
| `src/utils/connectionValidation.ts` | Typed connection rules |
| `src/utils/flowSheetJson.ts` | Serialize / parse full sheet |
| `src/utils/codeBlockPorts.ts` | CODE port JSON parse + live status |
| `src/utils/frameHitTest.ts` | Frame hit-testing + reattach helpers |

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
