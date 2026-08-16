/**
 * 桌宠市场数据模型 + 拉取。
 *
 * 前端从桌宠包仓库拉取 `index.json`（桌宠清单），客户端分页 + 虚拟列表展示。
 * 当前用 mock 数据（先做 UI）；仓库建好后把 {@link PET_MARKET_INDEX_URL} 指到
 * 真实 raw URL，`fetchPetMarket` 自动生效。
 */

import { BORING_IDLE_GIF } from './boring-idle-gif'

export interface PetMarketItem {
  /** 目录名 / 桌宠 id（解压后放进 assets/pets/<id>/）。 */
  id: string
  name: string
  description: string
  /** 预览图 URL（仓库内 preview.gif/preview.png，GIF 自动演示动画）。 */
  preview?: string
  /** 下载链接（zip 直链或 GitHub 页面）。 */
  download: string
  author?: string
  license?: string
}

export interface PetMarketIndex {
  pets: PetMarketItem[]
}

/** 桌宠包仓库 index.json 的 raw URL（已接真实仓库）。 */
export const PET_MARKET_INDEX_URL = 'https://raw.githubusercontent.com/laycter/whale-pet-assets/main/index.json'

/**
 * 拉取桌宠清单；URL 未配置时返回 mock 数据（UI 开发阶段）。
 *
 * 更新机制（鸭鸭钦点）：社区桌宠源源不断，index.json 会持续更新——每次
 * 打开市场都强制拉最新（`cache: 'no-store'` + 时间戳绕过 GitHub raw 的
 * 5 分钟缓存），不做长缓存。清单全量拉取（桌宠元数据很小，几百个也就
 * 几十 KB），客户端分页 + 虚拟列表展示，数量再多也不卡。
 */
export async function fetchPetMarket(): Promise<PetMarketIndex> {
  if (PET_MARKET_INDEX_URL.length === 0) return { pets: MOCK_PETS }
  const url = `${PET_MARKET_INDEX_URL}?t=${Date.now()}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`pet market fetch failed: ${res.status}`)
  return res.json() as Promise<PetMarketIndex>
}

// --- mock 数据（UI 开发用，仓库建好后删除或替换） ---

const mk = (id: string, name: string, description: string, author = '社区', license = 'MIT', preview?: string): PetMarketItem => ({
  id,
  name,
  description,
  preview,
  download: `https://github.com/whale-pet-assets/${id}/archive/refs/heads/main.zip`,
  author,
  license,
})

export const MOCK_PETS: PetMarketItem[] = [
  mk('boring-pet', 'Boring Pet', 'DeskPet 作者的经典桌宠：16 动作 + 音效，待机/走路/睡觉/出场全齐', '2048Nemo', 'GPL-3.0', BORING_IDLE_GIF),
  mk('whale-ui-pet', '鲸鱼娘·界面版', '23 动作 1007 帧，干活会游泳的小鲸鱼娘', '鸭鸭', 'MIT', BORING_IDLE_GIF),
  mk('fat-fish-maid', '大肥鱼女仆', '蓝色大肥鱼，可爱粘人', '鸭鸭', 'MIT'),
  ...Array.from({ length: 27 }, (_, i) => mk(
    `pet-demo-${i + 1}`,
    `示例桌宠 ${i + 1}`,
    `用于测试无限滚动与虚拟列表的占位桌宠 #${i + 1}`,
    `作者${i + 1}`,
  )),
]
