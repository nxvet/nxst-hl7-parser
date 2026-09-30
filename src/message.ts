// HL7 v2.x message structure: segments, fields and components.
//
// Pure functions, zero I/O, no dependency on any particular analyzer. Which segment carries the
// patient id, which OBX rows are results, how an ACK is laid out: all of that is instrument
// semantics and belongs to the plugin, not here.
//
// Three HL7 conventions are handled once in this module so callers never have to remember them:
//   1. Field numbering follows the HL7 spec. In MSH the field separator itself is MSH-1, so
//      `MSH-n = fields[n-1]`; in every other segment `SEG-n = fields[n]` (`fields[0]` is the
//      segment name). `field()` absorbs the difference: `field(msh, 10)` is MSH-10.
//   2. Components are 1-based: `component(value, 1)` is the part before the first `^`.
//   3. Segment terminators are tolerated in every common form (`\r`, `\r\n`, `\n`).

/** One HL7 segment. `fields[0]` is the segment name, so `fields` is one longer than the field count. */
export interface Hl7Segment {
  /** The three-letter segment name (`MSH`, `PID`, `OBX`, ...), whitespace-trimmed. */
  name: string
  /** The segment split on `|`. */
  fields: string[]
}

/**
 * Splits a message into segments.
 *
 * The standard segment terminator is `\r`, but `\r\n` and `\n` show up in practice (messages
 * that passed through a Windows tool, analyzers that send `\r\n`), so all three are accepted.
 * Every line is trimmed before it is split: `|` is not whitespace, so trimming never changes the
 * field structure, but it absorbs stray indentation and trailing blanks. Blank lines (a trailing
 * terminator, extra empty lines) are skipped. The segment name is trimmed as well, so a name
 * padded before its first `|` still matches in `findSegment`.
 */
export const parseMessage = (text: string): Hl7Segment[] => {
  const segments: Hl7Segment[] = []

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()

    if (line === '') continue

    const fields = line.split('|')

    segments.push({ name: fields[0].trim(), fields })
  }

  return segments
}

/**
 * Reads one field by its HL7 number (1-based, as written in the spec). The MSH offset is
 * applied here (see convention 1 in the module header).
 *
 * A missing segment or a field that was not sent yields an empty string, so callers do not need
 * `?? ''` everywhere.
 */
export const field = (segment: Hl7Segment | undefined, n: number): string => {
  if (segment === undefined) return ''

  const index = segment.name === 'MSH' ? n - 1 : n

  return segment.fields[index] ?? ''
}

/**
 * Reads one component (split on `^`), 1-based: `component('A^B', 2)` is `'B'`.
 * A value without `^` is its own first component; an index past the end yields `''`.
 */
export const component = (value: string, index: number): string => value.split('^')[index - 1] ?? ''

/** The first segment with the given name, or `undefined`. */
export const findSegment = (segments: Hl7Segment[], name: string): Hl7Segment | undefined => segments.find((segment) => segment.name === name)

/** Every segment with the given name, in message order (OBX and NTE usually repeat). */
export const findSegments = (segments: Hl7Segment[], name: string): Hl7Segment[] => segments.filter((segment) => segment.name === name)

/**
 * Makes free text safe to place inside an HL7 field: the default delimiters (`|`, `^`, `~`,
 * `\`, `&`) and line breaks are replaced with spaces, then the result is trimmed. Use it for any
 * text you did not write yourself (an error message in an ACK, for example), so that you never
 * build a malformed message.
 */
export const sanitizeHl7Text = (text: string): string => text.replace(/[|^~\\&\r\n]/g, ' ').trim()
