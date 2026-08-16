/**
 * whale-pet-pro 扩展：目录格式（dir）素材加载器。
 *
 * 布局：`<petDir>/<action>/1.png 2.png 3.png …` —— 每个动作一个子目录，
 * 帧数不限（不像 Codex 契约锁死 8 帧/行）。文件名按数字排序播放；
 * 帧率来自 pet.json 的 `actions.<action>.fps` > 全局 `fps` > 缺省 24。
 *
 * M3 变体支持（DeskPet/PET.md 风格）：`<action>_<数字>/`（如 `idle_0/`、
 * `idle_1/`）自动合并为同一动作的多个变体；`<action>_<单词>/`（如
 * `sit_eat/`）仍是独立动作（数字后缀 = 变体，单词后缀 = 动作名一部分）。
 *
 * `sharp` 懒加载，与 codex PetLoader 同策略（无图不解码）。
 */

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PetManifest } from '../codex-pet/PetContract'

/** One decoded animation frame (straight RGBA). */
export interface FrameBuffer {
  width: number
  height: number
  /** RGBA bytes, `width * height * 4` in length. */
  rgba: Uint8Array
}

/** One variant of an action: its ordered frames. */
export interface DirFrameVariant {
  frames: FrameBuffer[]
}

/** A complete animation for one action: variants + playback fps + loop count. */
export interface DirFrameTable {
  action: string
  /** At least one variant; a single-variant action is `variants[0]`. */
  variants: DirFrameVariant[]
  fps: number
  /** -1 = loop forever (default); >=1 = play N times then hold last frame. */
  loops: number
}

/**
 * Decodes a batch of frame files into raw RGBA frames (one call per variant).
 * Injected for tests.
 */
export type FrameDecoder = (paths: string[]) => Promise<FrameBuffer[]>

/**
 * Default decoder backed by `sharp`: decodes every frame of one variant
 * concurrently through libvips' thread pool (PNG 解码本身是 CPU 并行友好的）。
 * 实测 1007 帧全量 ≈1.5s；sharp 的 composite/join 大批量拼接在 0.35 有
 * 位置错乱 bug，故不用拼接方案。
 */
export const sharpFrameDecoder: FrameDecoder = async (paths) => {
  const { default: sharp } = await import('sharp')
  const frames = await Promise.all(paths.map(async (input) => {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    }
  }))
  return frames
}

/** Default fps for dir-format animations when nothing is configured. */
export const DEFAULT_DIR_FPS = 24

/** True if `name` looks like a frame file (`1.png`, `12.png`, …). */
function frameSortKey(name: string): number | null {
  const match = /^(\d+)\.png$/i.exec(name)
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * Split a directory name into `{ action, variantIndex }`.
 * - `idle` → { action: 'idle', variantIndex: 0 }
 * - `idle_2` → { action: 'idle', variantIndex: 2 }
 * - `sit_eat` → { action: 'sit_eat', variantIndex: 0 }（单词后缀 = 动作名一部分）
 */
export function splitActionDirName(name: string): { action: string; variantIndex: number } {
  const match = /^(.*)_(\d+)$/.exec(name)
  if (match) return { action: match[1], variantIndex: Number.parseInt(match[2], 10) }
  return { action: name, variantIndex: 0 }
}

/**
 * Load every action directory under `directory` into frame tables.
 *
 * Subdirectories become actions (name = action id); a `<action>_<number>`
 * suffix marks a variant of the same action. Their PNG frames are sorted by
 * numeric filename. Directories without any valid frame are skipped, so one
 * empty/broken action never fails the whole pet.
 *
 * @param directory - the pet directory (contains `pet.json` + action dirs).
 * @param manifest - parsed manifest, used for fps/loops overrides.
 * @param decoder - injected for tests; defaults to sharp.
 */
export async function loadPetDir(
  directory: string,
  manifest: PetManifest,
  decoder: FrameDecoder = sharpFrameDecoder,
): Promise<Map<string, DirFrameTable>> {
  const root = resolve(directory)
  const tables = new Map<string, DirFrameTable>()

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return tables
  }

  for (const name of names) {
    if (name.startsWith('.') || name === 'pet.json' || name === 'ACTIONS.md' || name === 'sound') continue
    const actionDir = join(root, name)
    let dirStat
    try {
      dirStat = await stat(actionDir)
    } catch {
      continue
    }
    if (!dirStat.isDirectory()) continue

    const files = await readdir(actionDir)
    const entries = files
      .map(file => ({ file, key: frameSortKey(file) }))
      .filter((e): e is { file: string; key: number } => e.key !== null)
      .sort((a, b) => a.key - b.key)
    if (entries.length === 0) continue

    // One batched decode per variant; a decode failure skips the variant,
    // never the whole pet.
    let frames: FrameBuffer[]
    try {
      frames = await decoder(entries.map(e => join(actionDir, e.file)))
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn(`[whale-pet-pro] skip action ${name} (decode failed):`, (error as Error)?.message)
      }
      continue
    }
    if (frames.length === 0) continue

    // 拆分动作名 / 变体序号，合并同名动作的多个变体。
    const { action, variantIndex } = splitActionDirName(name)
    const actionConf = manifest.actions?.[action]
    const fps = actionConf?.fps ?? manifest.fps ?? DEFAULT_DIR_FPS
    const loops = actionConf?.loops ?? -1

    const table = tables.get(action)
    const variant: DirFrameVariant = { frames }
    if (table) {
      // 按变体序号插到对应位置（变体目录可能是乱序读取）。
      table.variants[variantIndex] = variant
      // 稀疏位置补空后过滤，保证 variants 连续。
      table.variants = table.variants.filter(Boolean)
    } else {
      const variants: DirFrameVariant[] = []
      variants[variantIndex] = variant
      tables.set(action, { action, variants: variants.filter(Boolean), fps, loops })
    }
  }

  return tables
}
