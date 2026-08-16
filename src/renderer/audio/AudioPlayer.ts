/**
 * whale-pet-pro M4：基础音效播放器（Windows UWP MediaPlayer）。
 *
 * 用 UWP MediaPlayer（异步播放器，内部线程）在后台播放 m4a——spawn 一个
 * 无窗口 PowerShell 进程，stdio 全 ignore（沙箱友好）。一次性播放：固定
 * 4 秒等待后自动退出（音效均短于 4 秒）。
 *
 * `muted` 静音开关（右键菜单切换）；`stop()` 停止当前播放（动作切换/
 * 静音时调用）。不做 deepseek 语音/对话接入（后续阶段）；苹果用户参照本
 * 架构自行替换实现（如 NSSound / AVAudioPlayer）。
 */

import { spawn, type ChildProcess } from 'node:child_process'

export interface AudioPlayerOptions {
  /** 进程平台；非 win32 一律 no-op（苹果用户参照架构改）。 */
  platform?: NodeJS.Platform
  /** spawn 实现（注入测试）。 */
  spawnImpl?: (command: string, args: string[], opts: object) => ChildProcess
}

const WIN_SCRIPT = (path: string): string => {
  // 简单可靠：UWP MediaPlayer 播放 + 固定 4 秒等待（音效短，够播完）。
  // 不要 IsLoopingEnabled / NaturalDuration——这两个 UWP 属性在 PowerShell
  // 里访问可能静默失败（SilentlyContinue），导致整个脚本没到 Play 或异常。
  const fileUri = path.replace(/\\/g, '/')
  return [
    '$ErrorActionPreference="SilentlyContinue"',
    '[Windows.Media.Playback.MediaPlayer, Windows.Media, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType = WindowsRuntime] | Out-Null',
    '$m = [Windows.Media.Playback.MediaPlayer]::new()',
    `$src = [Windows.Media.Core.MediaSource]::CreateFromUri([System.Uri]::new("file:///${fileUri}"))`,
    '$m.Source = $src',
    '$m.Play()',
    'Start-Sleep -Seconds 4',
    '$m.Dispose()',
  ].join('; ')
}

export class AudioPlayer {
  private readonly platform: NodeJS.Platform
  private readonly spawnImpl: (command: string, args: string[], opts: object) => ChildProcess
  private muted = false
  /** 当前播放进程（一次性或循环统一跟踪，play 前 kill 旧进程防叠加）。 */
  private proc: ChildProcess | undefined

  constructor(options: AudioPlayerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.spawnImpl = options.spawnImpl ?? spawn
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** 静音开关；静音时立即停止当前播放。 */
  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.stop()
  }

  /** 停止当前播放（若有）。 */
  stop(): void {
    if (this.proc !== undefined) {
      try { this.proc.kill() } catch { /* 已退出 */ }
      this.proc = undefined
    }
  }

  /**
   * 播放一个音频文件（一次性，固定 4 秒后自动退出）。
   * @param path - 音频绝对路径
   */
  play(path: string): void {
    if (this.muted || this.platform !== 'win32' || path.length === 0) return
    // 切换音效：先停旧进程，避免叠加爆音。
    this.stop()
    try {
      const ps = this.spawnImpl(
        'powershell',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', WIN_SCRIPT(path)],
        { stdio: 'ignore', windowsHide: true },
      )
      this.proc = ps
      ps.once('exit', () => { if (this.proc === ps) this.proc = undefined })
      ps.once('error', () => { if (this.proc === ps) this.proc = undefined })
    } catch {
      this.proc = undefined
    }
  }
}
