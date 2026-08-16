/**
 * Pure frame slicing and scaling.
 *
 * Converts a decoded Codex atlas into individual frames at the requested
 * display scale. Everything here is deterministic and unit-testable; the
 * window backends only receive a finished {@link PetFrame} to present.
 */

import { CELL_HEIGHT, CELL_WIDTH, frameRect } from './codex-pet/PetContract'
import type { CodexPetState } from '../core/types'

export interface AtlasBuffer {
  width: number
  height: number
  /** RGBA bytes, `width * height * 4` in length. */
  rgba: Uint8Array
}

export interface PetFrame {
  width: number
  height: number
  /** RGBA bytes, `width * height * 4` in length. */
  rgba: Uint8Array
}

/**
 * Extract one cell (a single animation frame) from an atlas.
 */
export function sliceFrame(atlas: AtlasBuffer, state: CodexPetState, index: number): PetFrame {
  const rect = frameRect(state, index)
  if (rect.x + rect.width > atlas.width || rect.y + rect.height > atlas.height) {
    throw new Error(`Frame ${state}:${index} is outside atlas bounds`)
  }
  const out = new Uint8Array(rect.width * rect.height * 4)
  for (let row = 0; row < rect.height; row++) {
    const srcStart = ((rect.y + row) * atlas.width + rect.x) * 4
    const dstStart = row * rect.width * 4
    out.set(atlas.rgba.subarray(srcStart, srcStart + rect.width * 4), dstStart)
  }
  return { width: rect.width, height: rect.height, rgba: out }
}

/**
 * Nearest-neighbor scale an RGBA frame to a new integer size.
 * Keeps the backend dumb: it receives pixels already at display size.
 */
export function scaleFrame(frame: PetFrame, scale: number): PetFrame {
  if (scale <= 0) throw new Error(`Invalid scale: ${scale}`)
  if (scale === 1) return frame
  const width = Math.max(1, Math.round(frame.width * scale))
  const height = Math.max(1, Math.round(frame.height * scale))
  return fitFrame(frame, width, height)
}

/**
 * whale-pet-pro 扩展：nearest-neighbor 等比缩放（contain）到目标尺寸并居中。
 * dir 格式下不同动作的帧尺寸可能不一致；渲染窗口按基准帧建好，其它动作的
 * 帧在此**等比缩放 + 居中**（透明边填充），避免拉伸变形/裁切。
 * scaleFrame 的等比目标与 contain 结果一致，故共用此函数。
 */
export function fitFrame(frame: PetFrame, width: number, height: number): PetFrame {
  const outWidth = Math.max(1, Math.round(width))
  const outHeight = Math.max(1, Math.round(height))
  if (outWidth === frame.width && outHeight === frame.height) return frame

  // contain：等比缩放，居中到目标画布（透明填充）。
  const scale = Math.min(outWidth / frame.width, outHeight / frame.height)
  const drawW = Math.max(1, Math.round(frame.width * scale))
  const drawH = Math.max(1, Math.round(frame.height * scale))
  const offsetX = Math.floor((outWidth - drawW) / 2)
  const offsetY = Math.floor((outHeight - drawH) / 2)

  const out = new Uint8Array(outWidth * outHeight * 4)
  for (let y = 0; y < drawH; y++) {
    const srcY = Math.min(frame.height - 1, Math.floor((y * frame.height) / drawH))
    for (let x = 0; x < drawW; x++) {
      const srcX = Math.min(frame.width - 1, Math.floor((x * frame.width) / drawW))
      const src = (srcY * frame.width + srcX) * 4
      const dst = ((offsetY + y) * outWidth + offsetX + x) * 4
      out[dst] = frame.rgba[src]
      out[dst + 1] = frame.rgba[src + 1]
      out[dst + 2] = frame.rgba[src + 2]
      out[dst + 3] = frame.rgba[src + 3]
    }
  }
  return { width: outWidth, height: outHeight, rgba: out }
}

/**
 * 水平镜像一帧 RGBA（自主走动「向左走」用——素材通常只画一个方向）。
 * 逐行反转像素，返回新帧（不修改入参，可在 present 前按方向调用）。
 */
export function flipHorizontal(frame: PetFrame): PetFrame {
  const { width, height, rgba } = frame
  const out = new Uint8Array(rgba.length)
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4
    for (let x = 0; x < width; x++) {
      const src = rowStart + x * 4
      const dst = rowStart + (width - 1 - x) * 4
      out[dst] = rgba[src]
      out[dst + 1] = rgba[src + 1]
      out[dst + 2] = rgba[src + 2]
      out[dst + 3] = rgba[src + 3]
    }
  }
  return { width, height, rgba: out }
}

/** The Codex contract's fixed base dimensions. */
export const BASE_CELL = { width: CELL_WIDTH, height: CELL_HEIGHT } as const

/**
 * Convert straight (non-premultiplied) RGBA into premultiplied BGRA, the byte
 * order Win32 `UpdateLayeredWindow(ULW_ALPHA)` expects on little-endian.
 * This is a pure, testable transform kept out of the backend.
 */
export function rgbaToPremultipliedBgra(frame: PetFrame): Uint8Array {
  const out = new Uint8Array(frame.rgba.length)
  rgbaToPremultipliedBgraInto(frame, out)
  return out
}

/**
 * Same conversion, writing into a caller-provided `out` buffer (which must be
 * at least `frame.rgba.length` bytes). The backend pre-allocates `out` once and
 * reuses it across frames, so the hot render path performs no per-frame
 * allocation.
 */
export function rgbaToPremultipliedBgraInto(frame: PetFrame, out: Uint8Array): void {
  const pixels = frame.width * frame.height
  for (let i = 0; i < pixels; i++) {
    const src = i * 4
    const r = frame.rgba[src]
    const g = frame.rgba[src + 1]
    const b = frame.rgba[src + 2]
    const a = frame.rgba[src + 3]
    const premultiply = (v: number) => Math.round((v * a) / 255)
    out[src] = premultiply(b)
    out[src + 1] = premultiply(g)
    out[src + 2] = premultiply(r)
    out[src + 3] = a
  }
}
