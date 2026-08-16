// 分析 fat-fish-maid spritesheet 的每一行（Codex V1: 8列×192, 行高208）：
// 相邻帧差异（动作幅度）+ 首帧 bbox——找「安静」的行和「欢呼」的行
import sharp from 'sharp'

const SHEET = 'D:/DeepseekHarness/workspace/whale-pet-pro/assets/pets/fat-fish-maid/spritesheet.webp'
const CELL_W = 192, CELL_H = 208, COLS = 8

// Codex V1 行的帧数（ANIMATION_ROWS 契约）
const ROWS = [
  { name: 'idle', frames: 6 },
  { name: 'running-right', frames: 8 },
  { name: 'running-left', frames: 8 },
  { name: 'waving', frames: 4 },
  { name: 'jumping', frames: 5 },
  { name: 'failed', frames: 8 },
  { name: 'waiting', frames: 6 },
  { name: 'running', frames: 6 },
  { name: 'review', frames: 6 },
]

const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
console.log(`sheet: ${info.width}x${info.height}`)

function frameBytes(row, col) {
  const out = Buffer.alloc(CELL_W * CELL_H * 4)
  for (let y = 0; y < CELL_H; y++) {
    const srcStart = ((row * CELL_H + y) * info.width + col * CELL_W) * 4
    data.copy(out, y * CELL_W * 4, srcStart, srcStart + CELL_W * 4)
  }
  return out
}

function diffRatio(a, b) {
  let diff = 0, total = 0
  for (let i = 0; i < a.length; i += 4) {
    const alpha = a[i + 3]
    if (alpha > 8 || b[i + 3] > 8) {
      total++
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || alpha !== b[i + 3]) diff++
    }
  }
  return total === 0 ? 0 : diff / total
}

function bboxOf(buf) {
  let minX = CELL_W, minY = CELL_H, maxX = -1, maxY = -1, count = 0
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      if (buf[(y * CELL_W + x) * 4 + 3] > 8) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return count === 0 ? null : `${maxX - minX + 1}x${maxY - minY + 1}`
}

for (const [rowIdx, row] of ROWS.entries()) {
  const frames = []
  for (let c = 0; c < row.frames; c++) frames.push(frameBytes(rowIdx, c))
  const diffs = []
  for (let i = 1; i < frames.length; i++) diffs.push(diffRatio(frames[i - 1], frames[i]))
  const loopDiff = diffRatio(frames[frames.length - 1], frames[0])
  const avgDiff = (diffs.reduce((s, d) => s + d, 0) / diffs.length)
  console.log(
    `${row.name.padEnd(14)} 帧间差异: ${diffs.map(d => (d * 100).toFixed(0)).join(' ')}% | 均 ${(avgDiff * 100).toFixed(0)}% | 循环 ${(loopDiff * 100).toFixed(0)}% | 首帧 ${bboxOf(frames[0])}`,
  )
}
