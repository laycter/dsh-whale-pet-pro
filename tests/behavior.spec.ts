/**
 * M3 行为 AI：镜像函数 + 心情状态机 + 行为调度器的单元测试。
 * 全部纯逻辑（fake clock + 固定 random），不依赖真实素材/窗口。
 */

import { describe, expect, it } from 'vitest'
import { flipHorizontal, borderFrame, type PetFrame } from '../src/renderer/FrameDecoder'
import { MoodSystem } from '../src/behavior/MoodSystem'
import { BehaviorAI, QUIET_TUNING } from '../src/behavior/BehaviorAI'
import type { BehaviorClock, BehaviorExecutor } from '../src/behavior/BehaviorTypes'

/** Fake clock：手动推进时间，触发到期定时器。 */
function fakeClock() {
  let nowMs = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: BehaviorClock = {
    now: () => nowMs,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.set(id, { at: nowMs + ms, fn })
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
  }
  function tick(ms: number): void {
    nowMs += ms
    const due = [...timers.entries()].filter(([, t]) => t.at <= nowMs).sort((a, b) => a[1].at - b[1].at)
    for (const [id, t] of due) {
      timers.delete(id)
      t.fn()
    }
  }
  return { clock, tick, now: () => nowMs }
}

/** 记录调用的假执行器。 */
function fakeExecutor(initialIdle = true) {
  const calls: string[] = []
  let idle = initialIdle
  const executor: BehaviorExecutor = {
    playAction: (action) => { calls.push(`action:${action}`) },
    nextIdleVariant: () => { calls.push('nextVariant') },
    walk: (direction, steps) => { calls.push(`walk:${direction}:${steps}`) },
    isIdle: () => idle,
  }
  return { executor, calls, setIdle: (v: boolean) => { idle = v } }
}

describe('flipHorizontal', () => {
  it('mirrors pixels horizontally without mutating the input', () => {
    const frame: PetFrame = {
      width: 2,
      height: 1,
      // 左像素 (1,2,3,4)，右像素 (5,6,7,8)
      rgba: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    }
    const flipped = flipHorizontal(frame)
    // 左右互换
    expect(Array.from(flipped.rgba)).toEqual([5, 6, 7, 8, 1, 2, 3, 4])
    // 入参未被修改
    expect(Array.from(frame.rgba)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('is its own inverse for a 3×2 frame', () => {
    const frame: PetFrame = {
      width: 3,
      height: 2,
      rgba: new Uint8Array([
        10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33,
        40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 62, 63,
      ]),
    }
    const twice = flipHorizontal(flipHorizontal(frame))
    expect(Array.from(twice.rgba)).toEqual(Array.from(frame.rgba))
  })
})

describe('borderFrame', () => {
  it('draws a hollow rectangle border with a transparent center', () => {
    const frame = borderFrame(5, 5, 1, [255, 0, 0, 255])
    // 左上角 (0,0) 是边框
    expect(Array.from(frame.rgba.slice(0, 4))).toEqual([255, 0, 0, 255])
    // 右下角 (4,4) 是边框
    const br = (4 * 5 + 4) * 4
    expect(Array.from(frame.rgba.slice(br, br + 4))).toEqual([255, 0, 0, 255])
    // 中心 (2,2) 透明
    const center = (2 * 5 + 2) * 4
    expect(Array.from(frame.rgba.slice(center, center + 4))).toEqual([0, 0, 0, 0])
  })
})

describe('MoodSystem', () => {
  it('starts at the configured value and reports neutral', () => {
    const { clock } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 })
    expect(mood.value).toBe(60)
    expect(mood.moodLevel()).toBe('neutral')
  })

  it('decays over time', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60, tickMs: 1000, decay: 1 })
    tick(1000)
    expect(mood.value).toBe(59)
    tick(1000)
    expect(mood.value).toBe(58)
  })

  it('activity events boost and drop mood', () => {
    const { clock } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 })
    mood.onActivity('working')
    expect(mood.value).toBe(65)
    expect(mood.moodLevel()).toBe('happy')
    mood.onActivity('success')
    expect(mood.value).toBe(73)
    mood.onActivity('error')
    expect(mood.value).toBe(68)
  })

  it('clamps to [0, 100]', () => {
    const { clock } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 99 })
    mood.onActivity('success') // +8 → 100（封顶）
    expect(mood.value).toBe(100)
    const low = new MoodSystem({ clock, initial: 2 })
    low.onActivity('error') // -5 → 0（兜底）
    expect(low.value).toBe(0)
  })

  it('reports bored below the threshold', () => {
    const { clock } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 35 })
    expect(mood.moodLevel()).toBe('bored')
    mood.onActivity('working') // +5 → 40 neutral
    expect(mood.moodLevel()).toBe('neutral')
  })
})

describe('BehaviorAI', () => {
  it('arms on IDLE and fires the variant timer', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 })
    const { executor, calls } = fakeExecutor(true)
    const ai = new BehaviorAI({ clock, random: () => 0, executor, mood })
    ai.onSemanticState('IDLE')
    expect(ai.isActive).toBe(true)
    tick(QUIET_TUNING.variantMs)
    expect(calls).toEqual(['nextVariant'])
  })

  it('dispatches yawn on the behavior timer when random picks it', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 }) // neutral
    const { executor, calls } = fakeExecutor(true)
    // random=0 → 行为间隔取 min；neutral 概率 r=0 < 0.55 → yawn
    const ai = new BehaviorAI({ clock, random: () => 0, executor, mood })
    ai.onSemanticState('IDLE')
    tick(QUIET_TUNING.behaviorMs[0])
    expect(calls).toContain('action:yawn')
  })

  it('walks in a random 8-direction with tick steps when random=0.7 in neutral mood', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 }) // neutral
    const { executor, calls } = fakeExecutor(true)
    // neutral 概率：r=0.7 > 0.55 → walk
    // direction = WALK_DIRECTIONS[⌊0.7×8⌋] = WALK_DIRECTIONS[5] = 'up-right'
    // steps = 20 + ⌊0.7×21⌋ = 34
    const ai = new BehaviorAI({ clock, random: () => 0.7, executor, mood })
    ai.onSemanticState('IDLE')
    // 间隔 = 60000 + 0.7×(120000-60000) = 102000
    tick(60000 + Math.round(0.7 * (120000 - 60000)))
    expect(calls).toContain('walk:up-right:34')
  })

  it('picks happy action when happy mood and random=0.9', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 70 }) // happy（≥65；推进时衰减 1 点仍 69 = happy）
    const { executor, calls } = fakeExecutor(true)
    // happy 概率：r=0.9 > 0.2+0.4=0.6 → happy
    const ai = new BehaviorAI({ clock, random: () => 0.9, executor, mood })
    ai.onSemanticState('IDLE')
    tick(60000 + Math.round(0.9 * (120000 - 60000)))
    expect(calls).toContain('action:happy')
  })

  it('yields (stops) when the semantic state leaves IDLE', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 })
    const { executor, calls } = fakeExecutor(true)
    const ai = new BehaviorAI({ clock, random: () => 0, executor, mood })
    ai.onSemanticState('IDLE')
    ai.onSemanticState('WORKING')
    expect(ai.isActive).toBe(false)
    const before = calls.length
    tick(QUIET_TUNING.variantMs + QUIET_TUNING.behaviorMs[0])
    expect(calls.length).toBe(before) // 让位后不再触发
  })

  it('re-arms and does nothing when executor reports non-idle', () => {
    const { clock, tick } = fakeClock()
    const mood = new MoodSystem({ clock, initial: 60 })
    const { executor, calls, setIdle } = fakeExecutor(true)
    const ai = new BehaviorAI({ clock, random: () => 0, executor, mood })
    ai.onSemanticState('IDLE')
    setIdle(false) // 宠物实际已忙，但语义状态没及时通知
    tick(QUIET_TUNING.behaviorMs[0])
    expect(calls).toEqual([]) // 不执行，让位
  })
})
