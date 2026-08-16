/**
 * Desktop pet settings section + card, browser half.
 *
 * Binds the host-side `desktop-pet` settings namespace through the settings
 * scope and registers:
 * - one section into the settings panel's LEFT NAV (`settings.section`) —
 *   the「桌宠」entry with summon toggle + pet picker + size/auto-hide
 *   (鸭鸭钦点：入口在设置左侧栏，像一个正式栏目)；
 * - one card into the Plugins configuration tab (`settings.plugin.item`) —
 *   full controls (kept for discoverability).
 *
 * 安全红线：整个 apply 用 try/catch 包裹——client bundle 的 factory 抛错会
 * 导致「loaded without registering」→ 整个 GUI 打不开（历史教训）。任何
 * 注入失败都只能让栏目/卡片缺席，绝不能拖垮界面。
 * 诊断：apply 结果写在 <html data-whale-pet-pro="applied|error:...">，
 * F12 → Elements → html 标签可一眼确认 client 是否加载/是否抛错。
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge (`settings.plugin.item` /
// `settings.section`) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DesktopPetCard } from './DesktopPetCard'
import { DesktopPetCardController, DESKTOP_PET_NS, type DesktopPetSettings } from './desktop-pet-controller'
import { PetSettingsSection } from './PetSettingsSection'
import { en, zh, type DesktopPetKey } from './locales'

export type { DesktopPetCardProps } from './DesktopPetCard'
export type { AvailablePet, DesktopPetCardFace, DesktopPetCardState, DesktopPetSettings } from './desktop-pet-controller'
export type { PetSettingsSectionProps } from './PetSettingsSection'
export type { DesktopPetKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The desktop pet card's copy. */
    'settings.desktopPet': DesktopPetKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.desktopPet'

/** Services required by the Settings registration and Remote face. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the desktop pet settings section into the settings panel's left nav
 * and the full card into the Plugins tab. Everything is defensive.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  try {
    // 诊断标记：F12 → Elements → <html data-whale-pet-pro="applied">。
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.whalePetPro = 'applied'
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-pet: dictionaries')

    const scope = ctx.settingsScope.bind<DesktopPetSettings>({ namespace: DESKTOP_PET_NS })
    const controller = new DesktopPetCardController(scope)
    const t = ctx.locale.bind(NS)

    // 设置面板左侧导航的「桌宠」栏目（主入口）。
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'desktop-pet',
      order: 40,
      label: () => t('row.title'),
      locale: NS,
      inject: () => controller.inject(),
    }, PetSettingsSection))

    // 插件配置 tab 的完整卡片（保留）。
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'desktop-pet',
      order: 30,
      locale: NS,
      inject: () => controller.inject(),
    }, DesktopPetCard))
  } catch (error) {
    // 永不抛出：client factory 抛错 = GUI 打不开（历史教训）。
    // 栏目/卡片缺席可接受，界面必须活着。
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.whalePetPro = `error:${String(error)}`
    }
    if (typeof console !== 'undefined') {
      console.warn('[whale-pet-pro] client apply failed (pet UI disabled):', error)
    }
  }
}
