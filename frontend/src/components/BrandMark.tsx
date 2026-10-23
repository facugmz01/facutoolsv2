type BrandMarkProps = {
  size?: 'sm' | 'lg'
  className?: string
}

export default function BrandMark({ size = 'sm', className = '' }: BrandMarkProps) {
  const facu = size === 'lg' ? 'text-4xl' : 'text-xl'
  const tools = size === 'lg' ? 'text-3xl' : 'text-lg'

  return (
    <span
      className={`inline-flex items-baseline font-brand tracking-tight select-none ${className}`}
      aria-label="FacuTools"
    >
      <span className={`${facu} font-semibold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400`}>
        Facu
      </span>
      <span className={`${tools} font-normal lowercase text-foreground-secondary ml-0.5`}>
        tools
      </span>
    </span>
  )
}
