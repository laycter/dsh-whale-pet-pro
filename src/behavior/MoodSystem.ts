/**
 * whale-pet-pro M3 行为 AI：心情状态机。
 *
 * 0-100 的心情值，随时间缓慢衰减（无聊）；DSH 活动事件回升/下降
 * （主人干活 = 宠物陪伴 = 开心）。只负责「数值 + 档位」，频率决策
 * 交给 BehaviorAI。纯逻辑，注入 clock 后可确定性测试。
 */

import type { BehaviorClock } from './BehaviorTypes'

export type MoodLevel = 'happy' | 'neutral' | 'bored'

/** DSH 活动事件类型（语义状态 → 心情增减的来源）。 */
export type MoodActivity = 'working' | 'success' | 'error'

export interface MoodSystemOptions {
  clock?: BehaviorClock
  /** 初始心情（默认 60）。 */
  initial?: number
  /** 心情上下限（默认 0~100）。 */
  min?: number
  max?: number
  /** 衰减周期：每 tickMs 毫秒衰减 decay 点。 */
  tickMs?: number
  /** 每个衰减周期掉几点（默认 1）。 */
  decay?: number
}

/** 心情档位阈值（happy ≥ happyAt，bored ≤ boredAt，之间 neutral）。 */
export const MOOD_LEVELS = {
  happyAt: 65,
  boredAt: 35,
} as const

/** 活动事件 → 心情增减（working +5 / success +8 / error -5）。 */
export const MOOD_ACTIVITY_DELTA: Readonly<Record<MoodActivity, number>> = {
  working: 5,
  success: 8,
  error: -5,
}

const realClock: BehaviorClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class MoodSystem {
  private readonly clock: BehaviorClock
  private readonly min: number
  private readonly max: number
  private readonly tickMs: number
  private readonly decay: number
  private mood: number
  private timer: unknown | undefined
  private disposed = false

  constructor(options: MoodSystemOptions = {}) {
    this.clock = options.clock ?? realClock
    this.min = options.min ?? 0
    this.max = options.max ?? 100
    this.tickMs = options.tickMs ?? 60_000
    this.decay = options.decay ?? 1
    this.mood = this.clamp(options.initial ?? 60)
    this.scheduleTick()
  }

  /** 当前心情值（0-100）。 */
  get value(): number {
    return this.mood
  }

  /** 心情档位（happy/neutral/bored），供 BehaviorAI 做频率决策。 */
  moodLevel(): MoodLevel {
    if (this.mood >= MOOD_LEVELS.happyAt) return 'happy'
    if (this.mood <= MOOD_LEVELS.boredAt) return 'bored'
    return 'neutral'
  }

  /** DSH 活动事件：working/success/error 增减心情。 */
  onActivity(kind: MoodActivity): void {
    if (this.disposed) return
    this.apply(MOOD_ACTIVITY_DELTA[kind])
  }

  private clamp(v: number): number {
    return Math.max(this.min, Math.min(this.max, v))
  }

  private apply(delta: number): void {
    this.mood = this.clamp(this.mood + delta)
  }

  private scheduleTick(): void {
    if (this.disposed) return
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      if (this.disposed) return
      this.apply(-this.decay)
      this.scheduleTick()
    }, this.tickMs)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
