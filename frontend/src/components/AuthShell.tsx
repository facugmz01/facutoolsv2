import BrandMark from './BrandMark'
import ThemeToggle from './ThemeToggle'

/** Auth shell with subtle network-map lines (Network Teal). */
export default function AuthShell({
  children,
  tagline,
}: {
  children: React.ReactNode
  tagline?: string
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-canvas px-4 overflow-hidden">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle compact />
      </div>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35] dark:opacity-[0.22]"
        viewBox="0 0 1000 700"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <pattern id="net-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#0d9488" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="1000" height="700" fill="url(#net-grid)" opacity="0.35" />
        <g stroke="#14b8a6" strokeWidth="1.25" fill="none">
          <path d="M40 140 L220 250 L400 120 L580 300 L780 190 L960 380" />
          <path d="M80 520 L250 400 L450 490 L650 330 L880 430" />
          <path d="M180 70 L300 340 L520 360 L700 560" />
        </g>
        <g fill="#0d9488">
          <circle cx="220" cy="250" r="5" />
          <circle cx="400" cy="120" r="4" />
          <circle cx="580" cy="300" r="6" />
          <circle cx="780" cy="190" r="4" />
          <circle cx="250" cy="400" r="4" />
          <circle cx="650" cy="330" r="5" />
          <circle cx="300" cy="340" r="3.5" />
          <circle cx="520" cy="360" r="4.5" />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(13,148,136,0.12),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(13,148,136,0.18),_transparent_55%)]" />

      <div className="relative w-full max-w-md z-10">
        <div className="mb-8 text-center">
          <BrandMark size="lg" />
          {tagline && (
            <p className="text-sm text-muted-foreground mt-3 tracking-wide">{tagline}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
