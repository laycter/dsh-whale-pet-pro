// 生成 pet-badge.ts（从 fat-fish-maid spritesheet 切 idle 帧 → webp base64）
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

const sheet = 'D:/DeepseekHarness/workspace/whale-pet-pro/assets/pets/fat-fish-maid/spritesheet.webp'
const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true })
const w = 192
const h = 208
const out = Buffer.alloc(w * h * 4)
for (let row = 0; row < h; row++) {
  data.copy(out, row * w * 4, row * info.width * 4, row * info.width * 4 + w * 4)
}
const small = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
  .resize(96, 104)
  .webp({ quality: 90 })
  .toBuffer()
const dataUrl = 'data:image/webp;base64,' + small.toString('base64')
const ts = [
  '// 自动生成：大肥鱼女仆 idle 帧（fat-fish-maid spritesheet row 0），96x104 webp base64。',
  '// 重新生成：node scripts/gen-pet-badge.mjs',
  'export const PET_BADGE_DATA_URL = ' + JSON.stringify(dataUrl),
  '',
].join('\n')
writeFileSync('D:/DeepseekHarness/workspace/whale-pet-pro/src/client/pet-badge.ts', ts)
console.log('pet-badge.ts 生成:', ts.length, 'bytes,', small.length, 'bytes webp')
