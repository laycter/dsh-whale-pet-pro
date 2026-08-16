/**
 * 桌宠设置栏目（设置面板左侧导航的「桌宠」页，settings.section 槽）。
 *
 * 鸭鸭钦点（2026-08-16）：桌宠入口放设置面板左侧栏，像一个正式的设置
 * 栏目（预设/模型那样）。页面内容：召唤开关（直写）+ 宠物选择（直写）+
 * 大小/自动隐藏（staged 保存流程）。
 *
 * 兜底渲染：即使 settings 命名空间尚未 ready（describe 时序/连接问题），
 * 也渲染页面 + 提示文字，绝不静默消失——「入口必须在」。
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopPetCardFace } from './desktop-pet-controller'
import { PET_SCALE_MAX, PET_SCALE_MIN, PET_SCALE_STEP, quantizeScale } from './desktop-pet-controller'
import { PET_BADGE_DATA_URL } from './pet-badge'
import { PetMarketplace } from './PetMarketplace'
import css from './PetSettingsSection.module.css'

/** Props the settings section binds: runtime share + locale seat + card face. */
export type PetSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.desktopPet'>
  & InjectFace<DesktopPetCardFace>

/** 设置面板左侧栏的「桌宠」栏目页。 */
export function PetSettingsSection(props: PetSettingsSectionProps) {
  const { t } = props
  const state = props.useDesktopPet(s => s)
  const [saved, setSaved] = useState(false)

  // 命名空间未就绪（loading/unavailable）时兜底渲染：提示 + 禁用控件。
  const ready = state?.available === true
  const active = state?.enabled?.value === true
  const current = state?.availablePets?.find(pet => pet.id === state.petId.value)
  const petName = current?.displayName ?? state?.petId.value ?? ''

  const commitStaged = (): void => {
    try {
      props.save()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      // 写失败不致命
    }
  }

  return (
    <div className={css.page}>
      <div className={css.head}>
        <img
          className={css.badge}
          src={PET_BADGE_DATA_URL}
          alt=""
          aria-hidden="true"
        />
        <div>
          <div className={css.title}>{t('desktopPet.title')}</div>
          <div className={css.subtitle}>{petName}</div>
        </div>
      </div>

      {!ready ? <p className={css.notice} role="status">{t('section.notReady')}</p> : null}

      <div className={css.field}>
        <div className={css.labelRow}>
          <span className={css.label}>{t('section.summon')}</span>
          <span className={css.caption}>{t(active ? 'section.summoned' : 'section.dormant')}</span>
        </div>
        <button
          type="button"
          className={css.summon}
          aria-pressed={active}
          disabled={!ready}
          onClick={(event) => {
            try {
              // 记录召唤按钮的屏幕坐标，宠物在按钮处出现。
              const rect = event.currentTarget.getBoundingClientRect()
              const x = window.screenX + rect.left + rect.width / 2
              const y = window.screenY + rect.top + rect.height / 2
              props.summonAt(x, y)
            } catch { /* 下次点击重试 */ }
          }}
        >
          <img className={css.summonBadge} src={PET_BADGE_DATA_URL} alt="" aria-hidden="true" />
          {t(active ? 'section.hide' : 'section.call')}
        </button>
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="pet-settings-row-pet">{t('desktopPet.pet')}</label>
        <select
          id="pet-settings-row-pet"
          className={css.select}
          value={state?.petId.value ?? ''}
          disabled={!ready}
          onChange={(event) => {
            try { props.setPet(event.target.value) } catch { /* 同上 */ }
          }}
        >
          {(state?.availablePets ?? []).map(pet => (
            <option key={pet.id} value={pet.id}>{pet.displayName}</option>
          ))}
        </select>
        <p className={css.hint}>{t('desktopPet.petHint')}</p>
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="pet-settings-row-scale">{t('desktopPet.scale')}</label>
        <div className={css.sliderRow}>
          <input
            id="pet-settings-row-scale"
            type="range"
            min={PET_SCALE_MIN}
            max={PET_SCALE_MAX}
            step={PET_SCALE_STEP}
            disabled={!ready}
            value={state?.petScale.value ?? 1}
            onChange={(event) => {
              try { props.edit('petScale', quantizeScale(Number(event.target.value))) } catch { /* 同上 */ }
            }}
          />
          <span className={css.value}>{(state?.petScale.value ?? 1).toFixed(2)}×</span>
        </div>
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="pet-settings-row-hide">{t('desktopPet.hideWhenIdle')}</label>
        <input
          id="pet-settings-row-hide"
          type="checkbox"
          disabled={!ready}
          checked={state?.hideWhenIdle.value ?? false}
          onChange={(event) => {
            try { props.edit('hideWhenIdle', event.target.checked) } catch { /* 同上 */ }
          }}
        />
        <p className={css.hint}>{t('desktopPet.hideWhenIdleHint')}</p>
      </div>

      <div className={css.footer}>
        <button
          type="button"
          className={css.discard}
          disabled={!ready || !(state?.dirty ?? false)}
          onClick={() => { try { props.discard() } catch { /* 同上 */ } }}
        >
          {t('discard')}
        </button>
        <button
          type="button"
          className={css.save}
          disabled={!ready || !(state?.dirty ?? false)}
          onClick={commitStaged}
        >
          {saved ? '✓' : t('save')}
        </button>
      </div>

      {/* 桌宠市场：更多宠物获取（虚拟列表 + 无限滚动） */}
      <PetMarketplace />
    </div>
  )
}
