// Unit tests for src/mllp.ts: MLLP framing and wrapping.
//
// Framing is where HL7-over-TCP integrations break most often: TCP does not guarantee
// "one `data` event = one message", so every way a frame can be cut is pinned by a test here.
// Only node:test and node:assert/strict are used; there is no test framework.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MLLP_CR, MLLP_END, MLLP_START, extractMllpFrames, wrapMllp } from '../src/mllp.ts'

/** A complete MLLP frame built byte by byte, independently of `wrapMllp`. */
const framed = (text: string): Buffer => Buffer.concat([
  Buffer.from([MLLP_START]),
  Buffer.from(text, 'utf-8'),
  Buffer.from([MLLP_END, MLLP_CR]),
])

/** A complete MLLP frame built with `wrapMllp`. */
const wrapped = (text: string): Buffer => Buffer.from(wrapMllp(text))

describe('MLLP constants', () => {
  it('are <SB> 0x0B, <EB> 0x1C and <CR> 0x0D', () => {
    assert.equal(MLLP_START, 0x0b)
    assert.equal(MLLP_END, 0x1c)
    assert.equal(MLLP_CR, 0x0d)
  })
})

describe('extractMllpFrames', () => {
  it('returns the single frame of a chunk', () => {
    const { frames, rest, discarded } = extractMllpFrames(framed('MSH|^~\\&|APP'))

    assert.deepEqual(frames, ['MSH|^~\\&|APP'])
    assert.equal(rest.length, 0)
    assert.equal(discarded, 0)
  })

  it('returns the single frame of a chunk (frame built with wrapMllp)', () => {
    const result = extractMllpFrames(wrapped('MSH|^~\\&|A'))

    assert.deepEqual(result.frames, ['MSH|^~\\&|A'])
    assert.equal(result.rest.length, 0)
    assert.equal(result.discarded, 0)
  })

  it('keeps the first half of a split frame in rest and emits it once the second half arrives', () => {
    const whole = framed('MSH|A\rOBX|1')
    const first = extractMllpFrames(whole.subarray(0, 8))

    assert.deepEqual(first.frames, [])
    assert.equal(first.discarded, 0)
    // The rest invariant: an unfinished frame starts with <SB>.
    assert.equal(first.rest[0], MLLP_START)

    const second = extractMllpFrames(Buffer.concat([first.rest, whole.subarray(8)]))

    assert.deepEqual(second.frames, ['MSH|A\rOBX|1'])
    assert.equal(second.rest.length, 0)
  })

  it('keeps every byte of an unfinished frame, <SB> included, until the next chunk completes it', () => {
    const whole = wrapped('MSH|^~\\&|A\rOBX|1|NM|X^Y')
    const first = whole.subarray(0, 12)
    const second = whole.subarray(12)

    const round1 = extractMllpFrames(first)

    assert.deepEqual(round1.frames, [])
    assert.equal(round1.rest.length, first.length)
    assert.equal(round1.discarded, 0)

    const round2 = extractMllpFrames(Buffer.concat([round1.rest, second]))

    assert.deepEqual(round2.frames, ['MSH|^~\\&|A\rOBX|1|NM|X^Y'])
    assert.equal(round2.rest.length, 0)
  })

  it('returns two frames that arrive in one chunk', () => {
    const { frames, rest } = extractMllpFrames(Buffer.concat([framed('first'), framed('second')]))

    assert.deepEqual(frames, ['first', 'second'])
    assert.equal(rest.length, 0)
  })

  it('returns two frames that arrive in one chunk without discarding anything', () => {
    const result = extractMllpFrames(Buffer.concat([wrapped('FIRST'), wrapped('SECOND')]))

    assert.deepEqual(result.frames, ['FIRST', 'SECOND'])
    assert.equal(result.rest.length, 0)
    assert.equal(result.discarded, 0)
  })

  it('returns the complete frame and keeps the incomplete one that follows it', () => {
    const partial = framed('second').subarray(0, 4)
    const { frames, rest } = extractMllpFrames(Buffer.concat([framed('first'), partial]))

    assert.deepEqual(frames, ['first'])
    assert.equal(rest[0], MLLP_START)
    assert.equal(rest.length, 4)
  })

  it('keeps an incomplete frame in rest byte for byte while still emitting the complete frame before it', () => {
    const result = extractMllpFrames(Buffer.concat([wrapped('DONE'), Buffer.from([MLLP_START]), Buffer.from('PART', 'utf-8')]))

    assert.deepEqual(result.frames, ['DONE'])
    assert.equal(result.rest.toString('utf-8'), '\u000bPART')
  })

  it('discards and counts noise bytes before <SB>', () => {
    const noise = Buffer.from('0d0a3f2100ff', 'hex')
    const { frames, rest, discarded } = extractMllpFrames(Buffer.concat([noise, framed('MSH|A')]))

    assert.deepEqual(frames, ['MSH|A'])
    assert.equal(discarded, noise.length)
    assert.equal(rest.length, 0)
  })

  it('discards and counts a short run of noise before <SB>', () => {
    const noise = Buffer.from([0x0d, 0x0a, 0x3f, 0x21])
    const result = extractMllpFrames(Buffer.concat([noise, wrapped('MSH|^~\\&|A')]))

    assert.deepEqual(result.frames, ['MSH|^~\\&|A'])
    assert.equal(result.discarded, 4)
    assert.equal(result.rest.length, 0)
  })

  it('discards a whole chunk that has no <SB> and leaves rest empty', () => {
    const { frames, rest, discarded } = extractMllpFrames(Buffer.from('hello', 'utf-8'))

    assert.deepEqual(frames, [])
    assert.equal(rest.length, 0)
    assert.equal(discarded, 5)
  })

  it('treats a binary chunk with no <SB> as noise and keeps nothing for the next pass', () => {
    const result = extractMllpFrames(Buffer.from([0xff, 0x00, 0x41]))

    assert.deepEqual(result.frames, [])
    assert.equal(result.discarded, 3)
    assert.equal(result.rest.length, 0)
  })

  it('accepts a frame without <CR> after <EB>; a <CR> that arrives late is dropped as noise', () => {
    const withoutCr = Buffer.concat([
      Buffer.from([MLLP_START]),
      Buffer.from('MSH|A', 'utf-8'),
      Buffer.from([MLLP_END]),
    ])
    const first = extractMllpFrames(withoutCr)

    assert.deepEqual(first.frames, ['MSH|A'])
    assert.equal(first.rest.length, 0)

    const late = extractMllpFrames(Buffer.concat([Buffer.from([MLLP_CR]), framed('next')]))

    assert.deepEqual(late.frames, ['next'])
    assert.equal(late.discarded, 1)
  })

  it('keeps splitting after a frame whose <EB> is not followed by <CR>', () => {
    const withoutCr = Buffer.concat([Buffer.from([MLLP_START]), Buffer.from('MSH|A', 'utf-8'), Buffer.from([MLLP_END])])
    const result = extractMllpFrames(Buffer.concat([withoutCr, wrapped('SECOND')]))

    assert.deepEqual(result.frames, ['MSH|A', 'SECOND'])
    assert.equal(result.discarded, 0)
  })

  it('counts a <CR> that lands at the start of the next chunk as exactly one byte of noise', () => {
    const whole = wrapped('MSH|A')
    const round1 = extractMllpFrames(whole.subarray(0, whole.length - 1))

    assert.deepEqual(round1.frames, ['MSH|A'])
    assert.equal(round1.rest.length, 0)

    const round2 = extractMllpFrames(Buffer.from([MLLP_CR]))

    assert.deepEqual(round2.frames, [])
    assert.equal(round2.discarded, 1)
  })

  it('accepts an empty buffer', () => {
    const { frames, rest, discarded } = extractMllpFrames(Buffer.alloc(0))

    assert.deepEqual(frames, [])
    assert.equal(rest.length, 0)
    assert.equal(discarded, 0)
  })

  it('does not break UTF-8 multi-byte characters', () => {
    const { frames } = extractMllpFrames(framed('OBX|1|ST|0|Temperature|38.5|°C|↑'))

    assert.deepEqual(frames, ['OBX|1|ST|0|Temperature|38.5|°C|↑'])
  })

  it('returns rest as an independent copy: mutating the input afterwards does not change it', () => {
    const input = Buffer.concat([framed('DONE'), Buffer.from([MLLP_START]), Buffer.from('PART', 'utf-8')])
    const { frames, rest } = extractMllpFrames(input)

    assert.deepEqual(frames, ['DONE'])
    assert.equal(rest.toString('utf-8'), '\u000bPART')

    input.fill(0x00)

    assert.equal(rest.toString('utf-8'), '\u000bPART')
  })
})

describe('wrapMllp', () => {
  it('adds <SB> in front and <EB><CR> at the end', () => {
    const bytes = wrapMllp('MSH|A')

    assert.equal(bytes[0], MLLP_START)
    assert.equal(bytes[bytes.length - 2], MLLP_END)
    assert.equal(bytes[bytes.length - 1], MLLP_CR)
    assert.equal(Buffer.from(bytes).toString('hex').startsWith('0b'), true)
    assert.equal(Buffer.from(bytes).toString('hex').endsWith('1c0d'), true)
  })

  it('puts the UTF-8 text unchanged between <SB> and <EB><CR>', () => {
    const bytes = wrapMllp('MSA|AA|X')

    assert.equal(bytes[0], MLLP_START)
    assert.equal(bytes[bytes.length - 2], MLLP_END)
    assert.equal(bytes[bytes.length - 1], MLLP_CR)
    assert.equal(Buffer.from(bytes.subarray(1, bytes.length - 2)).toString('utf-8'), 'MSA|AA|X')
  })

  it('round-trips through extractMllpFrames', () => {
    const text = 'MSH|^~\\&|APP\rMSA|AA|15|Message accepted.'
    const { frames } = extractMllpFrames(Buffer.from(wrapMllp(text)))

    assert.deepEqual(frames, [text])
  })
})
