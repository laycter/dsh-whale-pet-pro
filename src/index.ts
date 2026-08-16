/**
 * deepseek-harness desktop-pet plugin entry point.
 *
 * The `apply` function is the only surface Cordis calls. Everything here is
 * assembled through the compatibility boundary: the bridge (harness events)
 * feeds the state machine, which drives the renderer, which owns a native
 * overlay window. Any failure in the window/renderer path is contained so it
 * never propagates into harness execution.
 *
 * When the optional settings service exists, a `desktop-pet` namespace is
 * registered and the Web configuration page can change `enabled` (show/hide),
 * `petScale` (size), and `petId` (which bundled pet) at runtime.
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

import { registerPetCommand } from './commands'
import { Config, type PetConfig } from './config'
import { PetStateMachine } from './core/PetStateMachine'
import type { NormalizedEvent, SemanticState } from './core/types'
import { createHarnessBridge, type HarnessBridge, type HarnessContext } from './integration/HarnessBridge'
import { savePosition } from './persistence'
import { loadPetAtlas, scanPets } from './pets'
import { installPetSettings, type PetSettingsHandle, type PetSettingsRegistrar, type PetSettingsSnapshot } from './settings'
import { PetWindow } from './renderer/PetWindow'
import { AudioPlayer } from './renderer/audio/AudioPlayer'
import { selectBackend } from './renderer/backend/selectBackend'
import { BehaviorAI } from './behavior/BehaviorAI'
import { MoodSystem, type MoodActivity } from './behavior/MoodSystem'

export const name = 'desktop-pet'
export const inject: string[] = []

export { Config }
export type { PetConfig }

/** A disposer may be sync or async; Cordis awaits async disposers on unload. */
type Disposer = () => void | Promise<void>

/** 宠物初始位置：召唤时出现的位置，右键「回到初始位置」与收起再召唤都回这里。 */
const INITIAL_POSITION = { x: 40, y: 40 } as const

/** 语义状态 → 心情活动事件（无则 undefined，靠时间自然衰减）。 */
function moodActivityFor(state: SemanticState): MoodActivity | undefined {
  switch (state) {
    case 'WORKING':
    case 'THINKING':
    case 'CODING':
    case 'RUNNING_COMMAND':
      return 'working'
    case 'SUCCESS':
      return 'success'
    case 'ERROR':
      return 'error'
    default:
      return undefined
  }
}

interface PetContext extends HarnessContext {
  effect(execute: () => Disposer, label?: string): Disposer
  inject(deps: string[], callback: (ctx: HarnessContext) => void): unknown
}

export function apply(ctx: Context, config: PetConfig): void {
  const petCtx = ctx as unknown as PetContext
  const log = petCtx.logger('desktop-pet')

  // 按需召唤（鸭鸭钦点）：不在这里提前 return。enabled 默认 false（见
  // cordis.patch.yml），settings 命名空间始终注册，窗口/素材加载严格由
  // reconcile 按 enabled 决定——开机不启动、不加载、不检查。
  petCtx.effect(() => {
    // Shared teardown state, populated as setup completes.
    let disposed = false
    let bridge: HarnessBridge | undefined
    let window: PetWindow | undefined
    let machine: PetStateMachine | undefined
    let unsubscribe: (() => void) | undefined
    let unregisterCommand: (() => void) | undefined
    let debugState: SemanticState | undefined
    let settingsHandle: PetSettingsHandle | undefined
    // M4 音效：host 端单例播放器（Windows 用 WMPlayer.OCX；其他平台 no-op）。
    const audioPlayer = new AudioPlayer()
    // M3 行为 AI：心情 + 自主行为调度器。executor 通过闭包访问 window
    // （window 在 reconcile 里异步创建；isIdle 在 window 未就绪时返回 false，
    // 保证行为 AI 不会在窗口存在前活动）。
    const moodSystem = new MoodSystem()
    const behaviorAI = new BehaviorAI({
      executor: {
        playAction: (action) => { window?.playAction(action) },
        nextIdleVariant: () => { window?.nextIdleVariant() },
        walk: (direction, steps) => { window?.walk(direction, steps) },
        isIdle: () => window?.isIdle() ?? false,
      },
      mood: moodSystem,
    })

    let currentSettings: PetSettingsSnapshot = {
      enabled: config.enabled,
      petScale: config.petScale,
      petId: config.petId,
      hideWhenIdle: config.hideWhenIdle,
      availablePets: [],
    }
    // The catalog is a scan-time fact, not a user setting: remember it here so
    // settings callbacks never adopt a stale/overridden `availablePets`.
    let catalog: PetSettingsSnapshot['availablePets'] = []
    let loadedPetKey: string | null = null
    let reconcileSeq = 0

    /** Whether the window should be visible given the current state + settings. */
    function shouldBeVisible(state: SemanticState | undefined): boolean {
      if (!currentSettings.enabled) return false
      // Debug override keeps the pet visible so `/pet <state>` is inspectable.
      if (debugState !== undefined) return true
      // Auto-hide only once the machine reaches the definitively-idle sleep
      // state (a period of no activity), never during transient IDLE between
      // tool calls inside an active turn.
      if (currentSettings.hideWhenIdle && state === 'SLEEPING') return false
      return true
    }

    function applyVisibility(state: SemanticState | undefined): void {
      window?.setVisible(shouldBeVisible(state))
    }

    /**
     * Resolve the pet id to actually load. A persisted petId may reference a
     * directory that has since been removed; fall back to the first available
     * catalog entry instead of failing the whole renderer.
     */
    function effectivePetId(petId: string): string {
      if (catalog.some(entry => entry.id === petId)) return petId
      return catalog[0]?.id ?? 'text'
    }

    /** Apply a resolved settings snapshot to the window (idempotent). */
    async function reconcile(settings: PetSettingsSnapshot): Promise<void> {
      const seq = ++reconcileSeq

      // 按需召唤：enabled=false 时销毁窗口并保持「未加载」状态——不扫描
      // 素材、不解码、不创建窗口。点击召唤按钮（或设置卡片开关）→ user
      // 层 enabled=true → settings watch → 这里才真正开始加载。
      if (!settings.enabled) {
        if (window) {
          const dying = window
          window = undefined
          loadedPetKey = null
          await dying.destroy().catch(() => {})
        }
        return
      }

      const petId = effectivePetId(settings.petId)
      const petKey = petId

      if (window) {
        applyVisibility(machine?.state)
        await window.setScale(settings.petScale)
        if (petKey !== loadedPetKey) {
          loadedPetKey = petKey
          try {
            const { atlas, manifest, tables, directory } = await loadPetAtlas(petId)
            if (disposed || seq !== reconcileSeq) return
            await window.loadPet(atlas, manifest, tables, directory)
          } catch (error) {
            log.warn('failed to switch pet; keeping current: %s', (error as Error)?.message ?? String(error))
          }
        }
        return
      }

      // Create the window with the current resolved settings.
      loadedPetKey = petKey
      let atlas
      let manifest
      let tables
      let directory
      try {
        const loaded = await loadPetAtlas(petId)
        atlas = loaded.atlas
        manifest = loaded.manifest
        tables = loaded.tables
        directory = loaded.directory
      } catch (error) {
        log.warn('failed to load pet assets; renderer disabled: %s', (error as Error)?.message ?? String(error))
        return
      }
      if (disposed || seq !== reconcileSeq) return

      const backend = selectBackend()
      if (!backend) {
        log.warn('no supported window backend on %s; renderer disabled', process.platform)
        return
      }

      try {
        window = new PetWindow({
          backend,
          atlas,
          manifest,
          tables,
          directory,
          audio: audioPlayer,
          scale: settings.petScale,
          alwaysOnTop: config.alwaysOnTop,
          animationEnabled: config.animationEnabled,
          idleFrequencySec: config.idleFrequencySec,
          clickThrough: config.clickThrough,
          // 收起再召唤自动回位：位置固定用初始位置，不读持久化坐标。
          position: INITIAL_POSITION,
          onDrag: (x, y) => savePosition({ x, y }),
          onHover: () => { window?.playJump() },
          onUnhover: () => { window?.endHover() },
          onClose: () => {
            // Persist "closed" through the settings seam when available, else
            // hide in place. Either path stops the pet until re-enabled.
            if (settingsHandle) {
              void settingsHandle.update({ enabled: false })
            } else {
              currentSettings.enabled = false
              applyVisibility(machine?.state)
            }
          },
        })
        await window.open()
        if (disposed) {
          await window.destroy()
          window = undefined
          return
        }
        const initialState: SemanticState = config.startSleeping ? 'SLEEPING' : 'IDLE'
        window.setState(initialState)
        applyVisibility(initialState)
        log.info('pet window created via %s backend (%s)', backend.name, petKey)
      } catch (error) {
        log.warn('failed to create pet window; renderer disabled: %s', (error as Error)?.message ?? String(error))
        window = undefined
      }
    }

    // Debug override plumbing (developer mode, /pet <state>).
    const debugHost = {
      setDebugState(state: SemanticState): void {
        debugState = state
        window?.setState(state)
        applyVisibility(state)
      },
      resetDebugState(): void {
        debugState = undefined
        if (machine) applyVisibility(machine.state)
      },
    }

    // Sync: start the bridge (subscriptions are installed synchronously).
    bridge = createHarnessBridge(petCtx)
    void bridge.start().catch((error) => {
      log.warn('bridge start failed: %s', (error as Error)?.message ?? String(error))
    })

    // Sync: build the state machine and wire events → window.
    machine = new PetStateMachine({
      // 行为 AI 需要充分的「清醒待机」窗口：无活动 5 分钟才入睡（默认 60 秒
      // 太短，宠物刚召唤 1 分钟就睡着，打哈欠/溜达根本没机会发生）。
      sleepAfterMs: 300_000,
      onChange: (state) => {
        if (disposed) return
        if (debugState === undefined) {
          window?.setState(state)
          // 行为 AI：空闲时接管自主行为，干活时让位。
          behaviorAI.onSemanticState(state)
          // 心情：活动事件挂钩（干活/成功/出错增减心情）。
          const activity = moodActivityFor(state)
          if (activity) moodSystem.onActivity(activity)
        }
        // Auto-hide reacts to the machine's SLEEPING transitions.
        applyVisibility(state)
      },
    })
    unsubscribe = bridge.subscribe((event: NormalizedEvent) => {
      if (disposed) return
      machine?.onEvent(event)
    })

    // Register the optional /pet debug command.
    unregisterCommand = registerPetCommand({ commands: petCtx.get('commands') } as never, debugHost)

    // Scan the bundled pet directory synchronously so the catalog is part of
    // the settings base snapshot registered below.
    catalog = scanPets()
    currentSettings.availablePets = catalog

    // Optional settings integration: wait for the settings service, then
    // register the namespace and react to committed changes.
    petCtx.inject(['settings'], (sctx) => {
      const registrar = sctx.get('settings') as PetSettingsRegistrar | undefined
      settingsHandle = installPetSettings(registrar, currentSettings, (settings) => {
        if (disposed) return
        // `availablePets` is always the host's scan result, never whatever
        // the settings round-trip resolved (a stale user layer must not
        // shadow the directory facts). Everything else follows settings.
        currentSettings = { ...settings, availablePets: catalog }
        void reconcile(currentSettings).catch((error) => {
          log.warn('settings reconcile failed: %s', (error as Error)?.message ?? String(error))
        })
      })
    })

    // Initial window creation (runs even when no settings service exists).
    void reconcile(currentSettings).catch((error) => {
      log.warn('desktop-pet startup failed: %s', (error as Error)?.message ?? String(error))
    })

    // Teardown (async so Cordis awaits window/native cleanup).
    return async () => {
      disposed = true
      settingsHandle?.dispose()
      unsubscribe?.()
      unregisterCommand?.()
      machine?.dispose()
      behaviorAI.dispose()
      moodSystem.dispose()
      await bridge?.stop().catch(() => {})
      await window?.destroy().catch(() => {})
      bridge = undefined
      window = undefined
      machine = undefined
    }
  })
}
