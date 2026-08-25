import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Fenêtrage de lignes à hauteur fixe (virtualisation légère, sans dépendance).
 *
 * `computeWindow` est une fonction PURE : elle ne touche pas au DOM et reçoit les
 * mesures (scrollTop, viewportHeight, rowHeight) en arguments → 100 % testable sous
 * jsdom (qui ne calcule aucun layout). Le hook `useWindowedRows` se contente de
 * fournir ces mesures depuis un conteneur scrollable réel.
 */

// Indices visibles + hauteurs des lignes-espaceurs (haut/bas) pour un conteneur donné.
export function computeWindow({ itemCount, rowHeight, scrollTop, viewportHeight, overscan = 8 }) {
  if (itemCount === 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: itemCount, topPad: 0, bottomPad: 0 }
  }
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  // Clamp du haut : ne jamais dépasser le dernier créneau plein (scrollTop trop grand).
  const maxStart = Math.max(0, itemCount - visible)
  const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const end = Math.min(itemCount, start + visible)
  return {
    startIndex: start,
    endIndex: end,
    topPad: start * rowHeight,
    bottomPad: (itemCount - end) * rowHeight,
  }
}

/**
 * @param {object} opts
 * @param {number} opts.itemCount        Nombre total de lignes.
 * @param {number} opts.defaultRowHeight Hauteur de repli si la mesure n'est pas dispo (jsdom / avant paint).
 * @param {number} [opts.overscan]       Lignes rendues en marge de part et d'autre de la fenêtre.
 * @returns {{ containerRef, rowRef, onScroll, startIndex, endIndex, topPad, bottomPad }}
 */
export function useWindowedRows({ itemCount, defaultRowHeight, overscan = 8 }) {
  const containerRef = useRef(null)
  const rowRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [rowHeight, setRowHeight] = useState(defaultRowHeight)

  const onScroll = useCallback((event) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  // Mesure la hauteur réelle d'une ligne + la hauteur du conteneur (et suit ses variations).
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measured = rowRef.current?.getBoundingClientRect().height
    if (measured && measured > 0) setRowHeight(measured)

    const applyViewport = () => setViewportHeight(container.clientHeight)
    applyViewport()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(applyViewport)
    observer.observe(container)
    return () => observer.disconnect()
  }, [itemCount])

  const win = computeWindow({
    itemCount,
    rowHeight: rowHeight > 0 ? rowHeight : defaultRowHeight,
    scrollTop,
    viewportHeight: viewportHeight > 0 ? viewportHeight : defaultRowHeight * overscan * 2,
    overscan,
  })

  return { containerRef, rowRef, onScroll, ...win }
}
