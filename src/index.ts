// Public entry point of @nxvet/nxst-hl7-parser.
//
// Instrument-agnostic HL7 v2.x / MLLP helpers: pure functions, zero I/O, zero dependencies.
// Instrument semantics (which field carries the patient id, which OBX rows become results, how
// the ACK header is laid out) stay in each plugin.

export type { MllpExtraction } from './mllp.ts'
export { MLLP_CR, MLLP_END, MLLP_START, extractMllpFrames, wrapMllp } from './mllp.ts'

export type { Hl7Segment } from './message.ts'
export { component, field, findSegment, findSegments, parseMessage, sanitizeHl7Text } from './message.ts'

export { hl7Timestamp, hl7TimestampWithOffset, normalizeHl7Date } from './timestamp.ts'
