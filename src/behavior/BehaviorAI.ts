/**
 * whale-pet-pro M3 行为 AI：自主行为调度器。
 *
 * 只在宠物空闲（语义状态 = IDLE）时接管，通过 {@link BehaviorExecutor}
 * 驱动打哈欠 / 待机换肤 / 自主走动。心情档位决定「做什么」的概率
 * （心情高→开心/溜达多，心情低→打哈欠/发呆多）。DSH 一有活立刻让位。
 *
 * 纯逻辑：注入 clock + random 后可确定性测试。
 */

import type { SemanticState } from '../core/types'
import type { BehaviorClock, BehaviorExecutor } from './BehaviorTypes'
import type { MoodSystem, MoodLevel } from './MoodSystem'

/** 自主行为种类。 */
export type BehaviorKind = 'yawn' | 'walk' | 'happy'

/** 频率/概率调优（默认安静乖巧档）。 */
export interface BehaviorTuning {
  /** 待机换肤间隔（固定，毫秒）。 */
  variantMs: number
  /** 随机行为间隔区间 [min, max]（毫秒）。 */
  behaviorMs: [number, number]
}

/** 安静乖巧档（鸭鸭拍板）：换肤 20 秒，行为 60~120 秒随机。 */
export const QUIET_TUNING: BehaviorTuning = {
  variantMs: 20_000,
  behaviorMs: [60_000, 120_000],
}

/**
 * 行为选择概率（按心情档位）。和 = 1。
 * - happy：开心 40% / 溜达 40% / 打哈欠 20%（开心时多蹦跳、多溜达）
 * - neutral：打哈欠 55% / 溜达 45%
 * - bored：打哈欠 90% / 溜达 10%（无聊时老打哈欠、几乎不溜达）
 */
const BEHAVIOR_PROBS: Readonly<Record<MoodLevel, Record<BehaviorKind, number>>> = {
  happy: { yawn: 0.2, walk: 0.4, happy: 0.4 },
  neutral: { yawn: 0.55, walk: 0.45, happy: 0 },
  bored: { yawn: 0.9, walk: 0.1, happy: 0 },
}

export interface BehaviorAIOptions {
  clock?: BehaviorClock
  random?: () => number
  executor: BehaviorExecutor
  mood: MoodSystem
  tuning?: BehaviorTuning
}

const realClock: BehaviorClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class BehaviorAI {
  private readonly clock: BehaviorClock
  private readonly random: () => number
  private readonly executor: BehaviorExecutor
  private readonly mood: MoodSystem
  private readonly tuning: BehaviorTuning

  private variantTimer: unknown | undefined
  private behaviorTimer: unknown | undefined
  private active = false
  private disposed = false

  constructor(options: BehaviorAIOptions) {
    this.clock = options.clock ?? realClock
    this.random = options.random ?? Math.random
    this.executor = options.executor
    this.mood = options.mood
    this.tuning = options.tuning ?? QUIET_TUNING
  }

  /**
   * 语义状态变化通知：IDLE 启动调度；其余（WORKING/SUCCESS/ERROR/SLEEPING…）
   * 立即让位并清定时器。
   */
  onSemanticState(state: SemanticState): void {
    if (this.disposed) return
    if (state === 'IDLE') this.start()
    else this.stop()
  }

  /** 是否正在调度（测试/诊断用）。 */
  get isActive(): boolean {
    return this.active
  }

  private start(): void {
    if (this.active || this.disposed) return
    this.active = true
    this.armVariant()
    this.armBehavior()
  }

  private stop(): void {
    if (!this.active) return
    this.active = false
    this.clearVariant()
    this.clearBehavior()
  }

  private armVariant(): void {
    this.clearVariant()
    this.variantTimer = this.clock.setTimeout(() => {
      this.variantTimer = undefined
      if (!this.active || this.disposed) return
      if (!this.executor.isIdle()) { this.stop(); return }
      this.executor.nextIdleVariant()
      this.armVariant()
    }, this.tuning.variantMs)
  }

  private armBehavior(): void {
    this.clearBehavior()
    const [min, max] = this.tuning.behaviorMs
    const ms = min + this.random() * (max - min)
    this.behaviorTimer = this.clock.setTimeout(() => {
      this.behaviorTimer = undefined
      if (!this.active || this.disposed) return
      if (!this.executor.isIdle()) { this.stop(); return }
      this.dispatch(this.pickBehavior(this.mood.moodLevel()))
      this.armBehavior()
    }, ms)
  }

  /** 按心情档位的概率表选一个行为。 */
  private pickBehavior(level: MoodLevel): BehaviorKind {
    const probs = BEHAVIOR_PROBS[level]
    const r = this.random()
    let acc = 0
    for (const kind of ['yawn', 'walk', 'happy'] as const) {
      acc += probs[kind]
      if (r < acc) return kind
    }
    return 'yawn'
  }

  private dispatch(kind: BehaviorKind): void {
    if (kind === 'yawn' || kind === 'happy') {
      this.executor.playAction(kind)
    } else {
      const direction = this.random() < 0.5 ? 'left' : 'right'
      const steps = 3 + Math.floor(this.random() * 6) // 3~8 步
      this.executor.walk(direction, steps)
    }
  }

  private clearVariant(): void {
    if (this.variantTimer !== undefined) {
      this.clock.clearTimeout(this.variantTimer)
      this.variantTimer = undefined
    }
  }

  private clearBehavior(): void {
    if (this.behaviorTimer !== undefined) {
      this.clock.clearTimeout(this.behaviorTimer)
      this.behaviorTimer = undefined
    }
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }
}
