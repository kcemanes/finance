/**
 * Renders the app mark from public/favicon.svg into the PNG sizes a PWA
 * install needs. Run with `npm run icons`; the output is committed, so this
 * only needs re-running when the mark changes.
 *
 * The mark is four shapes — a plate and three rounded bars — so it is
 * redrawn here directly rather than pulling in a rasteriser. Keeping it
 * dependency-free means no native build step in CI just to make icons.
 * The geometry below mirrors favicon.svg's 32-unit viewBox; change both
 * together.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, no interlace)
// ---------------------------------------------------------------------------

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

function encodePng(size, rgba) {
  // One filter byte (0 = none) in front of every scanline.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// The mark, in favicon.svg's 32-unit space
// ---------------------------------------------------------------------------

const GREEN = [0x1f, 0x4d, 0x3a]
const CARD = [0xdc, 0xeb, 0xe3]
const BAR = [0x6f, 0xaf, 0x8f]

const sq = (n) => n * n

/** Rounded rect hit test with per-corner radii, clockwise from top-left. */
function roundRect(x, y, w, h, [tl, tr, br, bl]) {
  return (px, py) => {
    if (px < x || px > x + w || py < y || py > y + h) return false
    if (px < x + tl && py < y + tl) return sq(px - x - tl) + sq(py - y - tl) <= sq(tl)
    if (px > x + w - tr && py < y + tr) return sq(px - x - w + tr) + sq(py - y - tr) <= sq(tr)
    if (px > x + w - br && py > y + h - br) return sq(px - x - w + br) + sq(py - y - h + br) <= sq(br)
    if (px < x + bl && py > y + h - bl) return sq(px - x - bl) + sq(py - y - h + bl) <= sq(bl)
    return true
  }
}

/** Shrinks a hit test towards the centre of the 32-unit box. */
function scaled(hit, factor) {
  return (px, py) => hit(16 + (px - 16) / factor, 16 + (py - 16) / factor)
}

/**
 * `bleed` squares off the backing plate for masks that apply their own
 * rounding (Android adaptive icons, iOS); `inset` shrinks the mark inside it
 * so nothing important lands in the cropped margin.
 */
function shapes({ bleed, inset }) {
  const plate = bleed
    ? roundRect(-1, -1, 34, 34, [0, 0, 0, 0])
    : roundRect(0, 0, 32, 32, [7, 7, 7, 7])

  const bar = (x, top) => roundRect(x, top, 5.5, 24.25 - top, [1.75, 1.75, 1.75, 1.75])

  const mark = [
    // Three bars climbing to a common baseline, the tallest picked out in
    // the light tone so the rise reads at favicon size.
    [bar(5.5, 17.75), BAR],
    [bar(13.25, 13), BAR],
    [bar(21, 7.75), CARD],
  ]

  return [
    [plate, GREEN],
    ...mark.map(([hit, colour]) => [scaled(hit, inset), colour]),
  ]
}

// ---------------------------------------------------------------------------
// Rasteriser: 4x4 supersampling, painter's order, last shape wins
// ---------------------------------------------------------------------------

const SS = 4

function render(size, options) {
  const layers = shapes(options)
  const rgba = Buffer.alloc(size * size * 4)
  const unit = 32 / size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * unit
          const py = (y + (sy + 0.5) / SS) * unit

          let colour = null
          for (const [hit, value] of layers) if (hit(px, py)) colour = value
          if (!colour) continue

          r += colour[0]
          g += colour[1]
          b += colour[2]
          hits++
        }
      }

      const at = (y * size + x) * 4
      if (!hits) continue
      // Premultiplied average, then unpremultiplied into straight alpha so the
      // rounded edge fades out instead of fringing against black.
      rgba[at] = Math.round(r / hits)
      rgba[at + 1] = Math.round(g / hits)
      rgba[at + 2] = Math.round(b / hits)
      rgba[at + 3] = Math.round((hits / (SS * SS)) * 255)
    }
  }

  return encodePng(size, rgba)
}

const TARGETS = [
  // Rounded plate, drawn to the edge: what a browser shows unmasked.
  ['pwa-192x192.png', 192, { bleed: false, inset: 1 }],
  ['pwa-512x512.png', 512, { bleed: false, inset: 1 }],
  // Maskable: Android crops to a shape of its choosing, guaranteeing only the
  // middle 80%. The mark sits at 60% so it survives the tightest circle.
  ['maskable-512x512.png', 512, { bleed: true, inset: 0.6 }],
  // iOS rounds the corners itself and shows no transparency.
  ['apple-touch-icon.png', 180, { bleed: true, inset: 0.86 }],
]

for (const [name, size, options] of TARGETS) {
  writeFileSync(join(OUT, name), render(size, options))
  console.log(`wrote public/${name} (${size}x${size})`)
}
