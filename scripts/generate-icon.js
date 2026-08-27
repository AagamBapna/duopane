// Generates build/icon-1024.png — a dependency-free app icon: two rounded
// "panes" on an indigo→violet squircle, matching the split-view concept.
// build-icon.sh turns it into build/icon.icns. Re-run when the mark changes.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 1024

// ---- tiny PNG encoder (RGBA, no deps) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- drawing ----
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r)
  const qy = Math.abs(py - cy) - (halfH - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}

const lerp = (a, b, t) => a + (b - a) * t

function over(dst, i, r, g, b, a) {
  const da = dst[i + 3] / 255
  const outA = a + da * (1 - a)
  if (outA <= 0) return
  dst[i] = Math.round((r * a + dst[i] * da * (1 - a)) / outA)
  dst[i + 1] = Math.round((g * a + dst[i + 1] * da * (1 - a)) / outA)
  dst[i + 2] = Math.round((b * a + dst[i + 2] * da * (1 - a)) / outA)
  dst[i + 3] = Math.round(outA * 255)
}

const rgba = Buffer.alloc(SIZE * SIZE * 4) // transparent

// squircle background + two panes
const paneY0 = 260
const paneY1 = 820
const paneCy = (paneY0 + paneY1) / 2
const paneHalfH = (paneY1 - paneY0) / 2
const panes = [
  { cx: (160 + 492) / 2, halfW: (492 - 160) / 2 },
  { cx: (532 + 864) / 2, halfW: (864 - 532) / 2 },
]

for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE
  const bgR = Math.round(lerp(91, 139, t))
  const bgG = Math.round(lerp(91, 61, t))
  const bgB = Math.round(lerp(240, 229, t))
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const dBg = sdRoundRect(x, y, SIZE / 2, SIZE / 2, (SIZE - 128) / 2, (SIZE - 128) / 2, 200)
    const covBg = Math.min(1, Math.max(0, 0.5 - dBg))
    if (covBg > 0) over(rgba, i, bgR, bgG, bgB, covBg)
    for (const pane of panes) {
      const dP = sdRoundRect(x, y, pane.cx, paneCy, pane.halfW, paneHalfH, 44)
      const covP = Math.min(1, Math.max(0, 0.5 - dP))
      if (covP > 0) over(rgba, i, 255, 255, 255, covP * 0.96)
    }
  }
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'icon-1024.png')
fs.writeFileSync(outFile, encodePng(rgba, SIZE))
console.log('wrote', outFile)
