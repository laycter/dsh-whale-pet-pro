/**
 * Data-driven frame scheduler.
 *
 * Given a loaded atlas (Codex spritesheet) and/or a set of dir-format frame
 * tables, it plays the current action's frames at per-frame durations and
 * emits finished frames via an `onFrame` callback. The timer runs only while
 * playing; when stopped, no work is scheduled (near-zero idle CPU).
 *
 * whale-pet-pro 扩展：双素材模式。`tables` 命中时按帧表播放（任意帧数，
 * fps 均分）；未命中回退 Codex atlas 切片。`setAction` 可播放任意动作名，
 * 供行为 AI（M3）直接驱动，不受 CodexPetState 词汇表限制。
 */

import type { CodexPetState } from '../core/types'
import { durationsFor, type PetManifest } from './codex-pet/PetContract'
import type { DirFrameTable, FrameBuffer } from './petdir/PetDirLoader'
import { scaleFrame, sliceFrame, type AtlasBuffer, type PetFrame } from './FrameDecoder'

export interface AnimationClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: AnimationClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface AnimationControllerOptions {
  atlas: AtlasBuffer
  scale: number
  /** whale-pet-pro 扩展：pet.json 清单（fps 覆盖）。缺省走 Codex 契约时长。 */
  manifest?: PetManifest
  /** whale-pet-pro 扩展：dir 格式帧表（动作名 → 帧序列）。 */
  tables?: Map<string, DirFrameTable>
  /** whale-pet-pro 扩展：CodexPetState → 目录动作名映射；缺省同名。 */
  actionMap?: Record<string, string>
  /** whale-pet-pro 扩展：变体随机数源（注入供测试）；缺省 Math.random。 */
  random?: () => number
  clock?: AnimationClock
  onFrame?: (frame: PetFrame) => void
}

export class AnimationController {
  private readonly clock: AnimationClock
  private readonly atlas: AtlasBuffer
  private readonly scale: number
  private readonly manifest: PetManifest | undefined
  private readonly tables: Map<string, DirFrameTable> | undefined
  private readonly actionMap: Record<string, string>
  private readonly random: () => number
  private readonly onFrame: ((frame: PetFrame) => void) | undefined

  /** The currently playing action name (dir-format vocabulary). */
  private action = 'idle'
  private frameIndex = 0
  /** 当前变体索引（dir 格式多变体动作）。 */
  private variantIndex = 0
  /** 已完成的循环次数（loops 限制用）。 */
  private loopCount = 0
  private playing = false
  private timer: unknown | undefined
  private resumeAction: string | undefined
  /** transient 播完回 resume 时的一次性回调（出场动画用）。 */
  private transientOnComplete: (() => void) | undefined
  private disposed = false

  constructor(options: AnimationControllerOptions) {
    this.clock = options.clock ?? realClock
    this.atlas = options.atlas
    this.scale = options.scale
    this.manifest = options.manifest
    this.tables = options.tables
    this.actionMap = options.actionMap ?? {}
    this.random = options.random ?? Math.random
    this.onFrame = options.onFrame
  }

  get currentState(): CodexPetState {
    return this.action as CodexPetState
  }

  /** The raw action name, which may exceed the Codex vocabulary (dir format). */
  get currentAction(): string {
    return this.action
  }

  /** 当前动作的变体数（dir 格式；无帧表时为 1）。 */
  get variantCount(): number {
    return this.tables?.get(this.action)?.variants.length ?? 1
  }

  /** Resolve a Codex pose name through the action map (fallback: identity). */
  private actionFor(state: CodexPetState): string {
    return this.actionMap[state] ?? state
  }

  /** 切换动作时随机选一个变体（多变体时）；单变体恒为 0。 */
  private pickVariant(action: string): void {
    const count = this.tables?.get(action)?.variants.length ?? 1
    this.variantIndex = count > 1 ? Math.floor(this.random() * count) : 0
  }

  /** 手动指定变体（供行为 AI/测试；越界回绕）。 */
  setVariant(index: number): void {
    const count = this.variantCount
    this.variantIndex = count > 0 ? ((index % count) + count) % count : 0
    this.frameIndex = 0
    this.scheduleNext()
  }

  /** 切到当前动作的下一个变体（循环）。单变体 no-op（行为 AI 待机换肤用）。 */
  nextVariant(): void {
    const count = this.variantCount
    if (count <= 1) return
    this.setVariant(this.variantIndex + 1)
  }

  /** Switch the looping animation. Restarts from the first frame. */
  setState(state: CodexPetState): void {
    const action = this.actionFor(state)
    if (this.action === action && this.playing) return
    this.action = action
    this.frameIndex = 0
    this.loopCount = 0
    this.resumeAction = undefined
    this.transientOnComplete = undefined
    this.pickVariant(action)
    this.scheduleNext()
  }

  /**
   * Play a transient action once, then return to `resume` (idle variations).
   * `onComplete` fires exactly once when the transient loops back to `resume`
   * (interrupted transients never fire it).
   */
  playTransient(state: CodexPetState, resume: CodexPetState, onComplete?: () => void): void {
    this.action = this.actionFor(state)
    this.frameIndex = 0
    this.loopCount = 0
    this.resumeAction = this.actionFor(resume)
    this.transientOnComplete = onComplete
    this.pickVariant(this.action)
    this.scheduleNext()
  }

  /**
   * whale-pet-pro 扩展：直接播放任意动作（帧表命中时）。
   * 无对应帧表且不在 Codex 词汇表内时忽略（保持当前动作）。
   */
  setAction(action: string): void {
    if (this.tables?.has(action)) {
      if (this.action === action && this.playing) return
      this.action = action
      this.frameIndex = 0
      this.loopCount = 0
      this.resumeAction = undefined
      this.transientOnComplete = undefined
      this.pickVariant(action)
      this.scheduleNext()
    }
  }

  start(): void {
    if (this.playing || this.disposed) return
    this.playing = true
    this.frameIndex = 0
    this.scheduleNext()
  }

  stop(): void {
    this.playing = false
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** The current action's active variant frames (variantIndex-selected). */
  private activeVariant(table: DirFrameTable): FrameBuffer[] {
    return table.variants[this.variantIndex % table.variants.length]?.frames ?? []
  }

  /** Per-frame durations for the current action (frame table or contract). */
  private durations(): number[] {
    const table = this.tables?.get(this.action)
    if (table) {
      const perFrame = Math.max(16, Math.round(1000 / table.fps))
      const frames = this.activeVariant(table)
      return frames.map(() => perFrame)
    }
    return durationsFor(this.action as CodexPetState, this.manifest)
  }

  private emitCurrent(): void {
    try {
      const table = this.tables?.get(this.action)
      let frame: PetFrame
      if (table) {
        const frames = this.activeVariant(table)
        const raw: FrameBuffer = frames[this.frameIndex % frames.length]
        frame = { width: raw.width, height: raw.height, rgba: raw.rgba }
      } else {
        frame = sliceFrame(this.atlas, this.action as CodexPetState, this.frameIndex)
      }
      const scaled = this.scale === 1 ? frame : scaleFrame(frame, this.scale)
      this.onFrame?.(scaled)
    } catch (error) {
      // A bad frame must not kill the animation loop.
      if (typeof console !== 'undefined') console.warn('[whale-pet-pro] frame error:', (error as Error)?.message)
    }
  }

  private scheduleNext(): void {
    if (!this.playing || this.disposed) return
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)

    const durations = this.durations()
    if (durations.length === 0) return
    const duration = durations[this.frameIndex % durations.length] ?? 150

    this.emitCurrent()

    const frameCount = durations.length
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      if (!this.playing || this.disposed) return

      this.frameIndex = (this.frameIndex + 1) % frameCount
      if (this.frameIndex === 0) {
        // The transient has looped once; return to the resume pose.
        if (this.resumeAction !== undefined) {
          this.action = this.resumeAction
          this.resumeAction = undefined
          const done = this.transientOnComplete
          this.transientOnComplete = undefined
          this.pickVariant(this.action)
          done?.()
        } else {
          // loops 限制（dir 表）：>=1 时播满 N 遍停最后一帧，不再调度。
          this.loopCount++
          const table = this.tables?.get(this.action)
          if (table && table.loops >= 1 && this.loopCount >= table.loops) {
            return
          }
        }
      }
      this.scheduleNext()
    }, duration)
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }
}
