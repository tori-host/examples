import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BG, DEFAULT_FG, MAX_SIDE, parseColor, parseSide, placeholderFor, placeholderSvg } from './placeholder.js'

/** Everything in an SVG that is not markup: what a viewer would read. */
const textOf = (svg) => svg.replace(/<[^>]*>/g, '').trim()

test('a side is a whole number from 1 to 4000, written one way only', () => {
  assert.equal(parseSide('1'), 1)
  assert.equal(parseSide('4000'), MAX_SIDE)
  for (const text of ['0', '4001', '0100', '-5', '1.5', '1e3', '', ' 10', '99999999999999999999999']) {
    assert.equal(parseSide(text), null, JSON.stringify(text))
  }
})

test('a colour is exactly 3 or 6 hex digits, and nothing that only starts like one', () => {
  assert.equal(parseColor('fff'), 'fff')
  assert.equal(parseColor('A1B2C3'), 'a1b2c3')
  for (const value of ['', 'ff', 'ffff', 'fffffff', '#fff', 'ggg', 'red', 'fff"', 'fff ', 'fff\n', 'fff/><script>', ['fff'], { a: 'fff' }, undefined]) {
    assert.equal(parseColor(value), null, JSON.stringify(value))
  }
})

test('an image has the size and colours it was asked for, and says its size', () => {
  const svg = placeholderSvg({ width: 320, height: 180, bg: '162028', fg: 'fff' })
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="320" height="180" viewBox="0 0 320 180"/)
  assert.ok(svg.includes('fill="#162028"'))
  assert.ok(svg.includes('fill="#fff"'))
  assert.equal(textOf(svg), '320 × 180')
})

test('the defaults are used when no colour is given', () => {
  const { svg } = placeholderFor('/10x10.svg', {})
  assert.ok(svg.includes(`fill="#${DEFAULT_BG}"`) && svg.includes(`fill="#${DEFAULT_FG}"`))
})

test('the label fits even at the extremes', () => {
  for (const [width, height] of [[1, 1], [1, 4000], [4000, 1], [4000, 4000]]) {
    const size = Number(/font-size="(\d+)"/.exec(placeholderSvg({ width, height }))[1])
    assert.ok(size >= 1 && size <= Math.max(1, height / 2) && size * 6.5 <= Math.max(6.5, width), `${width}x${height}: ${size}`)
  }
})

test('out of range sizes, bad colours and other parameters are refused, not drawn', () => {
  for (const [path, query] of [
    ['/0x100.svg', {}],
    ['/100x4001.svg', {}],
    ['/010x10.svg', {}],
    ['/10x10.svg', { bg: 'red' }],
    ['/10x10.svg', { fg: '12345' }],
    ['/10x10.svg', { bg: ['fff', '000'] }],
    ['/10x10.svg', { text: 'hello' }],
    ['/10x10.svg', { bg: 'fff', label: 'hello' }],
  ]) {
    const answer = placeholderFor(path, query)
    assert.ok(answer?.error, `${path} ${JSON.stringify(query)}`)
    assert.equal(answer.svg, undefined)
  }
  assert.equal(placeholderFor('/favicon.svg', {}), null)
  assert.equal(placeholderFor('/10x10.svg/x', {}), null)
})

// The rule this service exists to keep. Whatever is in the address, the only
// text in an image is its size, and the only attribute values that vary are
// the numbers and colours parsed above.
test('nothing from the address but the size and the colours ends up in an image', () => {
  const svg = placeholderFor('/200x100.svg', { bg: 'ABC', fg: '123456' }).svg
  assert.equal(textOf(svg), '200 × 100')
  const values = [...svg.matchAll(/="([^"]*)"/g)].map(([, value]) => value)
  const allowed = new Set([
    'http://www.w3.org/2000/svg', '200', '100', '0 0 200 100', 'img', '200 × 100', '#abc', '#123456',
    '50%', 'ui-sans-serif, system-ui, sans-serif', '30', '700', 'middle', 'central',
  ])
  for (const value of values) assert.ok(allowed.has(value), `unexpected attribute value ${value}`)
})
