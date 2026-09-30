// MLLP (Minimal Lower Layer Protocol) framing: `<SB> message <EB><CR>`.
//
// Pure functions, zero I/O. The only runtime API used is the global `Buffer`; nothing is
// imported from `node:*`, so the module bundles cleanly into a single-file plugin.

/** MLLP `<SB>` (start block, `0x0B`): the first byte of every frame. */
export const MLLP_START = 0x0b

/** MLLP `<EB>` (end block, `0x1C`): the byte that closes a frame. */
export const MLLP_END = 0x1c

/** MLLP `<CR>` (`0x0D`): the carriage return that normally follows `<EB>`. */
export const MLLP_CR = 0x0d

/** The result of one `extractMllpFrames` pass. */
export interface MllpExtraction {
  /** Every complete message found in this pass, with `<SB>`, `<EB>` and `<CR>` removed. */
  frames: string[]
  /**
   * The unfinished tail. The caller keeps it and prepends it to the next chunk.
   * Invariant: either empty or starting with `<SB>` (a frame that has not been closed yet).
   */
  rest: Buffer
  /** How many bytes outside any frame were dropped (boot-up noise, stray peer output). */
  discarded: number
}

/**
 * Extracts every complete MLLP frame from the accumulated bytes.
 *
 * TCP does not guarantee "one `data` event = one message", so three situations are handled
 * together:
 *   * one chunk may contain several frames;
 *   * one frame may span several chunks (the unfinished part is returned in `rest`);
 *   * bytes before `<SB>` are noise and are dropped. Only their count is reported, never their
 *     content: the noise may be another device's data and must not end up in a log.
 *
 * `<EB>` is normally followed by `<CR>`; when it is, the `<CR>` is consumed too. When it is not,
 * extraction carries on anyway (tolerating non-conforming peers). Conversely, if the `<CR>`
 * arrives late, at the start of the next chunk, it is dropped as one byte of noise. That is
 * harmless: the frame was already emitted in the previous pass, and HL7 content never contains
 * `<SB>`, so no frame can be swallowed by mistake.
 *
 * `rest` is an independent copy of the unfinished tail, not a view into `buffer`, so holding on
 * to it does not keep a large input buffer alive.
 */
export const extractMllpFrames = (buffer: Buffer): MllpExtraction => {
  const frames: string[] = []
  let discarded = 0
  let cursor = 0

  for (;;) {
    const start = buffer.indexOf(MLLP_START, cursor)

    if (start === -1) {
      // Not even a start byte: everything left is noise and nothing needs to be kept.
      discarded += buffer.length - cursor

      return { frames, rest: Buffer.alloc(0), discarded }
    }

    discarded += start - cursor

    const end = buffer.indexOf(MLLP_END, start + 1)

    if (end === -1) {
      // The frame is not complete yet: keep it from the start byte on, byte for byte.
      return { frames, rest: Buffer.from(buffer.subarray(start)), discarded }
    }

    frames.push(buffer.subarray(start + 1, end).toString('utf-8'))

    cursor = buffer[end + 1] === MLLP_CR ? end + 2 : end + 1
  }
}

/** Wraps one HL7 message into an MLLP frame: `<SB>` + UTF-8 text + `<EB><CR>`. */
export const wrapMllp = (text: string): Uint8Array => {
  const body = Buffer.from(text, 'utf-8')

  return new Uint8Array(Buffer.concat([
    Buffer.from([MLLP_START]),
    body,
    Buffer.from([MLLP_END, MLLP_CR]),
  ]))
}
