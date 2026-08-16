// 以 idle 为基准统一 whale-ui-pet 素材：
// 1) 角色 bbox 高度统一到 idle（scale = 164/bb.h，宽度按比例）
// 2) 位置用「动作平均中心」对齐（两阶段：先收集全部帧 bbox → 平均中心 →
//    统一贴回）——帧间位置稳定，消除逐帧归一带来的抖动
// 3) 发色：蓝色系像素（hue 200-250 色相范围 mask，覆盖深蓝到浅蓝）的
//    HSV S/V 按比例映射到 idle 平均值（保留渐变结构）
//    注意：基准 0.46/0.54 是 HSV 空间的 S/V（analyze 脚本口径），不是 HSL！
// 输出到 whale-ui-pet-v2/，原素材不动。
import sharp from 'sharp'
import { readdir, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SRC = 'D:/DeepseekHarness/workspace/whale-pet-pro/assets/pets/whale-ui-pet'
const DST = 'D:/DeepseekHarness/workspace/whale-pet-pro/assets/pets/whale-ui-pet-v2'
const CELL = 220

// ---- 基准（来自 analyze-pet-assets.mjs 的 idle 数据）----
const IDLE_BBOX = { w: 103, h: 164, cx: 110, cy: 104 }
const IDLE_BLUE = { sat: 0.46, light: 0.54 } // HSV S/V 口径

function bboxOf(rgba, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

// RGB → HSV（h 0-360, s/v 0-1）
function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  const v = max
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, v }
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0, g1 = 0, b1 = 0
  if (hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m = v - c
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

// 发色 mask：hue 200-250（蓝到靛蓝），覆盖深蓝/浅蓝/低饱和蓝
function isHairBlueHsv(hsv, a) {
  return a > 30 && hsv.h >= 200 && hsv.h <= 250 && hsv.s > 0.15 && hsv.v > 0.18
}

// 读一帧 → { rgba, w, h, bb }
async function readFrame(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return { rgba, w: info.width, h: info.height, bb: bboxOf(rgba, info.width, info.height) }
}

// 处理一帧：用动作级 cx/cy 对齐；返回统一后的 RGBA（220×220）
async function normalizeFrame(path, cx, cy) {
  const { rgba, w, h, bb } = await readFrame(path)
  if (!bb) return null

  // 1) 角色缩放：高度统一到 idle（宽度按比例），保持姿态比例
  const scale = IDLE_BBOX.h / bb.h
  const newW = Math.max(1, Math.round(bb.w * scale))
  const newH = IDLE_BBOX.h
  const region = Buffer.alloc(bb.w * bb.h * 4)
  for (let y = 0; y < bb.h; y++) {
    const srcStart = ((bb.minY + y) * w + bb.minX) * 4
    region.set(rgba.subarray(srcStart, srcStart + bb.w * 4), y * bb.w * 4)
  }
  const scaled = await sharp(region, { raw: { width: bb.w, height: bb.h, channels: 4 } })
    .resize(newW, newH, { kernel: 'lanczos3' })
    .raw()
    .toBuffer()

  // 2) 贴回：中心对齐到动作平均中心（帧间稳定，消除抖动）
  const canvas = Buffer.alloc(CELL * CELL * 4)
  const dx = Math.round(cx - newW / 2)
  const dy = Math.round(cy - newH / 2)
  for (let y = 0; y < newH; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= CELL) continue
    for (let x = 0; x < newW; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= CELL) continue
      const s = (y * newW + x) * 4
      const d = (ty * CELL + tx) * 4
      canvas[d] = scaled[s]
      canvas[d + 1] = scaled[s + 1]
      canvas[d + 2] = scaled[s + 2]
      canvas[d + 3] = scaled[s + 3]
    }
  }

  // 3) 发色对齐（HSV S/V 比例映射到 idle 均值，保留渐变）
  let n = 0, sSum = 0, vSum = 0
  const hsvCache = new Map()
  for (let i = 0; i < CELL * CELL; i++) {
    const r = canvas[i * 4], g = canvas[i * 4 + 1], b = canvas[i * 4 + 2], a = canvas[i * 4 + 3]
    if (a <= 30) continue
    const hsv = rgbToHsv(r, g, b)
    if (!isHairBlueHsv(hsv, a)) continue
    hsvCache.set(i, hsv)
    sSum += hsv.s; vSum += hsv.v
    n++
  }
  if (n > 0) {
    const avgS = sSum / n
    const avgV = vSum / n
    const sK = avgS > 0.01 ? IDLE_BLUE.sat / avgS : 1
    const vK = avgV > 0.01 ? IDLE_BLUE.light / avgV : 1
    for (const [i, hsv] of hsvCache) {
      const s = Math.min(1, Math.max(0, hsv.s * sK))
      const v = Math.min(1, Math.max(0, hsv.v * vK))
      const [r, g, b] = hsvToRgb(hsv.h, s, v)
      canvas[i * 4] = r
      canvas[i * 4 + 1] = g
      canvas[i * 4 + 2] = b
    }
  }

  return canvas
}

// 主流程（两阶段：先收集 bbox 算动作平均中心 → 再统一处理）
await mkdir(DST, { recursive: true })
await copyFile(join(SRC, 'pet.json'), join(DST, 'pet.json'))
const dirs = (await readdir(SRC, { withFileTypes: true })).filter(d => d.isDirectory())
let totalFrames = 0
for (const dir of dirs) {
  const files = (await readdir(join(SRC, dir.name))).filter(f => /^\d+\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b))
  if (files.length === 0) continue
  await mkdir(join(DST, dir.name), { recursive: true })

  // 阶段 1：收集全部帧的 bbox → 动作平均中心
  const frames = []
  for (const file of files) {
    const { bb } = await readFrame(join(SRC, dir.name, file))
    if (bb) frames.push({ file, bb })
  }
  if (frames.length === 0) continue
  const avgCx = frames.reduce((s, f) => s + (f.bb.minX + f.bb.w / 2), 0) / frames.length
  const avgCy = frames.reduce((s, f) => s + (f.bb.minY + f.bb.h / 2), 0) / frames.length

  // 阶段 2：并发处理（同一动作共用 avgCx/avgCy，帧间位置稳定）
  const jobs = frames.map(async ({ file }, idx) => {
    const canvas = await normalizeFrame(join(SRC, dir.name, file), avgCx, avgCy)
    if (!canvas) return
    const png = await sharp(canvas, { raw: { width: CELL, height: CELL, channels: 4 } }).png().toBuffer()
    await writeFile(join(DST, dir.name, String(idx + 1) + '.png'), png)
  })
  await Promise.all(jobs)
  totalFrames += files.length
  console.log(`✓ ${dir.name} (${files.length} 帧, 中心 ${Math.round(avgCx)},${Math.round(avgCy)})`)
}
console.log(`\n完成：${totalFrames} 帧 → whale-ui-pet-v2/`)
