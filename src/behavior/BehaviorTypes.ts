/**
 * whale-pet-pro M3 行为 AI：共享类型与契约。
 *
 * 行为 AI 与渲染层完全解耦：调度器（BehaviorAI）只通过 {@link BehaviorExecutor}
 * 接口驱动宠物，不直接碰窗口/动画。心情（MoodSystem）与调度器都是纯逻辑，
 * 注入 clock/random 后可确定性测试。
 */

/** 可注入时钟/调度器（测试用 fake clock 驱动时间）。 */
export interface BehaviorClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** 自主走动的 8 个方向（水平 / 垂直 / 斜向）。 */
export type WalkDirection =
  | 'left' | 'right'
  | 'up' | 'down'
  | 'up-left' | 'up-right'
  | 'down-left' | 'down-right'

/** 8 方向列表（BehaviorAI 随机选一个）。 */
export const WALK_DIRECTIONS: readonly WalkDirection[] = [
  'left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right',
]

/**
 * 行为 AI 驱动宠物所需的渲染层能力（由 PetWindow 实现）。
 * 这些动作都是「自主 transient」，不改变语义状态（语义仍 idle）。
 */
export interface BehaviorExecutor {
  /** 播放一个一次性目录动作（yawn / happy），播完回当前语义动作。 */
  playAction(action: string): void
  /** 切到下一个 idle 变体（idle_0→1→2→3 顺序轮换）。 */
  nextIdleVariant(): void
  /** 短途溜达：朝 direction 平移 steps 个 tick（walk 动画 + 移动窗口）。 */
  walk(direction: WalkDirection, steps: number): void
  /** 当前语义是否空闲（行为 AI 只在空闲时接管）。 */
  isIdle(): boolean
}
