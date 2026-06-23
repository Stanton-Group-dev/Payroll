'use client'

import { useState } from 'react'
import { FormField, FormInput, FormSelect, InfoBlock } from '@/components/form'
import type { OnboardingFormData } from '@/hooks/payroll/useOnboardingForm'

interface W4FormProps {
  language: 'en' | 'es'
  data: OnboardingFormData
  onChange: <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => void
  errors: Partial<Record<keyof OnboardingFormData, string>>
}

const t = {
  en: {
    title: 'Federal Tax Withholding (W-4)',
    subtitle: 'This tells us how much federal tax to withhold from your paycheck.',
    filingLabel: 'Filing status',
    single: 'Single or Married Filing Separately',
    marriedJoint: 'Married Filing Jointly',
    marriedSep: 'Married Filing Separately',
    headOfHousehold: 'Head of Household',
    multipleJobsLabel: 'Do you have another job, or does your spouse also work?',
    multipleJobsHelper: 'Check this if you or your spouse work more than one job combined.',
    dependentsLabel: 'Dependents amount (optional)',
    dependentsHelper: 'If you have children or dependents you claim, enter the total dollar amount here. See IRS W-4 instructions for calculation.',
    otherIncomeLabel: 'Other income not from jobs (optional)',
    otherIncomeHelper: 'Rental income, interest, dividends, etc. (from W-4 Step 4a)',
    deductionsLabel: 'Deductions (optional)',
    deductionsHelper: 'If you plan to itemize deductions, enter that amount here. (W-4 Step 4b)',
    extraLabel: 'Extra withholding per paycheck (optional)',
    extraHelper: 'Extra federal tax to withhold each pay period.',
    exemptLabel: 'I am exempt from federal withholding',
    exemptHelper: 'Only check this if you had no federal tax liability last year AND expect none this year.',
    exemptWarningTitle: 'Are you sure?',
    exemptWarning: 'Claiming exempt means NO federal income tax will be withheld from your paychecks. If you owe taxes at year-end, you may face penalties.',
    infoTitle: 'About this form',
    info: 'Your employer is required by law to collect this information. It does not affect your eligibility for employment. See IRS.gov for more information.',
  },
  es: {
    title: 'Retención de impuestos federales (W-4)',
    subtitle: 'Esto nos dice cuánto impuesto federal retener de su cheque de pago.',
    filingLabel: 'Estado civil para efectos de la declaración',
    single: 'Soltero o casado declarando por separado',
    marriedJoint: 'Casado declarando en conjunto',
    marriedSep: 'Casado declarando por separado',
    headOfHousehold: 'Jefe de familia',
    multipleJobsLabel: '¿Tiene otro trabajo, o su cónyuge también trabaja?',
    multipleJobsHelper: 'Marque esto si usted o su cónyuge tienen más de un trabajo en total.',
    dependentsLabel: 'Monto de dependientes (opcional)',
    dependentsHelper: 'Si tiene hijos o dependientes que declara, ingrese el monto total en dólares aquí.',
    otherIncomeLabel: 'Otros ingresos no de empleos (opcional)',
    otherIncomeHelper: 'Ingresos por alquiler, intereses, dividendos, etc.',
    deductionsLabel: 'Deducciones (opcional)',
    deductionsHelper: 'Si planea detallar deducciones, ingrese ese monto aquí.',
    extraLabel: 'Retención adicional por período de pago (opcional)',
    extraHelper: 'Impuesto federal adicional a retener cada período de pago.',
    exemptLabel: 'Estoy exento de la retención federal',
    exemptHelper: 'Solo marque esto si no tuvo obligación de impuesto federal el año pasado Y no espera tener ninguna este año.',
    exemptWarningTitle: '¿Está seguro?',
    exemptWarning: 'Reclamar exención significa que NO se retendrá impuesto sobre la renta federal de sus cheques. Si debe impuestos al final del año, puede enfrentar multas.',
    infoTitle: 'Sobre este formulario',
    info: 'La ley requiere que su empleador recopile esta información. No afecta su elegibilidad para el empleo.',
  },
}

export function W4Form({ language, data, onChange, errors }: W4FormProps) {
  const [showExemptModal, setShowExemptModal] = useState(false)
  const text = t[language]

  const handleExemptToggle = (checked: boolean) => {
    if (checked) {
      setShowExemptModal(true)
    } else {
      onChange('w4_exempt', false)
    }
  }

  return (
    <div>
      <InfoBlock variant="default" title={text.infoTitle}>
        {text.info}
      </InfoBlock>

      <FormField label={text.filingLabel} required error={errors.w4_filing_status}>
        <FormSelect
          value={data.w4_filing_status}
          onChange={e => onChange('w4_filing_status', e.target.value)}
          error={!!errors.w4_filing_status}
        >
          <option value="single">{text.single}</option>
          <option value="married_joint">{text.marriedJoint}</option>
          <option value="married_separate">{text.marriedSep}</option>
          <option value="head_of_household">{text.headOfHousehold}</option>
        </FormSelect>
      </FormField>

      <label className="flex items-start gap-3 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={data.w4_multiple_jobs}
          onChange={e => onChange('w4_multiple_jobs', e.target.checked)}
          className="mt-0.5 w-5 h-5 border border-[var(--border)] rounded-none shrink-0
            checked:bg-[var(--primary)] checked:border-[var(--primary)]"
        />
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">{text.multipleJobsLabel}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{text.multipleJobsHelper}</p>
        </div>
      </label>

      <FormField label={text.dependentsLabel} helperText={text.dependentsHelper}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">$</span>
          <FormInput
            type="number"
            min="0"
            step="0.01"
            value={data.w4_dependents_amount}
            onChange={e => onChange('w4_dependents_amount', e.target.value)}
            className="pl-7"
            placeholder="0.00"
          />
        </div>
      </FormField>

      <FormField label={text.otherIncomeLabel} helperText={text.otherIncomeHelper}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">$</span>
          <FormInput
            type="number"
            min="0"
            step="0.01"
            value={data.w4_other_income}
            onChange={e => onChange('w4_other_income', e.target.value)}
            className="pl-7"
            placeholder="0.00"
          />
        </div>
      </FormField>

      <FormField label={text.deductionsLabel} helperText={text.deductionsHelper}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">$</span>
          <FormInput
            type="number"
            min="0"
            step="0.01"
            value={data.w4_deductions}
            onChange={e => onChange('w4_deductions', e.target.value)}
            className="pl-7"
            placeholder="0.00"
          />
        </div>
      </FormField>

      <FormField label={text.extraLabel} helperText={text.extraHelper}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">$</span>
          <FormInput
            type="number"
            min="0"
            step="0.01"
            value={data.w4_extra_withholding}
            onChange={e => onChange('w4_extra_withholding', e.target.value)}
            className="pl-7"
            placeholder="0.00"
          />
        </div>
      </FormField>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={data.w4_exempt}
          onChange={e => handleExemptToggle(e.target.checked)}
          className="mt-0.5 w-5 h-5 border border-[var(--border)] rounded-none shrink-0
            checked:bg-[var(--warning)] checked:border-[var(--warning)]"
        />
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">{text.exemptLabel}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{text.exemptHelper}</p>
        </div>
      </label>

      {data.w4_exempt && (
        <InfoBlock variant="warning" title={language === 'es' ? '⚠ Exención reclamada' : '⚠ Exempt claimed'}>
          {text.exemptWarning}
        </InfoBlock>
      )}

      {/* Exempt confirmation modal */}
      {showExemptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white max-w-sm w-full p-6 shadow-xl">
            <h3 className="font-serif text-lg text-[var(--primary)] mb-3">{text.exemptWarningTitle}</h3>
            <p className="text-sm text-[var(--ink)] mb-5">{text.exemptWarning}</p>
            <div className="flex gap-3">
              <button
                onClick={() => { onChange('w4_exempt', true); setShowExemptModal(false) }}
                className="flex-1 px-4 py-2 bg-[var(--warning)] text-white text-sm font-medium border-2 border-[var(--warning)]"
              >
                {language === 'es' ? 'Sí, soy exento' : 'Yes, I am exempt'}
              </button>
              <button
                onClick={() => setShowExemptModal(false)}
                className="flex-1 px-4 py-2 bg-transparent text-[var(--primary)] text-sm font-medium border-2 border-[var(--primary)]"
              >
                {language === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
