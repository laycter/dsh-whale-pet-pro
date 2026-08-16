// 分析 whale-ui-pet 素材：各动作的角色边界框（大小）+ 蓝色系像素色相（发色）
import sharp from 'sharp'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = 'D:/DeepseekHarness/workspace/whale-pet-pro/assets/pets/whale-ui-pet'

function bboxOf(rgba, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3]
      if (a > 8) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (count === 0) return null
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, count }
}

// 蓝色系像素（头发）：B 显著大于 R，且饱和度较高
function blueStats(rgba, w, h) {
  let n = 0, hueSum = 0, satSum = 0, lightSum = 0
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3]
    if (a < 100) continue
    if (b > r + 25 && b > g + 10 && b > 90) {
      // hue
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const d = max - min
      let hue = 0
      if (d > 0) {
        if (max === r) hue = ((g - b) / d) % 6
        else if (max === g) hue = (b - r) / d + 2
        else hue = (r - g) / d + 4
        hue *= 60
        if (hue < 0) hue += 360
      }
      const sat = d === 0 ? 0 : d / max
      const light = max / 255
      hueSum += hue; satSum += sat; lightSum += light
      n++
    }
  }
  if (n === 0) return null
  return { n, hue: hueSum / n, sat: satSum / n, light: lightSum / n }
}

const dirs = (await readdir(ROOT, { withFileTypes: true })).filter(d => d.isDirectory())
const results = []
for (const dir of dirs) {
  const files = (await readdir(join(ROOT, dir.name))).filter(f => /^\d+\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b))
  if (files.length === 0) continue
  const frame = await sharp(join(ROOT, dir.name, files[0])).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
  const bb = bboxOf(rgba, frame.info.width, frame.info.height)
  const bs = blueStats(rgba, frame.info.width, frame.info.height)
  results.push({
    action: dir.name,
    frames: files.length,
    bbox: bb ? `${bb.w}x${bb.h} @ (${Math.round(bb.cx)},${Math.round(bb.cy)})` : 'empty',
    blue: bs ? `n=${bs.n} hue=${Math.round(bs.hue)} sat=${bs.sat.toFixed(2)} light=${bs.light.toFixed(2)}` : 'none',
  })
}
// idle 基准
const idle = results.find(r => r.action === 'idle')
console.log('== idle 基准 ==')
console.log(`bbox: ${idle.bbox} | blue: ${idle.blue}`)
console.log('== 各动作 ==')
for (const r of results) {
  const mark = r.action === 'idle' ? ' *' : ''
  console.log(`${r.action.padEnd(12)} bbox=${r.bbox.padEnd(22)} blue=${r.blue}${mark}`)
}
