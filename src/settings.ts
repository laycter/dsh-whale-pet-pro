/**
 * Optional host settings integration.
 *
 * Registers the user-editable `desktop-pet` namespace against the Harness
 * settings service when one exists, and applies the resolved section (schema
 * defaults → composition base → user layer) to the pet through an `onApply`
 * callback. When no settings service is present, it applies the composition
 * entry once and returns a no-op disposer, so the pet still works without the
 * optional settings seam.
 *
 * The namespace name and field schema are spelled here rather than importing
 * `@deepseek-ai/dsh-settings`, so this independent plugin carries no runtime
 * dependency on a Harness workspace package: a settings namespace is an
 * ordinary lowercase-kebab string on the wire.
 */

import { DESKTOP_PET_SETTINGS_NS, PetSettingsSchema, type PetSettings } from './config'

/** The resolved, user-editable settings surface the pet reacts to. */
export type PetSettingsSnapshot = PetSettings

/** The narrow settings-owner scope shape this plugin consumes. */
export interface PetSettingsScope {
  get(): PetSettingsSnapshot
  watch(callback: (next: PetSettingsSnapshot, prev: PetSettingsSnapshot) => void | Promise<void>): () => void
  /** Merge a partial patch into the user layer (settings-seam `update`). */
  update(patch: Partial<PetSettingsSnapshot>): Promise<void> | void
}

/** The narrow settings-provider shape this plugin consumes. */
export interface PetSettingsRegistrar {
  register(
    namespace: string,
    schema: unknown,
    options?: { base?: PetSettingsSnapshot; applies?: 'live' | 'restart' },
  ): PetSettingsScope
}

/** The handle returned by {@link installPetSettings}. */
export interface PetSettingsHandle {
  /** Stop reacting to settings changes (namespace ownership follows the provider). */
  dispose(): void
  /** Merge a partial patch into the user layer, or a no-op without a settings service. */
  update(patch: Partial<PetSettingsSnapshot>): Promise<void> | void
}

/**
 * Install the settings wiring.
 *
 * @param registrar - the settings service (already resolved), or undefined.
 * @param base - the composition entry config, used as the namespace base layer.
 * @param onApply - invoked with each resolved settings snapshot.
 * @returns a handle to dispose the wiring and to write patches back.
 */
export function installPetSettings(
  registrar: PetSettingsRegistrar | undefined,
  base: PetSettingsSnapshot,
  onApply: (settings: PetSettingsSnapshot) => void,
): PetSettingsHandle {
  if (!registrar) {
    onApply(base)
    return { dispose: () => {}, update: () => {} }
  }
  const scope = registrar.register(DESKTOP_PET_SETTINGS_NS, PetSettingsSchema, { base })
  // 按需召唤（鸭鸭钦点「不要开机就启动」）：settings 的 user 层会把上次会话
  // 的 enabled 持久化下来；若残留 true，启动时立即重置回 composition 默认
  // （base.enabled），并先按重置值应用一次——跨会话绝不自动启动桌宠。
  // 重置是异步的：onApply 先收到「不信任残留 user 值」的快照，随后 watch
  // 带着真实重置值再次回调（幂等）。
  const initial = scope.get()
  if (initial.enabled !== base.enabled) {
    // update 可能是同步 void 或 promise；统一按 promise 处理容错。
    Promise.resolve(scope.update({ enabled: base.enabled })).catch(() => {})
    onApply({ ...initial, enabled: base.enabled })
  } else {
    onApply(initial)
  }
  // The registrar's watch passes (next, prev); onApply only cares about the
  // resolved next value, so narrow it to keep the callback signature stable.
  const dispose = scope.watch((next) => onApply(next))
  return {
    dispose,
    update: (patch) => scope.update(patch),
  }
}
