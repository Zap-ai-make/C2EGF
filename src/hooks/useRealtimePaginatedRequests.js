import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mergeUniqueRequests } from '../utils/mergeRequests'

/**
 * Combine une première page temps réel avec des pages supplémentaires à curseur.
 * Les compteurs de génération empêchent une réponse ancienne de modifier le
 * nouvel écran après un filtre, un rafraîchissement ou un démontage.
 */
export function useRealtimePaginatedRequests({
  subscribeRequests,
  listRequests,
  subscriptionArgs,
  paginationArgs = subscriptionArgs,
}) {
  const [realtimeRequests, setRealtimeRequests] = useState([])
  const [extraRequests, setExtraRequests] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const realtimeLastDocRef = useRef(null)
  const paginationLastDocRef = useRef(null)
  const hasLoadedExtraPagesRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const loadMoreOperationRef = useRef(0)

  useEffect(() => {
    requestGenerationRef.current += 1
    setLoadingMore(false)
    setRealtimeRequests([])
    setExtraRequests([])
    setHasMore(false)
    setLoading(true)
    setHasLoaded(false)
    setError(null)
    realtimeLastDocRef.current = null
    paginationLastDocRef.current = null
    hasLoadedExtraPagesRef.current = false

    let unsubscribe
    try {
      unsubscribe = subscribeRequests({
        ...subscriptionArgs,
        onUpdate: ({ requests, lastDoc, hasMore: more }) => {
          setRealtimeRequests(requests)
          realtimeLastDocRef.current = lastDoc
          if (!hasLoadedExtraPagesRef.current) setHasMore(more)
          setLoading(false)
          setHasLoaded(true)
        },
        onError: (err) => {
          setError(err.message)
          setLoading(false)
          setHasLoaded(true)
        },
      })
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setHasLoaded(true)
    }

    return () => {
      requestGenerationRef.current += 1
      loadMoreOperationRef.current += 1
      unsubscribe?.()
    }
  }, [refreshKey, subscribeRequests, subscriptionArgs])

  const loadMore = useCallback(async () => {
    if (hasLoadedExtraPagesRef.current && paginationLastDocRef.current === null) return
    const cursorDoc = hasLoadedExtraPagesRef.current
      ? paginationLastDocRef.current
      : realtimeLastDocRef.current
    if (!cursorDoc || loadingMore) return

    const generationAtStart = requestGenerationRef.current
    const operationId = ++loadMoreOperationRef.current

    setLoadingMore(true)
    try {
      const result = await listRequests({ ...paginationArgs, lastDoc: cursorDoc })
      if (generationAtStart !== requestGenerationRef.current) return
      setExtraRequests((previous) => [...previous, ...result.requests])
      hasLoadedExtraPagesRef.current = true
      paginationLastDocRef.current = result.lastDoc
      setHasMore(result.hasMore)
    } catch (err) {
      if (generationAtStart !== requestGenerationRef.current) return
      setError(err.message)
    } finally {
      if (
        generationAtStart === requestGenerationRef.current &&
        operationId === loadMoreOperationRef.current
      ) {
        setLoadingMore(false)
      }
    }
  }, [listRequests, loadingMore, paginationArgs])

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])
  const requests = useMemo(
    () => mergeUniqueRequests(realtimeRequests, extraRequests),
    [realtimeRequests, extraRequests],
  )

  return { requests, hasMore, loading, loadingMore, error, hasLoaded, loadMore, refresh }
}
