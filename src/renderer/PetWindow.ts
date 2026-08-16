/**
 * The renderer's orchestrator: owns a {@link WindowBackend} handle and an
 * {@link AnimationController}, maps semantic states to Codex poses, and feeds
 * finished frames into the window.
 *
 * Idle "alive" behavior lives here: when idle, a low-frequency randomized
 * transient (a wave or hop) plays so the pet never looks frozen, without
 * driving aggressive continuous animation.
 *
 * Live settings changes (scale / pet atlas / visibility) rebuild the window
 * in place: the backend handle and animation controller are torn down and
 * recreated, while the current position is preserved.
 */

import { resolve } from 'node:path'
import type { CodexPetState, SemanticState } from '../core/types'
import { SEMANTIC_STATE_TO_TRIGGER, SEMANTIC_TO_CODEX } from '../core/types'
import { AnimationController, type AnimationClock } from './AnimationController'
import { fitFrame, flipHorizontal, type AtlasBuffer, type PetFrame } from './FrameDecoder'
import type { PetManifest } from './codex-pet/PetContract'
import type { DirFrameTable } from './petdir/PetDirLoader'
import { AudioPlayer } from './audio/AudioPlayer'
import type { BehaviorExecutor } from '../behavior/BehaviorTypes'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './backend/WindowBackend'

export interface PetWindowOptions {
  backend: WindowBackend
  atlas: AtlasBuffer
  /** whale-pet-pro 扩展：pet.json 清单（fps 覆盖 / semantic / audio）。 */
  manifest?: PetManifest
  /** whale-pet-pro 扩展：dir 格式帧表（动作名 → 帧序列）。 */
  tables?: Map<string, DirFrameTable>
  /**
   * whale-pet-pro 扩展：CodexPetState → 目录动作名映射。
   * 缺省用 {@link DEFAULT_ACTION_MAP}（鲸鱼娘素材特化）。
   */
  actionMap?: Record<string, string>
  /** whale-pet-pro 扩展（M4 音效）：pet 目录绝对路径（拼 manifest.audio 相对路径）。 */
  directory?: string
  /** whale-pet-pro 扩展（M4 音效）：音效播放器（缺省不播）。 */
  audio?: AudioPlayer
  scale: number
  alwaysOnTop: boolean
  animationEnabled: boolean
  /** Seconds between idle variations (transient wave/hop). */
  idleFrequencySec: number
  position?: { x: number; y: number } | null
  clickThrough?: boolean
  clock?: AnimationClock
  random?: () => number
  onDrag?: (x: number, y: number) => void
  /** Invoked repeatedly during a drag with the horizontal direction. */
  onDragMove?: (direction: 'left' | 'right') => void
  /** Invoked when a drag ends. */
  onDragEnd?: () => void
  /** Invoked when the pointer hovers over the pet (backend rate-limits it). */
  onHover?: () => void
  /** Invoked when the pointer leaves the pet. */
  onUnhover?: () => void
  /** Invoked when the user chooses the context menu's "close pet" item. */
  onClose?: () => void
}

const BASE_WIDTH = 192
const BASE_HEIGHT = 208
const DEFAULT_POSITION = { x: 40, y: 40 } as const

/** 自主走动参数：每步移动像素 + 步间隔 + 锚点最大漂移（小范围溜达）。 */
const WALK_STEP_PX = 30
const WALK_STEP_MS = 150
const WALK_MAX_DRIFT = 150

/**
 * whale-pet-pro 扩展：默认 Codex 姿势 → 目录动作映射（面向 dsh-client-ui-pet
 * 的 23 动作素材）。语义状态经 SEMANTIC_TO_CODEX 到姿势，再到这里的动作名：
 * - 干活/思考 → sit_think（坐着思考；原 swim 的划水动作视觉像欢呼，鸭鸭拍板改）
 * - 拖拽 → drag（素材自带拖拽动画）
 * - 悬浮反应 → surprise（惊喜一跳）
 * - 出错 → cry，等回复 → wait，检查成果 → think
 */
export const DEFAULT_ACTION_MAP: Readonly<Record<string, string>> = {
  idle: 'idle',
  'running-right': 'drag',
  'running-left': 'drag',
  waving: 'wave',
  jumping: 'surprise',
  failed: 'cry',
  waiting: 'wait',
  running: 'sit_think',
  review: 'think',
}

/** whale-pet-pro 扩展：SLEEPING 语义直接映射到 sleep 动作（帧表存在时）。 */
const SEMANTIC_ACTION_OVERRIDES: Readonly<Partial<Record<SemanticState, string>>> = {
  SLEEPING: 'sleep',
}

export class PetWindow implements BehaviorExecutor {
  private readonly backend: WindowBackend
  private readonly animationEnabled: boolean
  private readonly idleFrequencySec: number
  private readonly clickThrough: boolean
  private readonly clock: AnimationClock
  private readonly random: () => number
  private readonly onDrag: ((x: number, y: number) => void) | undefined
  private readonly onDragMove: ((direction: 'left' | 'right') => void) | undefined
  private readonly onDragEnd: (() => void) | undefined
  private readonly onHover: (() => void) | undefined
  private readonly onUnhover: (() => void) | undefined
  private readonly onClose: (() => void) | undefined

  private atlas: AtlasBuffer
  private manifest: PetManifest | undefined
  private tables: Map<string, DirFrameTable> | undefined
  private actionMap: Record<string, string>
  private directory: string | undefined
  private audio: AudioPlayer | undefined
  private scale: number
  private currentX: number
  private currentY: number
  /** M4 音效去重：记录上次播放的触发状态，连续相同不重播。 */
  private lastAudioTrigger: string | undefined
  /** 是否已播过出场动画（首次 open 播出场，recreate 不重播）。 */
  private introPlayed = false
  /** 出场动画播放中（setState 排队，不打断 fall 掉落登场）。 */
  private introPlaying = false
  /** 出场动画期间的待应用语义状态（出场播完再应用）。 */
  private pendingState: SemanticState | undefined

  private handle: WindowHandle | undefined
  private controller: AnimationController | undefined
  private semantic: SemanticState = 'IDLE'
  private windowWidth = BASE_WIDTH
  private windowHeight = BASE_HEIGHT
  private visible = true
  private opened = false
  private destroyed = false
  private hovered = false
  private dragging = false
  /** 自主走动：是否镜像（向左走 true）。 */
  private mirrored = false
  /** 自主走动：步进定时器 / 剩余步数 / 方向。 */
  private walkTimer: unknown | undefined
  private walkStepsLeft = 0
  private walkDirection: 'left' | 'right' = 'right'
  /** 走动锚点（召唤/拖拽结束时的位置），约束 ±WALK_MAX_DRIFT。 */
  private anchorX: number
  private anchorY: number

  constructor(options: PetWindowOptions) {
    this.backend = options.backend
    this.atlas = options.atlas
    this.manifest = options.manifest
    this.tables = options.tables
    this.actionMap = options.actionMap ?? DEFAULT_ACTION_MAP
    this.directory = options.directory
    this.audio = options.audio
    this.scale = options.scale
    this.animationEnabled = options.animationEnabled
    this.idleFrequencySec = options.idleFrequencySec
    this.clickThrough = options.clickThrough ?? false
    this.clock = options.clock ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    this.random = options.random ?? Math.random
    this.onDrag = options.onDrag
    this.onDragMove = options.onDragMove
    this.onDragEnd = options.onDragEnd
    this.onHover = options.onHover
    this.onUnhover = options.onUnhover
    this.onClose = options.onClose

    const position = options.position ?? DEFAULT_POSITION
    this.currentX = position.x
    this.currentY = position.y
    this.anchorX = position.x
    this.anchorY = position.y
  }

  /**
   * whale-pet-pro 扩展：当前语义状态对应的目录动作名。
   * 优先级：manifest.semantic（触发状态 → 目录动作，M3 映射外部化）
   * → 旧两层映射兜底（SEMANTIC_TO_CODEX + actionMap，供无 semantic 声明的宠物）。
   */
  private actionForSemantic(state: SemanticState): string {
    // 1) manifest.semantic 直接映射（dir 宠物自带声明）
    const trigger = SEMANTIC_STATE_TO_TRIGGER[state]
    const declared = this.manifest?.semantic?.[trigger]
    if (declared && this.tables?.has(declared)) return declared
    // 2) 兜底：SLEEPING 直连 sleep + Codex 两层映射
    const override = SEMANTIC_ACTION_OVERRIDES[state]
    if (override && this.tables?.has(override)) return override
    const pose = SEMANTIC_TO_CODEX[state] ?? 'idle'
    const action = this.actionMap[pose] ?? pose
    return this.tables?.has(action) ? action : pose
  }

  /**
   * whale-pet-pro 扩展（M4 音效）：对齐 DeskPet 作者的音效策略。
   * - idle/home 是循环待机/睡眠动作，【不播音效】（素材自带背景音，循环重播会一直响）
   * - 其他动作（walk/happy/hurt/yawn/sleep/fall/drag）进入时【播一次】（NSSound.play 语义）
   * - 切换动作先停旧声音
   * @param trigger - 触发状态（idle/working/success/error/sleeping/hover/drag/fall）
   * @param action - 对应的目录动作（判断 idle/home 不播）
   */
  private playAudioForTrigger(trigger: string, action: string): void {
    if (!this.audio || !this.directory) return
    // idle/home 不播音效，但要停掉旧声音（避免旧音效一直放完）。
    if (action === 'idle' || action === 'home') {
      this.audio.stop()
      return
    }
    if (trigger === this.lastAudioTrigger) return
    this.lastAudioTrigger = trigger
    const rel = this.manifest?.audio?.[trigger]
    if (!rel) {
      this.audio.stop()
      return
    }
    // DeskPet 的音效一律一次性（NSSound.play()），不循环。
    this.audio.play(resolve(this.directory, rel))
  }

  /** 语义状态变化时播放对应音效（对齐 DeskPet：一次性，idle/home 不播）。 */
  private playTriggerAudio(state: SemanticState, action: string): void {
    const trigger = SEMANTIC_STATE_TO_TRIGGER[state]
    this.playAudioForTrigger(trigger, action)
  }

  /** 右键菜单「切换声音」：切换静音状态；恢复时立即重播当前音效。 */
  private toggleMute(): void {
    if (!this.audio) return
    const next = !this.audio.isMuted
    this.audio.setMuted(next)
    if (!next) {
      // 恢复声音：清掉去重标记，重播当前语义音效。
      this.lastAudioTrigger = undefined
      const action = this.actionForSemantic(this.semantic)
      this.playTriggerAudio(this.semantic, action)
    }
  }

  /** whale-pet-pro 扩展：基准帧尺寸（当前动作变体首帧，回退 Codex 契约）。 */
  private baseFrameSize(): { width: number; height: number } {
    const action = this.actionForSemantic(this.semantic)
    const first = this.tables?.get(action)?.variants[0]?.frames[0]
    if (first) return { width: first.width, height: first.height }
    return { width: BASE_WIDTH, height: BASE_HEIGHT }
  }

  /**
   * whale-pet-pro 扩展：有效缩放 = 用户 petScale × manifest.scale（宠物自带基准缩放，
   * 如 DeskPet 的 0.35 用于把 ~300px 帧缩到合适大小）。
   */
  private renderScale(): number {
    return this.scale * (this.manifest?.scale ?? 1)
  }

  /** Create the overlay window and start the animation loop. */
  async open(): Promise<void> {
    if (this.destroyed || this.opened) return
    this.opened = true

    const base = this.baseFrameSize()
    const rs = this.renderScale()
    this.windowWidth = Math.max(1, Math.round(base.width * rs))
    this.windowHeight = Math.max(1, Math.round(base.height * rs))

    const opts: WindowBackendOptions = {
      width: this.windowWidth,
      height: this.windowHeight,
      x: this.currentX,
      y: this.currentY,
      alwaysOnTop: true,
      clickThrough: this.clickThrough,
      onDrag: (x, y) => {
        this.currentX = x
        this.currentY = y
        this.onDrag?.(x, y)
      },
      onDragMove: (direction) => {
        this.beginDrag(direction)
      },
      onDragEnd: () => {
        this.endDrag()
      },
      onHover: () => {
        this.onHover?.()
      },
      onUnhover: () => {
        this.onUnhover?.()
      },
      onClose: () => {
        this.onClose?.()
      },
      onToggleMute: () => {
        this.toggleMute()
      },
    }
    this.handle = await this.backend.create(opts)

    this.controller = new AnimationController({
      atlas: this.atlas,
      scale: rs,
      manifest: this.manifest,
      tables: this.tables,
      actionMap: this.actionMap,
      clock: this.clock,
      onFrame: (frame) => this.present(frame),
    })
    if (this.animationEnabled) this.controller.start()

    // 出场：首次出现时播「出场」动作（如 DeskPet 的 fall 掉落登场），播完转 idle。
    // 只在首次 open 播出场（recreate 切宠物/缩放不重播）。
    if (!this.introPlayed) {
      this.introPlayed = true
      const introAction = this.manifest?.semantic?.starting
      if (introAction && this.tables?.has(introAction)) {
        // 出场音效（一次性）+ 出场动作（播完回 idle）。期间 setState 排队，
        // 播完 fall 再应用 pendingState，避免 open() 后的 setState 打断掉落。
        this.introPlaying = true
        this.playAudioForTrigger('fall', introAction)
        this.controller.playTransient(introAction as CodexPetState, 'idle', () => {
          this.introPlaying = false
          const pending = this.pendingState
          this.pendingState = undefined
          if (pending !== undefined) this.applyState(pending)
        })
      } else {
        this.applyState(this.semantic)
      }
    } else {
      this.applyState(this.semantic)
    }
    if (!this.visible) this.handle.hide()
  }

  /** The current renderer pose (for diagnostics/tests). */
  get currentPose(): CodexPetState | undefined {
    return this.controller?.currentState
  }

  /** Set the semantic state; the pose is derived, not caller-decided. */
  setState(state: SemanticState): void {
    this.semantic = state
    if (!this.controller || this.destroyed) return
    // While dragging, defer the pose switch so it does not interrupt the
    // direction animation; endDrag applies the latest semantic state.
    if (this.dragging) return
    // 出场动画播放中：记住最新状态，播完 fall 掉落登场后再应用（否则
    // open() 之后的 setState(IDLE) 会立刻把 fall 覆盖成 idle）。
    if (this.introPlaying) {
      this.pendingState = state
      return
    }
    // 自主走动被打断：停步 + 清镜像（DSH 有活优先）。
    this.cancelWalk()
    this.mirrored = false
    this.applyState(state)
  }

  /** 用户交互（拖拽/悬停）打断出场掉落时，结束 intro 排队状态。 */
  private finishIntro(): void {
    this.introPlaying = false
    this.pendingState = undefined
  }

  /** Enter the drag animation, playing the direction pose + drag 音效（一次性）。 */
  private beginDrag(direction: 'left' | 'right'): void {
    if (this.destroyed || !this.controller) return
    this.dragging = true
    this.finishIntro()
    this.cancelWalk()
    this.mirrored = false
    this.playAudioForTrigger('drag', 'drag')
    this.controller.setState(direction === 'left' ? 'running-left' : 'running-right')
  }

  /** Exit the drag animation and return to the current semantic pose. */
  private endDrag(): void {
    if (this.destroyed || !this.controller) return
    this.dragging = false
    // 拖拽到新位置：锚点跟随（自主走动以新位置为中心 ±150px）。
    this.anchorX = this.currentX
    this.anchorY = this.currentY
    this.applyState(this.semantic)
  }

  /** Show or hide the pet without disposing it. */
  setVisible(visible: boolean): void {
    this.visible = visible
    if (this.destroyed || !this.handle) return
    if (visible) this.handle.show()
    else this.handle.hide()
  }

  /** Resize the pet by rebuilding the window to the new scale. */
  async setScale(scale: number): Promise<void> {
    if (this.destroyed || scale === this.scale) return
    this.scale = scale
    await this.recreate()
  }

  /** Swap the sprite atlas (a different pet) by rebuilding the window. */
  async loadPet(atlas: AtlasBuffer, manifest?: PetManifest, tables?: Map<string, DirFrameTable>, directory?: string): Promise<void> {
    if (this.destroyed || atlas === this.atlas) return
    this.atlas = atlas
    this.manifest = manifest
    this.tables = tables
    this.directory = directory
    this.lastAudioTrigger = undefined
    await this.recreate()
  }

  private async recreate(): Promise<void> {
    if (!this.opened || this.destroyed) return
    this.teardownWindow()
    this.opened = false
    await this.open()
  }

  private applyState(state: SemanticState): void {
    const action = this.actionForSemantic(state)
    this.playTriggerAudio(state, action)
    if (this.tables?.has(action)) this.controller?.setAction(action)
    else this.controller?.setState(action as CodexPetState)
  }

  /**
   * Hover 反应：优先用 manifest.semantic.hover（dir 宠物声明，如 boring-pet
   * hover→happy）；否则回退 Codex jumping（surprise）。悬停期间循环播放，
   * endHover 恢复语义动作。
   */
  playJump(): void {
    if (this.destroyed || !this.controller) return
    // WM_NCMOUSEMOVE fires continuously while the pointer moves over the pet;
    // only react on the hover *edge*, otherwise the transient never completes.
    if (this.hovered) return
    this.hovered = true
    this.finishIntro()
    const hoverAction = this.manifest?.semantic?.hover
    if (hoverAction && this.tables?.has(hoverAction)) {
      this.controller.setAction(hoverAction)
    } else {
      const resumePose = SEMANTIC_TO_CODEX[this.semantic] ?? 'idle'
      this.controller.playTransient('jumping', resumePose)
    }
  }

  /**
   * whale-pet-pro 扩展：直接播放一个目录动作（M3 行为 AI / DialogueBridge
   * 用），一次循环后回到当前语义动作。动作不存在时忽略。
   */
  playAction(action: string): void {
    if (this.destroyed || !this.controller) return
    if (!this.tables?.has(action)) return
    // 打断自主走动（避免边走边打哈欠/开心）。
    this.cancelWalk()
    this.mirrored = false
    const resume = this.actionForSemantic(this.semantic)
    this.controller.playTransient(action as CodexPetState, resume as CodexPetState)
  }

  /** End the hover reaction and return to the current semantic pose. */
  endHover(): void {
    if (this.destroyed || !this.controller) return
    this.hovered = false
    const action = this.actionForSemantic(this.semantic)
    if (this.tables?.has(action)) this.controller.setAction(action)
    else this.controller.setState(action as CodexPetState)
  }

  // ── BehaviorExecutor 实现（M3 行为 AI）──────────────────────────────

  /** 当前语义是否空闲（行为 AI 只在空闲时接管）。 */
  isIdle(): boolean {
    return this.semantic === 'IDLE' && !this.dragging
  }

  /** 切到 idle 动作的下一个变体（idle_0→1→2→3 轮换）。单变体/非 idle no-op。 */
  nextIdleVariant(): void {
    if (this.destroyed || !this.controller) return
    if (this.controller.currentAction !== 'idle') return
    this.controller.nextVariant()
  }

  /**
   * 自主走动：朝 direction 走 steps 步（walk 动画 + 逐步移动窗口），
   * 锚点 ±WALK_MAX_DRIFT 内小范围溜达，越界反向。走完回 idle。
   */
  walk(direction: 'left' | 'right', steps: number): void {
    if (this.destroyed || !this.controller || !this.handle) return
    this.cancelWalk()
    // 锚点约束：朝 direction 走 steps 步会否超出 ±WALK_MAX_DRIFT，超出则反向。
    const dx = (direction === 'left' ? -1 : 1) * WALK_STEP_PX * steps
    if (Math.abs(this.currentX + dx - this.anchorX) > WALK_MAX_DRIFT) {
      direction = direction === 'left' ? 'right' : 'left'
    }
    this.walkDirection = direction
    this.walkStepsLeft = steps
    this.mirrored = direction === 'left'
    this.controller.setAction('walk')
    this.scheduleWalkStep()
  }

  private scheduleWalkStep(): void {
    this.walkTimer = this.clock.setTimeout(() => {
      this.walkTimer = undefined
      if (this.destroyed || !this.handle) return
      if (this.walkStepsLeft <= 0) { this.finishWalk(); return }
      const dx = this.walkDirection === 'left' ? -WALK_STEP_PX : WALK_STEP_PX
      this.currentX += dx
      this.handle.move(this.currentX, this.currentY)
      this.onDrag?.(this.currentX, this.currentY) // 持久化新位置
      this.walkStepsLeft--
      this.scheduleWalkStep()
    }, WALK_STEP_MS)
  }

  private finishWalk(): void {
    this.mirrored = false
    this.walkStepsLeft = 0
    this.walkDirection = 'right'
    // 走完恢复 idle 动作。
    const action = this.actionForSemantic('IDLE')
    if (this.controller) {
      if (this.tables?.has(action)) this.controller.setAction(action)
      else this.controller.setState(action as CodexPetState)
    }
  }

  private cancelWalk(): void {
    if (this.walkTimer !== undefined) {
      this.clock.clearTimeout(this.walkTimer)
      this.walkTimer = undefined
    }
    this.walkStepsLeft = 0
  }

  private present(frame: import('./FrameDecoder').PetFrame): void {
    if (this.destroyed || !this.handle) return
    try {
      // 向左走镜像（素材只画一个方向）；dir 格式帧尺寸可能不同，统一
      // 等比适配到窗口尺寸再上屏。
      const oriented = this.mirrored ? flipHorizontal(frame) : frame
      const fitted = fitFrame(oriented, this.windowWidth, this.windowHeight)
      this.handle.present(fitted)
    } catch {
      // A failed frame must not propagate into the harness. Swallow and keep
      // the loop; the next frame may succeed.
    }
  }

  show(): void {
    this.setVisible(true)
  }

  hide(): void {
    this.setVisible(false)
  }

  private teardownWindow(): void {
    this.cancelWalk()
    this.controller?.dispose()
    this.controller = undefined
    this.audio?.stop()
    try {
      this.handle?.destroy()
    } catch {
      // Best-effort native teardown.
    }
    this.handle = undefined
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.teardownWindow()
  }
}
