'use client'

interface LanguageToggleProps {
  language: 'en' | 'es'
  onChange: (lang: 'en' | 'es') => void
}

export function LanguageToggle({ language, onChange }: LanguageToggleProps) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        onClick={() => onChange('en')}
        className={`px-3 py-1 border transition-colors duration-150 ${
          language === 'en'
            ? 'bg-[var(--primary)] text-white border-[var(--primary)] font-medium'
            : 'bg-transparent text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
        }`}
      >
        English
      </button>
      <button
        onClick={() => onChange('es')}
        className={`px-3 py-1 border transition-colors duration-150 ${
          language === 'es'
            ? 'bg-[var(--primary)] text-white border-[var(--primary)] font-medium'
            : 'bg-transparent text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
        }`}
      >
        Español
      </button>
    </div>
  )
}
