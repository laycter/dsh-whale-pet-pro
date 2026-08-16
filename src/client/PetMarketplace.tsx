/**
 * 桌宠市场（「更多宠物获取」）——虚拟列表 + 无限滚动 + 详情面板。
 *
 * 宝子钦点交互：设置页点「更多宠物获取」→ 当前页面展开列表，拉取 GitHub
 * 桌宠清单；向下滚动到底自动加载更多（防页面过溢）；滚出视口的顶部项被
 * 回收（虚拟列表，DOM 不爆）。点某一项 → 下方详情面板（预览图 + 说明 +
 * 下载按钮）。
 *
 * 虚拟列表：固定行高 + 滚动时只渲染「可见范围 ± overscan」，其余用总高度
 * 撑滚动条——列表再长，DOM 里永远只有几十个节点。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPetMarket, type PetMarketItem } from './pet-market'
import { PET_BADGE_DATA_URL } from './pet-badge'
import css from './PetMarketplace.module.css'

const ITEM_HEIGHT = 52
const VIEWPORT_HEIGHT = 300
const OVERSCAN = 4
const PAGE_SIZE = 20

export function PetMarketplace() {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState<PetMarketItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<PetMarketItem | null>(null)
  const [zoomed, setZoomed] = useState<PetMarketItem | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 首次展开时拉取清单（mock 或真实 index.json）。
  useEffect(() => {
    if (!open || all.length > 0) return
    let alive = true
    setLoading(true)
    fetchPetMarket()
      .then((index) => { if (alive) setAll(index.pets) })
      .catch((e) => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, all.length])

  // 已加载数量（分页）
  const loadedCount = Math.min(page * PAGE_SIZE, all.length)
  const items = all.slice(0, loadedCount)

  // 虚拟列表可见范围
  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
  const end = Math.min(items.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ITEM_HEIGHT) + OVERSCAN)
  const visible = items.slice(start, end)

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    // 无限滚动：接近底部加载下一页
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setPage(p => (p * PAGE_SIZE < all.length ? p + 1 : p))
    }
  }, [all.length])

  if (!open) {
    return (
      <button type="button" className={css.openBtn} onClick={() => { setOpen(true) }}>
        + 更多宠物获取
      </button>
    )
  }

  return (
    <div className={css.panel}>
      <div className={css.head}>
        <span className={css.title}>更多宠物</span>
        <button type="button" className={css.closeBtn} onClick={() => { setOpen(false); setSelected(null) }} aria-label="收起">
          ×
        </button>
      </div>

      {loading ? <p className={css.hint}>加载中…</p> : null}
      {error ? <p className={css.error}>{error}</p> : null}

      <div
        ref={containerRef}
        className={css.list}
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={onScroll}
      >
        {/* 总高度撑滚动条 */}
        <div style={{ height: items.length * ITEM_HEIGHT, position: 'relative' }}>
          {visible.map((item, i) => {
            const idx = start + i
            return (
              <button
                type="button"
                key={item.id}
                className={css.row}
                style={{ top: idx * ITEM_HEIGHT }}
                onClick={() => { setSelected(item) }}
              >
                <img
                  className={css.thumb}
                  src={item.preview ?? PET_BADGE_DATA_URL}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onClick={(e) => { e.stopPropagation(); setZoomed(item) }}
                />
                <span className={css.rowName}>{item.name}</span>
                <span className={css.rowAuthor}>{item.author ?? ''}</span>
              </button>
            )
          })}
        </div>
      </div>

      {selected ? (
        <div className={css.detail}>
          <div className={css.detailHead}>
            <img
              className={css.preview}
              src={selected.preview ?? PET_BADGE_DATA_URL}
              alt={selected.name}
              loading="lazy"
              onClick={() => { setZoomed(selected) }}
            />
            <div className={css.detailHeadText}>
              <span className={css.detailName}>{selected.name}</span>
              {selected.license ? <span className={css.badge}>{selected.license}</span> : null}
            </div>
          </div>
          <p className={css.detailDesc}>{selected.description}</p>
          <div className={css.detailFoot}>
            <span className={css.detailId}>目录名：{selected.id}</span>
            <a className={css.download} href={selected.download} target="_blank" rel="noreferrer">
              下载
            </a>
          </div>
        </div>
      ) : (
        <p className={css.hint}>点上面任意一个桌宠查看详情</p>
      )}

      {/* 点击预览图放大（lightbox） */}
      {zoomed ? (
        <div className={css.lightbox} onClick={() => { setZoomed(null) }}>
          <div className={css.lightboxInner} onClick={(e) => { e.stopPropagation() }}>
            <img
              className={css.lightboxImg}
              src={zoomed.preview ?? PET_BADGE_DATA_URL}
              alt={zoomed.name}
            />
            <div className={css.lightboxName}>{zoomed.name}</div>
            <button type="button" className={css.lightboxClose} onClick={() => { setZoomed(null) }} aria-label="关闭">
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
