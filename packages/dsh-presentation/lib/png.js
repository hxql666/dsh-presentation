// How much ink a rendered page carries, as a fraction of its area.
//
// Typst's PNG output is lossless, non-interlaced, and 8 bits per channel, so the
// image can be decoded here with the standard zlib — no image library, which keeps
// the dependency surface at zero. The measurement exists because overflow has no
// other signal: the layouts compose with grid and stack, so Touying measures a
// content height of 0pt and its overflow detection cannot see a page that is
// visibly overfull. Density is what is left, and it is enough to tell a page that
// is comfortably full from one that has been packed edge to edge.
import fs from 'node:fs'
import zlib from 'node:zlib'

/**
 * Decode a PNG into its pixel buffer.
 *
 * Supports what Typst emits: colour type 6 (RGBA) or 2 (RGB), bit depth 8, no
 * interlacing. Anything else is rejected rather than misread.
 *
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, channels: number, pixels: Buffer }}
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('not a PNG')
  }
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset += length + 12

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      const colourType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
      if (interlace !== 0) throw new Error('interlaced PNG is not supported')
      if (colourType === 6) channels = 4
      else if (colourType === 2) channels = 3
      else throw new Error(`unsupported colour type ${colourType}`)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)

  // Undo the per-scanline filters. Each row is prefixed with its filter type.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const target = pixels.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? target[x - channels] : 0
      const up = prior === null ? 0 : prior[x]
      const upLeft = prior === null || x < channels ? 0 : prior[x - channels]
      const value = source[x]
      let out
      if (filter === 0) out = value
      else if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) {
        // Paeth predictor.
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      } else {
        throw new Error(`unknown filter ${filter} on row ${y}`)
      }
      target[x] = out & 0xff
    }
  }

  return { width, height, channels, pixels }
}

/**
 * The fraction of a page covered by ink, and how its tones are distributed.
 *
 * A pixel counts as ink when it is dark enough to be content rather than
 * background. The threshold sits well below the darkest text and well above the
 * tinted panels the layouts use behind cards and takeaways, so a large tinted area
 * is not mistaken for text while normal antialiasing is.
 *
 * `midtones` answers a different question: whether the page is a picture. The
 * colour count was tried first and **rejected by measurement** — a solid-fill image
 * used 90 distinct colours while a page of Chinese text used 125, because
 * antialiased glyphs are themselves many colours and a flat image is one. What does
 * separate them is tonal spread: a text page is almost entirely background with a
 * small amount of dark glyph, so very little sits in between, while an image
 * occupies the whole range. Measured across the layouts, text pages put 2-5% of
 * their area in the midtones and image pages put 45% or more.
 *
 * @param {string} file  Path to a PNG.
 * @param {object} [options]
 * @param {number} [options.darkBelow]  Luminance under which a pixel counts as ink.
 * @param {number} [options.inset]      Fraction of each edge ignored, so the
 *   theme's header bar, progress bar and page number do not count as density.
 * @returns {{ ink: number, dark: number, midtones: number, colours: number, width: number, height: number }}
 */
export function inkFraction(file, { darkBelow = 200, inset = 0.06 } = {}) {
  const { width, height, channels, pixels } = decodePng(fs.readFileSync(file))

  const x0 = Math.floor(width * inset)
  const x1 = Math.ceil(width * (1 - inset))
  const y0 = Math.floor(height * inset)
  const y1 = Math.ceil(height * (1 - inset))

  let ink = 0
  let dark = 0
  let mid = 0
  let total = 0
  const colours = new Set()
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 220))

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * width + x) * channels
      const r = pixels[at]
      const g = channels >= 3 ? pixels[at + 1] : pixels[at]
      const b = channels >= 3 ? pixels[at + 2] : pixels[at]
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      total += 1
      if (luminance < darkBelow) ink += 1
      if (luminance < 110) dark += 1
      // Midtones: neither background nor glyph. Text contributes almost none; a
      // picture contributes most of its area.
      if (luminance >= 60 && luminance < 225) mid += 1
      if ((x - x0) % step === 0 && (y - y0) % step === 0) {
        colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
      }
    }
  }

  return { ink: ink / total, dark: dark / total, midtones: mid / total, colours: colours.size, width, height }
}
