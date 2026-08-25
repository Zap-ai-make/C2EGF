import { useState, useCallback } from 'react'

export const useToast = () => {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newToast = { id, message, type, duration }
    
    setToasts(prev => [...prev, newToast])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  return {
    toasts,
    showToast,
    removeToast
  }
}