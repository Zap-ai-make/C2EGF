import { memo } from 'react'

const LoadingSkeleton = memo(function LoadingSkeleton({
  width = 'w-full',
  height = 'h-4',
  className = '',
  rows = 1,
  variant = 'default'
}) {
  const baseClasses = 'bg-gray-200 rounded animate-pulse'

  const variants = {
    default: 'bg-gray-200',
    card: 'bg-gray-100 border border-gray-200',
    text: 'bg-gray-300',
    button: 'bg-gray-300 rounded-md',
    circle: 'rounded-full bg-gray-200'
  }

  if (rows > 1) {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className={`${baseClasses} ${variants[variant]} ${width} ${height}`}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className={`${baseClasses} ${variants[variant]} ${width} ${height} ${className}`}
    />
  )
})

// Squelettes spécialisés pour les composants spécifiques

export const TransactionRowSkeleton = memo(function TransactionRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="border border-green-300 px-4 py-3">
        <LoadingSkeleton width="w-16" height="h-4" variant="text" />
      </td>
      <td className="border border-green-300 px-4 py-3">
        <LoadingSkeleton width="w-24" height="h-4" variant="text" />
      </td>
      <td className="border border-green-300 px-4 py-3">
        <LoadingSkeleton width="w-16" height="h-4" variant="text" />
      </td>
      <td className="border border-green-300 px-4 py-3">
        <LoadingSkeleton width="w-20" height="h-4" variant="text" />
      </td>
      <td className="border border-green-300 px-4 py-3">
        <LoadingSkeleton width="w-20" height="h-4" variant="text" />
      </td>
      <td className="border border-green-300 px-4 py-3">
        <div className="flex gap-2 justify-center">
          <LoadingSkeleton width="w-16" height="h-6" variant="button" />
          <LoadingSkeleton width="w-16" height="h-6" variant="button" />
        </div>
      </td>
    </tr>
  )
})

export const NetworkCardSkeleton = memo(function NetworkCardSkeleton() {
  return (
    <div className="bg-white border rounded-lg shadow-sm p-3 flex-1 min-w-[140px] max-w-[180px] animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <LoadingSkeleton width="w-2" height="h-2" variant="circle" />
          <LoadingSkeleton width="w-16" height="h-3" variant="text" />
        </div>
      </div>
      <div className="text-center">
        <LoadingSkeleton width="w-20" height="h-6" variant="text" className="mb-1 mx-auto" />
        <LoadingSkeleton width="w-12" height="h-3" variant="text" className="mx-auto" />
      </div>
    </div>
  )
})

export const FormSkeleton = memo(function FormSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
      <div className="space-y-6">
        {/* Client search */}
        <div>
          <LoadingSkeleton width="w-24" height="h-5" variant="text" className="mb-2" />
          <LoadingSkeleton width="w-full" height="h-10" variant="default" />
        </div>

        {/* Amount */}
        <div>
          <LoadingSkeleton width="w-32" height="h-5" variant="text" className="mb-2" />
          <LoadingSkeleton width="w-full" height="h-10" variant="default" />
        </div>

        {/* Network */}
        <div>
          <LoadingSkeleton width="w-20" height="h-5" variant="text" className="mb-2" />
          <LoadingSkeleton width="w-full" height="h-10" variant="default" />
        </div>

        {/* Transaction type */}
        <div>
          <LoadingSkeleton width="w-36" height="h-5" variant="text" className="mb-2" />
          <div className="flex gap-4">
            <LoadingSkeleton width="w-24" height="h-10" variant="button" />
            <LoadingSkeleton width="w-24" height="h-10" variant="button" />
            <LoadingSkeleton width="w-24" height="h-10" variant="button" />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4 pt-4">
          <LoadingSkeleton width="w-32" height="h-10" variant="button" />
          <LoadingSkeleton width="w-24" height="h-10" variant="button" />
        </div>
      </div>
    </div>
  )
})

export default LoadingSkeleton