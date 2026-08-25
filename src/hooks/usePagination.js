import { useState, useMemo } from 'react'
import { PAGINATION } from '../constants'

export const usePagination = (items, initialPageSize = PAGINATION.DEFAULT_PAGE_SIZE) => {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    return items.slice(startIndex, endIndex)
  }, [items, currentPage, pageSize])

  const totalPages = Math.ceil(items.length / pageSize)

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1)
    }
  }

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
    }
  }

  const changePageSize = (newPageSize) => {
    setPageSize(newPageSize)
    setCurrentPage(1)
  }

  return {
    currentPage,
    pageSize,
    totalPages,
    paginatedData,
    totalItems: items.length,
    onPageChange: goToPage,
    goToNextPage,
    goToPrevPage,
    onPageSizeChange: changePageSize,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
    startIndex: (currentPage - 1) * pageSize + 1,
    endIndex: Math.min(currentPage * pageSize, items.length)
  }
}