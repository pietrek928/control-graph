import type { BlockDefinition } from '../types/plc'

/** Central registry: metadata drives handles, palette, validation, and hover hints */
export const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    type: 'AND',
    label: 'AND',
    category: 'Logic',
    description: 'Boolean AND of two inputs',
    symbolHint: 'AND — both inputs must be TRUE',
    inputs: [
      { id: 'in1', label: 'IN1', type: 'BOOL', hint: 'IN1 · BOOL' },
      { id: 'in2', label: 'IN2', type: 'BOOL', hint: 'IN2 · BOOL' },
    ],
    outputs: [{ id: 'out', label: 'OUT', type: 'BOOL', hint: 'OUT · BOOL' }],
  },
  {
    type: 'OR',
    label: 'OR',
    category: 'Logic',
    description: 'Boolean OR of two inputs',
    symbolHint: 'OR — at least one input TRUE',
    inputs: [
      { id: 'in1', label: 'IN1', type: 'BOOL' },
      { id: 'in2', label: 'IN2', type: 'BOOL' },
    ],
    outputs: [{ id: 'out', label: 'OUT', type: 'BOOL' }],
  },
  {
    type: 'NOT',
    label: 'NOT',
    category: 'Logic',
    description: 'Boolean negation',
    symbolHint: 'NOT — inverts BOOL',
    inputs: [{ id: 'in', label: 'IN', type: 'BOOL' }],
    outputs: [{ id: 'out', label: 'OUT', type: 'BOOL' }],
  },
  {
    type: 'TON',
    label: 'TON',
    category: 'Timers',
    description: 'On-delay timer',
    symbolHint: 'TON — Q TRUE after IN held for PT',
    inputs: [
      { id: 'in', label: 'IN', type: 'BOOL' },
      { id: 'pt', label: 'PT', type: 'TIME', hint: 'Preset time · TIME' },
    ],
    outputs: [
      { id: 'q', label: 'Q', type: 'BOOL' },
      { id: 'et', label: 'ET', type: 'TIME', hint: 'Elapsed time · TIME' },
    ],
  },
  {
    type: 'CTU',
    label: 'CTU',
    category: 'Counters',
    description: 'Count up',
    symbolHint: 'CTU — rising edge on CU increments CV',
    inputs: [
      { id: 'cu', label: 'CU', type: 'BOOL' },
      { id: 'r', label: 'R', type: 'BOOL', hint: 'Reset · BOOL' },
      { id: 'pv', label: 'PV', type: 'INT' },
    ],
    outputs: [
      { id: 'q', label: 'Q', type: 'BOOL' },
      { id: 'cv', label: 'CV', type: 'INT' },
    ],
  },
  {
    type: 'ADD',
    label: 'ADD',
    category: 'Math',
    description: 'Add two integers',
    symbolHint: 'ADD — integer sum A + B',
    inputs: [
      { id: 'a', label: 'A', type: 'INT' },
      { id: 'b', label: 'B', type: 'INT' },
    ],
    outputs: [{ id: 'out', label: 'OUT', type: 'INT' }],
  },
  {
    type: 'GT',
    label: 'GT',
    category: 'Compare',
    description: 'A greater than B',
    symbolHint: 'GT — BOOL when A > B',
    inputs: [
      { id: 'a', label: 'A', type: 'INT' },
      { id: 'b', label: 'B', type: 'INT' },
    ],
    outputs: [{ id: 'out', label: 'OUT', type: 'BOOL' }],
  },
  {
    type: 'MOVE',
    label: 'MOVE',
    category: 'Move',
    description: 'Copy word value',
    symbolHint: 'MOVE — copies WORD through',
    inputs: [{ id: 'in', label: 'IN', type: 'WORD' }],
    outputs: [{ id: 'out', label: 'OUT', type: 'WORD' }],
  },
  {
    type: 'PID',
    label: 'PID',
    category: 'Control',
    description: 'PID controller (parallel form)',
    symbolHint: 'PID — proportional–integral–derivative',
    settingsFields: [
      { key: 'kp', label: 'Kp', type: 'number', default: 1, min: 0, step: 0.01 },
      { key: 'ki', label: 'Ki', type: 'number', default: 0, min: 0, step: 0.001 },
      { key: 'kd', label: 'Kd', type: 'number', default: 0, min: 0, step: 0.01 },
      {
        key: 'directAction',
        label: 'Direct action',
        type: 'checkbox',
        default: true,
      },
    ],
    inputs: [
      { id: 'sp', label: 'SP', type: 'REAL', hint: 'Setpoint · REAL' },
      { id: 'pv', label: 'PV', type: 'REAL', hint: 'Process variable · REAL' },
    ],
    outputs: [{ id: 'out', label: 'OUT', type: 'REAL', hint: 'Manipulated output · REAL' }],
  },
  {
    type: 'INPUT',
    label: 'IN',
    category: 'I/O',
    description: 'External / tag input source',
    symbolHint: 'INPUT — mapped process value',
    settingsFields: [
      { key: 'tag', label: 'Tag / address', type: 'text', default: 'IW0' },
      { key: 'note', label: 'Note', type: 'text', default: '' },
    ],
    inputs: [],
    outputs: [{ id: 'value', label: 'OUT', type: 'REAL', hint: 'Value · REAL' }],
  },
  {
    type: 'OUTPUT',
    label: 'OUT',
    category: 'I/O',
    description: 'External / tag output sink',
    symbolHint: 'OUTPUT — mapped process write',
    settingsFields: [
      { key: 'tag', label: 'Tag / address', type: 'text', default: 'QW0' },
      { key: 'note', label: 'Note', type: 'text', default: '' },
    ],
    inputs: [{ id: 'value', label: 'IN', type: 'REAL', hint: 'Value · REAL' }],
    outputs: [],
  },
  {
    type: 'CODE',
    label: 'CODE',
    category: 'Advanced',
    description:
      'Free-form C++ body with configurable typed inputs and outputs (JSON). Execution is defined by your runtime/codegen.',
    symbolHint: 'CODE — inline C++ · typed I/O from JSON',
    settingsFields: [
      {
        key: 'inputsSpec',
        label: 'Inputs (JSON)',
        type: 'textarea',
        rows: 5,
        default:
          '[{"id":"in0","label":"IN0","type":"BOOL"},{"id":"in1","label":"IN1","type":"BOOL"}]',
      },
      {
        key: 'outputsSpec',
        label: 'Outputs (JSON)',
        type: 'textarea',
        rows: 5,
        default: '[{"id":"out0","label":"OUT0","type":"BOOL"}]',
      },
      {
        key: 'code',
        label: 'C++ body',
        type: 'textarea',
        rows: 14,
        default: `// Typed I/O: use names from the JSON lists (e.g. in0, in1 → out0).
bool out0 = in0 && in1;
`,
      },
    ],
    inputs: [
      { id: 'in0', label: 'IN0', type: 'BOOL' },
      { id: 'in1', label: 'IN1', type: 'BOOL' },
    ],
    outputs: [{ id: 'out0', label: 'OUT0', type: 'BOOL' }],
  },
  {
    type: 'SHEET',
    label: 'SHEET',
    category: 'Structure',
    description: 'Reference another sheet through typed inputs/outputs.',
    symbolHint: 'SHEET — calls another sheet via exposed IO',
    settingsFields: [
      { key: 'sheetId', label: 'Target sheet ID', type: 'text', default: '' },
      {
        key: 'inputsSpec',
        label: 'Inputs (JSON)',
        type: 'textarea',
        rows: 5,
        default: '[{"id":"in0","label":"IN0","type":"BOOL"}]',
      },
      {
        key: 'outputsSpec',
        label: 'Outputs (JSON)',
        type: 'textarea',
        rows: 5,
        default: '[{"id":"out0","label":"OUT0","type":"BOOL"}]',
      },
    ],
    inputs: [{ id: 'in0', label: 'IN0', type: 'BOOL' }],
    outputs: [{ id: 'out0', label: 'OUT0', type: 'BOOL' }],
  },
  {
    type: 'FRAME',
    label: 'Frame',
    category: 'Structure',
    description: 'Groups blocks; nest frames. BOOL event input (left).',
    symbolHint: 'Frame — subnet; EVT enables grouped logic',
    inputs: [{ id: 'event', label: 'EVT', type: 'BOOL', hint: 'Enable / trigger · BOOL' }],
    outputs: [],
  },
]

export const BLOCK_REGISTRY: Record<string, BlockDefinition> = Object.fromEntries(
  BLOCK_DEFINITIONS.map((b) => [b.type, b]),
)

export function getBlockDefinition(blockType: string): BlockDefinition | undefined {
  return BLOCK_REGISTRY[blockType]
}
