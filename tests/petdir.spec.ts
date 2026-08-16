/**
 * M2 step-2：dir 格式素材加载器 + 帧表播放的单元测试。
 * 素材目录使用仓库内的 whale-ui-pet（23 动作 / 1007 帧）。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPetDir, splitActionDirName, DEFAULT_DIR_FPS, type FrameBuffer } from '../src/renderer/petdir/PetDirLoader'
import type { PetManifest } from '../src/renderer/codex-pet/PetContract'
import { AnimationController, type AnimationClock } from '../src/renderer/AnimationController'
import type { AtlasBuffer, PetFrame } from '../src/renderer/FrameDecoder'

const PET_DIR = fileURLToPath(new URL('../assets/pets/whale-ui-pet/', import.meta.url))

const MANIFEST: PetManifest = {
  id: 'whale-ui-pet',
  format: 'dir',
  fps: 24,
  actions: { idle: { fps: 20 }, sleep: { fps: 12 } },
}

// 1007 帧的 sharp 解码较慢（~1-2s/次），全部用例共享一次加载。
let tables: Map<string, import('../src/renderer/petdir/PetDirLoader').DirFrameTable>
beforeAll(async () => {
  tables = await loadPetDir(PET_DIR, MANIFEST)
}, 120_000)

/** Fake clock: advance manually. */
function fakeClock() {
  let nowMs = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: AnimationClock = {
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

describe('PetDirLoader', () => {
  it('loads all 23 actions with the expected frame counts', () => {
    expect(tables.size).toBe(23)
    expect(tables.get('idle')?.variants[0].frames).toHaveLength(41)
    expect(tables.get('dance')?.variants[0].frames).toHaveLength(62)
    expect(tables.get('swim')?.variants[0].frames).toHaveLength(41)
  })

  it('decodes 220×220 transparent RGBA frames', () => {
    const idle = tables.get('idle')!
    const f = idle.variants[0].frames[0]
    expect(f.width).toBe(220)
    expect(f.height).toBe(220)
    expect(f.rgba.length).toBe(220 * 220 * 4)
  })

  it('applies per-action fps overrides and the global default', () => {
    expect(tables.get('idle')?.fps).toBe(20) // actions.idle override
    expect(tables.get('sleep')?.fps).toBe(12) // actions.sleep override
    expect(tables.get('dance')?.fps).toBe(24) // global fps
  })

  it('falls back to DEFAULT_DIR_FPS when the manifest has no fps', async () => {
    const bare: PetManifest = { id: 'x', format: 'dir' }
    const bareTables = await loadPetDir(PET_DIR, bare)
    expect(bareTables.get('idle')?.fps).toBe(DEFAULT_DIR_FPS)
  })

  it('covers the full action vocabulary', () => {
    const expected = [
      'angry', 'blush', 'cry', 'dance', 'drag', 'eat', 'happy', 'idle', 'music',
      'sit', 'sit_eat', 'sit_happy', 'sit_sleep', 'sit_stretch', 'sit_think',
      'sit_wave', 'sleep', 'stretch', 'surprise', 'swim', 'think', 'wait', 'wave',
    ]
    for (const action of expected) {
      expect(tables.has(action), `missing action: ${action}`).toBe(true)
    }
  })
})

describe('splitActionDirName', () => {
  it('splits numeric variant suffixes', () => {
    expect(splitActionDirName('idle')).toEqual({ action: 'idle', variantIndex: 0 })
    expect(splitActionDirName('idle_0')).toEqual({ action: 'idle', variantIndex: 0 })
    expect(splitActionDirName('idle_2')).toEqual({ action: 'idle', variantIndex: 2 })
    expect(splitActionDirName('walk_1')).toEqual({ action: 'walk', variantIndex: 1 })
  })

  it('keeps word suffixes as part of the action name', () => {
    expect(splitActionDirName('sit_eat')).toEqual({ action: 'sit_eat', variantIndex: 0 })
    expect(splitActionDirName('sit_happy')).toEqual({ action: 'sit_happy', variantIndex: 0 })
    expect(splitActionDirName('run_left')).toEqual({ action: 'run_left', variantIndex: 0 })
  })
})

describe('PetDirLoader variant merging', () => {
  it('merges idle_0/idle_1 into one action with two variants', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'petdir-variant-'))
    try {
      await mkdir(join(dir, 'idle_0'), { recursive: true })
      await mkdir(join(dir, 'idle_1'), { recursive: true })
      await mkdir(join(dir, 'walk_0'), { recursive: true })
      // 假帧：内容无所谓（loader 只关心解码成功 + 帧数）
      await writeFile(join(dir, 'idle_0', '1.png'), '')
      await writeFile(join(dir, 'idle_0', '2.png'), '')
      await writeFile(join(dir, 'idle_1', '1.png'), '')
      await writeFile(join(dir, 'walk_0', '1.png'), '')

      const decoder = async (paths: string[]): Promise<FrameBuffer[]> => paths.map(() => ({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) }))
      const manifest: PetManifest = { id: 'x', format: 'dir', fps: 24 }
      const loaded = await loadPetDir(dir, manifest, decoder)

      expect(loaded.size).toBe(2) // idle + walk
      expect(loaded.get('idle')?.variants).toHaveLength(2)
      expect(loaded.get('idle')?.variants[0].frames).toHaveLength(2)
      expect(loaded.get('idle')?.variants[1].frames).toHaveLength(1)
      expect(loaded.get('walk')?.variants).toHaveLength(1)
      expect(loaded.get('walk')?.loops).toBe(-1) // 缺省无限循环
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads loops from the manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'petdir-loop-'))
    try {
      await mkdir(join(dir, 'sleep'), { recursive: true })
      await writeFile(join(dir, 'sleep', '1.png'), '')
      const decoder = async (paths: string[]) => paths.map(() => ({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) }))
      const manifest: PetManifest = { id: 'x', format: 'dir', actions: { sleep: { loops: 1 } } }
      const loaded = await loadPetDir(dir, manifest, decoder)
      expect(loaded.get('sleep')?.loops).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('AnimationController dir-mode playback', () => {
  it('plays frames from a table at fps-derived durations', () => {
    const { clock, tick } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const frames: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      manifest: MANIFEST,
      tables,
      clock,
      onFrame: (frame) => frames.push(frame),
    })
    controller.start() // emits frame 0 immediately
    expect(frames).toHaveLength(1)
    expect(frames[0].width).toBe(220)

    // idle fps=20 → 50ms/frame; advance just past one frame.
    tick(51)
    expect(frames).toHaveLength(2)

    // Frames differ between indices (animation actually advances).
    expect(frames[1].rgba).not.toEqual(frames[0].rgba)

    // idle 共 41 帧（idx 0..40）；start 后已 1 次 tick（idx1），
    // 再 39 次 tick 到 idx40（frames=41），再 1 次 tick 回绕到 idx0。
    for (let i = 0; i < 39; i++) tick(51)
    expect(frames).toHaveLength(41)
    tick(51)
    expect(frames).toHaveLength(42)
    expect(frames[41].rgba).toEqual(frames[0].rgba)
    controller.dispose()
  })

  it('setAction plays any action present in the tables', () => {
    const { clock, tick } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const frames: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      manifest: MANIFEST,
      tables,
      clock,
      onFrame: (frame) => frames.push(frame),
    })
    controller.start() // idle frame 0 → frames=1
    controller.setAction('dance') // switches & emits dance frame 0 → frames=2
    expect(controller.currentAction).toBe('dance')
    expect(frames).toHaveLength(2)
    tick(42) // dance @24fps → 42ms/frame → frame 1 → frames=3
    expect(frames).toHaveLength(3)
    expect(frames[2].width).toBe(220)
    controller.dispose()
  })

  it('ignores setAction for unknown actions', () => {
    const { clock } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const controller = new AnimationController({
      atlas,
      scale: 1,
      manifest: MANIFEST,
      tables,
      clock,
    })
    controller.start()
    controller.setAction('no-such-action')
    expect(controller.currentAction).toBe('idle')
    controller.dispose()
  })

  it('playTransient returns to the resume action after one loop', () => {
    const { clock, tick } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const frames: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      manifest: MANIFEST,
      tables,
      actionMap: { waving: 'wave' },
      clock,
      onFrame: (frame) => frames.push(frame),
    })
    controller.start() // idle
    controller.playTransient('waving', 'idle') // wave, resume idle
    expect(controller.currentAction).toBe('wave')

    // wave fps=20 → 50ms/frame; 41 frames to loop back to idle.
    for (let i = 0; i < 41; i++) tick(51)
    expect(controller.currentAction).toBe('idle')
    controller.dispose()
  })
})

describe('AnimationController variant switching', () => {
  function variantTables(): Map<string, import('../src/renderer/petdir/PetDirLoader').DirFrameTable> {
    const m = new Map()
    m.set('idle', {
      action: 'idle',
      variants: [
        { frames: [{ width: 2, height: 2, rgba: new Uint8Array([10, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]) }] },
        { frames: [{ width: 2, height: 2, rgba: new Uint8Array([20, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]) }] },
      ],
      fps: 24,
      loops: -1,
    })
    m.set('walk', {
      action: 'walk',
      variants: [
        { frames: [{ width: 2, height: 2, rgba: new Uint8Array([30, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]) }] },
      ],
      fps: 24,
      loops: -1,
    })
    return m
  }

  it('randomly picks a variant when switching actions (random=0 → variant 0)', () => {
    const { clock } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const emitted: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      tables: variantTables(),
      random: () => 0,
      clock,
      onFrame: (f) => emitted.push(f),
    })
    controller.start() // idle（默认 variant 0）
    controller.setAction('walk') // 切到 walk
    controller.setAction('idle') // 切回 idle → random=0 → variant 0
    expect(controller.variantCount).toBe(2)
    expect(emitted.at(-1)!.rgba[0]).toBe(10) // variant 0 的首字节
    controller.dispose()
  })

  it('random=0.99 picks variant 1', () => {
    const { clock } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const emitted: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      tables: variantTables(),
      random: () => 0.99,
      clock,
      onFrame: (f) => emitted.push(f),
    })
    controller.start()
    controller.setAction('walk')
    controller.setAction('idle') // random=0.99 → variant 1
    expect(emitted.at(-1)!.rgba[0]).toBe(20) // variant 1 的首字节
    controller.dispose()
  })

  it('setVariant switches the active variant explicitly', () => {
    const { clock } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    const emitted: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      tables: variantTables(),
      random: () => 0,
      clock,
      onFrame: (f) => emitted.push(f),
    })
    controller.start() // variant 0
    controller.setVariant(1) // 切到 variant 1
    expect(emitted.at(-1)!.rgba[0]).toBe(20)
    controller.dispose()
  })

  it('loops=1 plays once then holds the last frame', () => {
    const { clock, tick } = fakeClock()
    const atlas: AtlasBuffer = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }
    // 单动作 3 帧，loops=1
    const tables = new Map<string, import('../src/renderer/petdir/PetDirLoader').DirFrameTable>()
    tables.set('sleep', {
      action: 'sleep',
      variants: [{
        frames: [
          { width: 1, height: 1, rgba: new Uint8Array([1, 0, 0, 255]) },
          { width: 1, height: 1, rgba: new Uint8Array([2, 0, 0, 255]) },
          { width: 1, height: 1, rgba: new Uint8Array([3, 0, 0, 255]) },
        ],
      }],
      fps: 10, // 100ms/帧
      loops: 1,
    })
    const emitted: PetFrame[] = []
    const controller = new AnimationController({
      atlas,
      scale: 1,
      tables,
      clock,
      onFrame: (f) => emitted.push(f),
    })
    controller.start()
    controller.setAction('sleep')
    // 3 帧各播一次（100ms 间隔），回绕时 loops 达成 → 停，不再递增
    for (let i = 0; i < 10; i++) tick(100)
    expect(emitted.length).toBeLessThanOrEqual(3)
    expect(emitted.at(-1)!.rgba[0]).toBe(3) // 停在最后一帧
    controller.dispose()
  })
})
