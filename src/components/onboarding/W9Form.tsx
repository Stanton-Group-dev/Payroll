'use client'

import { FormField, FormInput, FormSelect, InfoBlock } from '@/components/form'
import type { OnboardingFormData } from '@/hooks/payroll/useOnboardingForm'

interface W9FormProps {
  language: 'en' | 'es'
  data: OnboardingFormData
  onChange: <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => void
  errors: Partial<Record<keyof OnboardingFormData, string>>
}

const t = {
  en: {
    title: 'Contractor Tax Information (W-9)',
    subtitle: 'This information is used to prepare your 1099-NEC at year end.',
    businessLabel: 'Business name (if different from your name)',
    businessHelper: 'Leave blank if you operate as an individual or sole proprietor under your own name.',
    classLabel: 'Federal tax classification',
    individual: 'Individual / Sole proprietor',
    c_corp: 'C Corporation',
    s_corp: 'S Corporation',
    partnership: 'Partnership',
    trust_estate: 'Trust / Estate',
    llc: 'Limited Liability Company (LLC)',
    other: 'Other',
    llcClassLabel: 'LLC tax classification',
    llcC: 'C — Taxed as C Corporation',
    llcS: 'S — Taxed as S Corporation',
    llcP: 'P — Taxed as Partnership',
    llcD: 'D — Disregarded entity (single-member LLC)',
    tinNote: 'Your Tax ID (SSN, ITIN, or EIN) was entered in Step 1.',
    infoTitle: 'About this form',
    info: 'As a contractor, you are responsible for paying your own self-employment taxes. Your employer will issue a 1099-NEC if you earn $600 or more in the year.',
  },
  es: {
    title: 'Información fiscal del contratista (W-9)',
    subtitle: 'Esta información se usa para preparar su 1099-NEC al final del año.',
    businessLabel: 'Nombre del negocio (si es diferente a su nombre)',
    businessHelper: 'Déjelo en blanco si opera como individuo o propietario único bajo su propio nombre.',
    classLabel: 'Clasificación fiscal federal',
    individual: 'Individuo / Propietario único',
    c_corp: 'Corporación C',
    s_corp: 'Corporación S',
    partnership: 'Sociedad',
    trust_estate: 'Fideicomiso / Patrimonio',
    llc: 'Compañía de Responsabilidad Limitada (LLC)',
    other: 'Otro',
    llcClassLabel: 'Clasificación fiscal de LLC',
    llcC: 'C — Gravado como Corporación C',
    llcS: 'S — Gravado como Corporación S',
    llcP: 'P — Gravado como Sociedad',
    llcD: 'D — Entidad ignorada (LLC de un solo miembro)',
    tinNote: 'Su número de identificación fiscal (SSN, ITIN o EIN) fue ingresado en el Paso 1.',
    infoTitle: 'Sobre este formulario',
    info: 'Como contratista, usted es responsable de pagar sus propios impuestos de trabajo por cuenta propia. Su empleador emitirá un 1099-NEC si gana $600 o más en el año.',
  },
}

export function W9Form({ language, data, onChange, errors }: W9FormProps) {
  const text = t[language]

  return (
    <div>
      <InfoBlock variant="default" title={text.infoTitle}>
        {text.info}
      </InfoBlock>

      <FormField label={text.businessLabel} helperText={text.businessHelper}>
        <FormInput
          value={data.w9_business_name}
          onChange={e => onChange('w9_business_name', e.target.value)}
          placeholder={language === 'es' ? 'Nombre del negocio (opcional)' : 'Business name (optional)'}
        />
      </FormField>

      <FormField label={text.classLabel} required error={errors.w9_tax_classification}>
        <FormSelect
          value={data.w9_tax_classification}
          onChange={e => onChange('w9_tax_classification', e.target.value)}
          error={!!errors.w9_tax_classification}
        >
          <option value="individual">{text.individual}</option>
          <option value="sole_proprietor">{text.individual}</option>
          <option value="c_corp">{text.c_corp}</option>
          <option value="s_corp">{text.s_corp}</option>
          <option value="partnership">{text.partnership}</option>
          <option value="trust_estate">{text.trust_estate}</option>
          <option value="llc">{text.llc}</option>
          <option value="other">{text.other}</option>
        </FormSelect>
      </FormField>

      {data.w9_tax_classification === 'llc' && (
        <FormField label={text.llcClassLabel} required error={errors.w9_llc_tax_classification}>
          <FormSelect
            value={data.w9_llc_tax_classification}
            onChange={e => onChange('w9_llc_tax_classification', e.target.value)}
            error={!!errors.w9_llc_tax_classification}
          >
            <option value="">— {language === 'es' ? 'Seleccionar' : 'Select'} —</option>
            <option value="C">{text.llcC}</option>
            <option value="S">{text.llcS}</option>
            <option value="P">{text.llcP}</option>
            <option value="D">{text.llcD}</option>
          </FormSelect>
        </FormField>
      )}

      <div className="mt-4 p-3 bg-[var(--bg-section)] border border-[var(--divider)] text-xs text-[var(--muted)]">
        {text.tinNote}
      </div>
    </div>
  )
}
