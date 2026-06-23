'use client'

import { FormField, FormInput } from '@/components/form'

interface TypedSignatureProps {
  language: 'en' | 'es'
  value: string
  agreed: boolean
  onNameChange: (v: string) => void
  onAgreedChange: (v: boolean) => void
  error?: string
}

const t = {
  en: {
    label: 'Type your full legal name to sign',
    placeholder: 'Your full name',
    certify: 'I certify that all information provided is accurate and complete to the best of my knowledge.',
    agree: 'I understand this typed name constitutes my legal electronic signature.',
    legal: 'This signature is legally binding under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN).',
    dateLine: 'Date:',
  },
  es: {
    label: 'Escriba su nombre legal completo para firmar',
    placeholder: 'Su nombre completo',
    certify: 'Certifico que toda la información proporcionada es precisa y completa según mi mejor conocimiento.',
    agree: 'Entiendo que este nombre escrito constituye mi firma electrónica legal.',
    legal: 'Esta firma es legalmente vinculante bajo la Ley de Firmas Electrónicas en el Comercio Global y Nacional (ESIGN).',
    dateLine: 'Fecha:',
  },
}

export function TypedSignature({ language, value, agreed, onNameChange, onAgreedChange, error }: TypedSignatureProps) {
  const text = t[language]
  const today = new Date().toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="border border-[var(--border)] bg-[var(--bg-section)] p-5">
      <div className="border-l-4 border-[var(--accent)] pl-4 mb-5">
        <p className="text-sm text-[var(--ink)] leading-relaxed">{text.certify}</p>
      </div>

      <FormField label={text.label} required error={error}>
        <FormInput
          value={value}
          onChange={e => onNameChange(e.target.value)}
          placeholder={text.placeholder}
          className="font-serif text-lg italic"
          error={!!error}
        />
      </FormField>

      {value && (
        <div className="mt-3 pt-3 border-t border-[var(--divider)] font-serif italic text-[var(--ink)]">
          <p className="text-lg">{value}</p>
          <p className="text-xs text-[var(--muted)] mt-1 not-italic">{text.dateLine} {today}</p>
        </div>
      )}

      <label className="flex items-start gap-3 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => onAgreedChange(e.target.checked)}
          className="mt-0.5 w-5 h-5 border border-[var(--border)] rounded-none
            checked:bg-[var(--primary)] checked:border-[var(--primary)]
            focus:ring-2 focus:ring-[var(--primary)]/20 shrink-0"
        />
        <span className="text-sm text-[var(--ink)] leading-relaxed">{text.agree}</span>
      </label>

      <p className="mt-3 text-xs text-[var(--muted)] italic">{text.legal}</p>
    </div>
  )
}
