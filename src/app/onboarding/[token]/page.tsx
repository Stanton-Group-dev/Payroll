'use client'

import { use, useCallback, useState } from 'react'
import { FormButton, FormField, FormInput, FormSelect, InfoBlock } from '@/components/form'
import { LanguageToggle } from '@/components/onboarding/LanguageToggle'
import { DocumentUploadField } from '@/components/onboarding/DocumentUploadField'
import { TypedSignature } from '@/components/onboarding/TypedSignature'
import { W4Form } from '@/components/onboarding/W4Form'
import { W9Form } from '@/components/onboarding/W9Form'
import { useOnboardingForm } from '@/hooks/payroll/useOnboardingForm'
import type { OnboardingFormData } from '@/hooks/payroll/useOnboardingForm'
import { CheckCircle, Save } from 'lucide-react'

// ─── Translations ─────────────────────────────────────────────────────────────
const t = {
  en: {
    loading: 'Loading your onboarding form…',
    invalid: 'Invalid or expired link',
    invalidSub: 'This onboarding link is not valid. Please contact your employer for a new link.',
    expired: 'This link has expired',
    expiredSub: 'Onboarding links expire after 7 days. Please contact your employer to request a new link.',
    completed: 'Already submitted',
    completedSub: 'Your onboarding form has already been submitted. Your employer will be in touch.',
    behalfToggle: 'I am filling this out on behalf of someone else',
    helperNameLabel: 'Your name (helper)',
    helperRoleLabel: 'Your role / relationship',
    helperNamePlaceholder: 'e.g. Supervisor, Family member',
    step1: 'About You',
    step2: 'Tax Form',
    step3: 'Documents & Banking',
    step4: 'Review & Sign',
    next: 'Continue',
    back: 'Back',
    submit: 'Submit Onboarding',
    submitting: 'Submitting…',
    saved: 'Progress saved',
    saving: 'Saving…',
    // Step 1
    fullNameLabel: 'Full legal name',
    fullNamePlaceholder: 'As it appears on your ID',
    emailLabel: 'Email address',
    phoneLabel: 'Phone number',
    phonePlaceholder: '(555) 000-0000',
    dobLabel: 'Date of birth',
    address1Label: 'Street address',
    address2Label: 'Apt, unit, suite (optional)',
    cityLabel: 'City',
    stateLabel: 'State',
    zipLabel: 'ZIP code',
    taxIdTypeLabel: 'Tax ID type',
    taxIdNumberLabel: 'Tax ID number',
    ssnHelper: 'Format: XXX-XX-XXXX',
    itinHelper: 'Format: 9XX-XX-XXXX (starts with 9)',
    einHelper: 'Format: XX-XXXXXXX',
    // Step 3
    docsTitle: 'Upload Documents',
    idFrontLabel: 'State ID or Driver\'s License — Front',
    idFrontLabelEs: 'ID estatal o licencia de conducir — Frente',
    idFrontHelper: 'Take a photo of the front of your government-issued ID',
    idFrontHelperEs: 'Tome una foto del frente de su identificación emitida por el gobierno',
    idBackLabel: 'State ID or Driver\'s License — Back',
    idBackLabelEs: 'ID estatal o licencia de conducir — Reverso',
    idBackHelper: 'Take a photo of the back of your ID',
    idBackHelperEs: 'Tome una foto del reverso de su identificación',
    taxDocLabel: 'Social Security Card, ITIN Letter, or Work Permit (EAD)',
    taxDocLabelEs: 'Tarjeta de Seguro Social, Carta ITIN o Permiso de Trabajo (EAD)',
    taxDocHelper: 'Take a photo of your SSN card, ITIN assignment letter, or EAD card',
    taxDocHelperEs: 'Tome una foto de su tarjeta de Seguro Social, carta de ITIN o tarjeta EAD',
    bankingTitle: 'Direct Deposit (Optional)',
    payByCheckLabel: 'Pay me by check instead',
    bankNameLabel: 'Bank name',
    accountTypeLabel: 'Account type',
    checking: 'Checking',
    savings: 'Savings',
    routingLabel: 'Routing number',
    routingHelper: '9-digit number on bottom-left of a check',
    accountLabel: 'Account number',
    voidedCheckLabel: 'Voided check (optional)',
    voidedCheckLabelEs: 'Cheque anulado (opcional)',
    voidedCheckHelper: 'Take a photo of a voided check to confirm your account',
    voidedCheckHelperEs: 'Tome una foto de un cheque anulado para confirmar su cuenta',
    // Step 4
    reviewTitle: 'Review Your Information',
    reviewSub: 'Please review everything before signing.',
    personalInfo: 'Personal Information',
    taxInfo: 'Tax Information',
    bankingInfo: 'Banking',
    docsInfo: 'Documents',
    submitted: 'Submitted!',
    submittedSub: 'Your onboarding is complete. Your employer will review your information and be in touch.',
  },
  es: {
    loading: 'Cargando su formulario de incorporación…',
    invalid: 'Enlace inválido o vencido',
    invalidSub: 'Este enlace de incorporación no es válido. Comuníquese con su empleador para obtener un nuevo enlace.',
    expired: 'Este enlace ha vencido',
    expiredSub: 'Los enlaces de incorporación vencen después de 7 días. Comuníquese con su empleador para solicitar un nuevo enlace.',
    completed: 'Ya enviado',
    completedSub: 'Su formulario de incorporación ya fue enviado. Su empleador se comunicará con usted.',
    behalfToggle: 'Estoy llenando esto en nombre de otra persona',
    helperNameLabel: 'Su nombre (asistente)',
    helperRoleLabel: 'Su función / relación',
    helperNamePlaceholder: 'Ej. Supervisor, familiar',
    step1: 'Acerca de ti',
    step2: 'Formulario de impuestos',
    step3: 'Documentos y banco',
    step4: 'Revisar y firmar',
    next: 'Continuar',
    back: 'Atrás',
    submit: 'Enviar incorporación',
    submitting: 'Enviando…',
    saved: 'Progreso guardado',
    saving: 'Guardando…',
    fullNameLabel: 'Nombre legal completo',
    fullNamePlaceholder: 'Tal como aparece en su identificación',
    emailLabel: 'Correo electrónico',
    phoneLabel: 'Número de teléfono',
    phonePlaceholder: '(555) 000-0000',
    dobLabel: 'Fecha de nacimiento',
    address1Label: 'Dirección',
    address2Label: 'Apto, unidad (opcional)',
    cityLabel: 'Ciudad',
    stateLabel: 'Estado',
    zipLabel: 'Código postal',
    taxIdTypeLabel: 'Tipo de identificación fiscal',
    taxIdNumberLabel: 'Número de identificación fiscal',
    ssnHelper: 'Formato: XXX-XX-XXXX',
    itinHelper: 'Formato: 9XX-XX-XXXX (comienza con 9)',
    einHelper: 'Formato: XX-XXXXXXX',
    docsTitle: 'Subir documentos',
    idFrontLabel: 'ID estatal o licencia de conducir — Frente',
    idFrontLabelEs: 'ID estatal o licencia de conducir — Frente',
    idFrontHelper: 'Tome una foto del frente de su identificación emitida por el gobierno',
    idFrontHelperEs: 'Tome una foto del frente de su identificación emitida por el gobierno',
    idBackLabel: 'ID estatal o licencia de conducir — Reverso',
    idBackLabelEs: 'ID estatal o licencia de conducir — Reverso',
    idBackHelper: 'Tome una foto del reverso de su identificación',
    idBackHelperEs: 'Tome una foto del reverso de su identificación',
    taxDocLabel: 'Tarjeta de Seguro Social, Carta ITIN o Permiso de Trabajo (EAD)',
    taxDocLabelEs: 'Tarjeta de Seguro Social, Carta ITIN o Permiso de Trabajo (EAD)',
    taxDocHelper: 'Tome una foto de su tarjeta de Seguro Social, carta de ITIN o tarjeta EAD',
    taxDocHelperEs: 'Tome una foto de su tarjeta de Seguro Social, carta de ITIN o tarjeta EAD',
    bankingTitle: 'Depósito directo (Opcional)',
    payByCheckLabel: 'Págueme con cheque',
    bankNameLabel: 'Nombre del banco',
    accountTypeLabel: 'Tipo de cuenta',
    checking: 'Cuenta corriente',
    savings: 'Cuenta de ahorros',
    routingLabel: 'Número de ruta',
    routingHelper: 'Número de 9 dígitos en la parte inferior izquierda de un cheque',
    accountLabel: 'Número de cuenta',
    voidedCheckLabel: 'Cheque anulado (opcional)',
    voidedCheckLabelEs: 'Cheque anulado (opcional)',
    voidedCheckHelper: 'Tome una foto de un cheque anulado para confirmar su cuenta',
    voidedCheckHelperEs: 'Tome una foto de un cheque anulado para confirmar su cuenta',
    reviewTitle: 'Revise su información',
    reviewSub: 'Por favor revise todo antes de firmar.',
    personalInfo: 'Información personal',
    taxInfo: 'Información fiscal',
    bankingInfo: 'Banco',
    docsInfo: 'Documentos',
    submitted: '¡Enviado!',
    submittedSub: 'Su incorporación está completa. Su empleador revisará su información y se comunicará con usted.',
  },
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validateStep(step: number, data: OnboardingFormData, employeeType: string): Partial<Record<keyof OnboardingFormData, string>> {
  const errs: Partial<Record<keyof OnboardingFormData, string>> = {}
  if (step === 1) {
    if (!data.full_name.trim()) errs.full_name = 'Required'
    if (!data.email.trim() || !data.email.includes('@')) errs.email = 'Valid email required'
    if (!data.tax_id_number.replace(/\D/g, '').match(/^\d{9}$/)) errs.tax_id_number = 'Must be 9 digits'
    if (!data.date_of_birth) errs.date_of_birth = 'Required'
    if (!data.address_line1.trim()) errs.address_line1 = 'Required'
    if (!data.city.trim()) errs.city = 'Required'
    if (!data.state.trim()) errs.state = 'Required'
    if (!data.zip.trim()) errs.zip = 'Required'
  }
  if (step === 2 && employeeType !== 'contractor') {
    if (!data.w4_filing_status) errs.w4_filing_status = 'Required'
  }
  if (step === 2 && employeeType === 'contractor') {
    if (!data.w9_tax_classification) errs.w9_tax_classification = 'Required'
    if (data.w9_tax_classification === 'llc' && !data.w9_llc_tax_classification) {
      errs.w9_llc_tax_classification = 'Required for LLC'
    }
  }
  if (step === 3) {
    if (!data.state_id_front_url) errs.state_id_front_url = 'Required'
    if (!data.state_id_back_url) errs.state_id_back_url = 'Required'
    if (!data.tax_id_document_url) errs.tax_id_document_url = 'Required'
  }
  if (step === 4) {
    if (!data.signature_name.trim()) errs.signature_name = 'Required'
    if (!data.signature_agreed) errs.signature_agreed = 'You must agree to continue'
  }
  return errs
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const {
    tokenState, invitation, formData, currentStep,
    saving, submitting, submitError, lastSaved,
    updateField, goToStep, uploadDocument, submitForm, saveDraft,
  } = useOnboardingForm(token)

  const lang = formData.language
  const text = t[lang]
  const employeeType = invitation?.employee_type ?? 'hourly'

  const handleUpload = useCallback(async (file: File, documentType: string) => {
    const path = await uploadDocument(file, documentType)
    const fieldMap: Record<string, keyof OnboardingFormData> = {
      state_id_front: 'state_id_front_url',
      state_id_back: 'state_id_back_url',
      tax_id_document: 'tax_id_document_url',
      voided_check: 'voided_check_url',
    }
    const field = fieldMap[documentType]
    if (field) updateField(field, path)
  }, [uploadDocument, updateField])

  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingFormData, string>>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleNext = () => {
    const errs = validateStep(currentStep, formData, employeeType)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    goToStep(currentStep + 1)
    window.scrollTo(0, 0)
  }

  const handleBack = () => {
    setErrors({})
    goToStep(currentStep - 1)
    window.scrollTo(0, 0)
  }

  const handleSubmit = async () => {
    const errs = validateStep(4, formData, employeeType)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    try {
      await submitForm()
      setSubmitted(true)
      window.scrollTo(0, 0)
    } catch { /* submitError is set by hook */ }
  }

  // ── State screens ──────────────────────────────────────────────────────────
  if (tokenState === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--muted)]">{text.loading}</p>
        </div>
      </div>
    )
  }
  if (tokenState === 'invalid') {
    return <ErrorScreen title={text.invalid} subtitle={text.invalidSub} />
  }
  if (tokenState === 'expired') {
    return <ErrorScreen title={text.expired} subtitle={text.expiredSub} />
  }
  if (tokenState === 'completed' || submitted) {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <CheckCircle size={48} className="text-[var(--success)] mx-auto mb-4" />
          <h1 className="font-serif text-2xl text-[var(--primary)] mb-2">{text.submitted}</h1>
          <p className="text-sm text-[var(--muted)]">{text.submittedSub}</p>
        </div>
      </div>
    )
  }

  const steps = [text.step1, text.step2, text.step3, text.step4]

  return (
    <div className="min-h-screen bg-[var(--paper)]" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div className="bg-[var(--primary)] px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-white/50 uppercase tracking-widest">Stanton Management</p>
            <h1 className="font-serif text-white text-base leading-tight">
              {lang === 'es' ? 'Incorporación de empleado' : 'Employee Onboarding'}
            </h1>
          </div>
          <LanguageToggle language={lang} onChange={v => updateField('language', v)} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-[var(--primary)]/10 border-b border-[var(--divider)]">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-1">
            {steps.map((label, i) => {
              const stepNum = i + 1
              const done = stepNum < currentStep
              const active = stepNum === currentStep
              return (
                <div key={i} className="flex items-center flex-1">
                  <div className={`flex items-center gap-1.5 ${active ? 'opacity-100' : done ? 'opacity-70' : 'opacity-30'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                      done ? 'bg-[var(--success)] text-white'
                      : active ? 'bg-[var(--primary)] text-white'
                      : 'border border-[var(--border)] text-[var(--muted)]'
                    }`}>
                      {done ? '✓' : stepNum}
                    </div>
                    <span className="text-xs text-[var(--ink)] hidden sm:block truncate">{label}</span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-1 ${done ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Auto-save indicator */}
      {(saving || lastSaved) && (
        <div className="max-w-lg mx-auto px-4 pt-2">
          <p className="text-xs text-[var(--muted)] flex items-center gap-1">
            <Save size={11} />
            {saving ? text.saving : lastSaved ? `${text.saved} ${lastSaved.toLocaleTimeString()}` : ''}
          </p>
        </div>
      )}

      {/* Form content */}
      <div className="max-w-lg mx-auto px-4 py-5 pb-20">
        {/* On-behalf-of toggle (visible on all steps) */}
        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.filled_by_helper}
            onChange={e => updateField('filled_by_helper', e.target.checked)}
            className="mt-0.5 w-5 h-5 border border-[var(--border)] rounded-none shrink-0
              checked:bg-[var(--primary)] checked:border-[var(--primary)]"
          />
          <span className="text-sm text-[var(--muted)]">{text.behalfToggle}</span>
        </label>

        {formData.filled_by_helper && (
          <div className="mb-5 p-4 bg-[var(--bg-section)] border border-[var(--divider)]">
            <div className="grid grid-cols-2 gap-3">
              <FormField label={text.helperNameLabel}>
                <FormInput
                  value={formData.helper_name}
                  onChange={e => updateField('helper_name', e.target.value)}
                  placeholder={text.helperNamePlaceholder}
                />
              </FormField>
              <FormField label={text.helperRoleLabel}>
                <FormInput
                  value={formData.helper_role}
                  onChange={e => updateField('helper_role', e.target.value)}
                />
              </FormField>
            </div>
          </div>
        )}

        <h2 className="font-serif text-xl text-[var(--primary)] mb-4">
          {lang === 'es' ? `Paso ${currentStep} de 4:` : `Step ${currentStep} of 4:`} {steps[currentStep - 1]}
        </h2>

        {/* ── Step 1: About You ── */}
        {currentStep === 1 && (
          <Step1 lang={lang} text={text} data={formData} onChange={updateField} errors={errors} />
        )}

        {/* ── Step 2: Tax Form ── */}
        {currentStep === 2 && (
          employeeType === 'contractor'
            ? <W9Form language={lang} data={formData} onChange={updateField} errors={errors} />
            : <W4Form language={lang} data={formData} onChange={updateField} errors={errors} />
        )}

        {/* ── Step 3: Documents + Banking ── */}
        {currentStep === 3 && (
          <Step3
            lang={lang} text={text} data={formData}
            onChange={updateField} errors={errors} onUpload={handleUpload}
          />
        )}

        {/* ── Step 4: Review + Sign ── */}
        {currentStep === 4 && (
          <Step4
            lang={lang} text={text} data={formData} employeeType={employeeType}
            onChange={updateField} errors={errors}
          />
        )}

        {submitError && (
          <InfoBlock variant="error" title={lang === 'es' ? 'Error al enviar' : 'Submission error'}>
            {submitError}
          </InfoBlock>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          {currentStep > 1 && (
            <FormButton variant="secondary" onClick={handleBack} className="flex-1">
              {text.back}
            </FormButton>
          )}
          {currentStep < 4 && (
            <FormButton onClick={handleNext} className="flex-1">
              {text.next}
            </FormButton>
          )}
          {currentStep === 4 && (
            <FormButton onClick={handleSubmit} loading={submitting} className="flex-1">
              {submitting ? text.submitting : text.submit}
            </FormButton>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ErrorScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">🔗</div>
        <h1 className="font-serif text-xl text-[var(--primary)] mb-2">{title}</h1>
        <p className="text-sm text-[var(--muted)]">{subtitle}</p>
      </div>
    </div>
  )
}

function Step1({ lang, text, data, onChange, errors }: {
  lang: 'en' | 'es'
  text: typeof t['en']
  data: OnboardingFormData
  onChange: <K extends keyof OnboardingFormData>(k: K, v: OnboardingFormData[K]) => void
  errors: Partial<Record<keyof OnboardingFormData, string>>
}) {
  const taxIdHelper = data.tax_id_type === 'ssn' ? text.ssnHelper
    : data.tax_id_type === 'itin' ? text.itinHelper
    : text.einHelper

  const taxIdPlaceholder = data.tax_id_type === 'ssn' ? '123-45-6789'
    : data.tax_id_type === 'itin' ? '900-70-1234'
    : '12-3456789'

  const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

  return (
    <div>
      <FormField label={text.fullNameLabel} required error={errors.full_name}>
        <FormInput
          value={data.full_name}
          onChange={e => onChange('full_name', e.target.value)}
          placeholder={text.fullNamePlaceholder}
          autoComplete="name"
          error={!!errors.full_name}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={text.emailLabel} required error={errors.email}>
          <FormInput
            type="email"
            value={data.email}
            onChange={e => onChange('email', e.target.value)}
            autoComplete="email"
            inputMode="email"
            error={!!errors.email}
          />
        </FormField>
        <FormField label={text.phoneLabel}>
          <FormInput
            type="tel"
            value={data.phone}
            onChange={e => onChange('phone', e.target.value)}
            placeholder={text.phonePlaceholder}
            autoComplete="tel"
            inputMode="tel"
          />
        </FormField>
      </div>

      <FormField label={text.dobLabel} required error={errors.date_of_birth}>
        <FormInput
          type="date"
          value={data.date_of_birth}
          onChange={e => onChange('date_of_birth', e.target.value)}
          error={!!errors.date_of_birth}
        />
      </FormField>

      <FormField label={text.address1Label} required error={errors.address_line1}>
        <FormInput
          value={data.address_line1}
          onChange={e => onChange('address_line1', e.target.value)}
          autoComplete="address-line1"
          error={!!errors.address_line1}
        />
      </FormField>

      <FormField label={text.address2Label}>
        <FormInput
          value={data.address_line2}
          onChange={e => onChange('address_line2', e.target.value)}
          autoComplete="address-line2"
        />
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <FormField label={text.cityLabel} required error={errors.city}>
            <FormInput
              value={data.city}
              onChange={e => onChange('city', e.target.value)}
              autoComplete="address-level2"
              error={!!errors.city}
            />
          </FormField>
        </div>
        <FormField label={text.stateLabel} required error={errors.state}>
          <FormSelect
            value={data.state}
            onChange={e => onChange('state', e.target.value)}
            error={!!errors.state}
          >
            <option value="">—</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
        </FormField>
        <FormField label={text.zipLabel} required error={errors.zip}>
          <FormInput
            value={data.zip}
            onChange={e => onChange('zip', e.target.value)}
            inputMode="numeric"
            maxLength={10}
            error={!!errors.zip}
          />
        </FormField>
      </div>

      <FormField label={text.taxIdTypeLabel} required>
        <FormSelect
          value={data.tax_id_type}
          onChange={e => onChange('tax_id_type', e.target.value as 'ssn' | 'itin' | 'ein')}
        >
          <option value="ssn">SSN — {lang === 'es' ? 'Número de Seguro Social' : 'Social Security Number'}</option>
          <option value="itin">ITIN — {lang === 'es' ? 'Número de Identificación del Contribuyente Individual' : 'Individual Taxpayer Identification Number'}</option>
          <option value="ein">EIN — {lang === 'es' ? 'Número de Identificación del Empleador' : 'Employer Identification Number'}</option>
        </FormSelect>
      </FormField>

      <FormField label={text.taxIdNumberLabel} required helperText={taxIdHelper} error={errors.tax_id_number}>
        <FormInput
          type="text"
          value={data.tax_id_number}
          onChange={e => onChange('tax_id_number', e.target.value)}
          placeholder={taxIdPlaceholder}
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          error={!!errors.tax_id_number}
        />
      </FormField>
    </div>
  )
}

function Step3({ lang, text, data, onChange, errors, onUpload }: {
  lang: 'en' | 'es'
  text: typeof t['en']
  data: OnboardingFormData
  onChange: <K extends keyof OnboardingFormData>(k: K, v: OnboardingFormData[K]) => void
  errors: Partial<Record<keyof OnboardingFormData, string>>
  onUpload: (file: File, documentType: string) => Promise<void>
}) {
  return (
    <div>
      <h3 className="font-medium text-[var(--ink)] mb-3">{text.docsTitle}</h3>

      <DocumentUploadField
        label={text.idFrontLabel} labelEs={text.idFrontLabelEs}
        helperText={text.idFrontHelper} helperTextEs={text.idFrontHelperEs}
        language={lang} value={data.state_id_front_url}
        onUpload={onUpload} documentType="state_id_front" required
        error={errors.state_id_front_url}
      />
      <DocumentUploadField
        label={text.idBackLabel} labelEs={text.idBackLabelEs}
        helperText={text.idBackHelper} helperTextEs={text.idBackHelperEs}
        language={lang} value={data.state_id_back_url}
        onUpload={onUpload} documentType="state_id_back" required
        error={errors.state_id_back_url}
      />
      <DocumentUploadField
        label={text.taxDocLabel} labelEs={text.taxDocLabelEs}
        helperText={text.taxDocHelper} helperTextEs={text.taxDocHelperEs}
        language={lang} value={data.tax_id_document_url}
        onUpload={onUpload} documentType="tax_id_document" required
        error={errors.tax_id_document_url}
      />

      <div className="border-t border-[var(--divider)] mt-6 pt-5">
        <h3 className="font-medium text-[var(--ink)] mb-3">{text.bankingTitle}</h3>

        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={data.pay_by_check}
            onChange={e => onChange('pay_by_check', e.target.checked)}
            className="w-5 h-5 border border-[var(--border)] rounded-none shrink-0
              checked:bg-[var(--primary)] checked:border-[var(--primary)]"
          />
          <span className="text-sm text-[var(--ink)]">{text.payByCheckLabel}</span>
        </label>

        {!data.pay_by_check && (
          <>
            <FormField label={text.bankNameLabel}>
              <FormInput
                value={data.bank_name}
                onChange={e => onChange('bank_name', e.target.value)}
              />
            </FormField>
            <FormField label={text.accountTypeLabel}>
              <FormSelect
                value={data.account_type}
                onChange={e => onChange('account_type', e.target.value as 'checking' | 'savings')}
              >
                <option value="">— {lang === 'es' ? 'Seleccionar' : 'Select'} —</option>
                <option value="checking">{text.checking}</option>
                <option value="savings">{text.savings}</option>
              </FormSelect>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={text.routingLabel} helperText={text.routingHelper}>
                <FormInput
                  value={data.routing_number}
                  onChange={e => onChange('routing_number', e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="000000000"
                />
              </FormField>
              <FormField label={text.accountLabel}>
                <FormInput
                  value={data.account_number}
                  onChange={e => onChange('account_number', e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  placeholder="—"
                />
              </FormField>
            </div>
            <DocumentUploadField
              label={text.voidedCheckLabel} labelEs={text.voidedCheckLabelEs}
              helperText={text.voidedCheckHelper} helperTextEs={text.voidedCheckHelperEs}
              language={lang} value={data.voided_check_url}
              onUpload={onUpload} documentType="voided_check"
            />
          </>
        )}
      </div>
    </div>
  )
}

function Step4({ lang, text, data, employeeType, onChange, errors }: {
  lang: 'en' | 'es'
  text: typeof t['en']
  data: OnboardingFormData
  employeeType: string
  onChange: <K extends keyof OnboardingFormData>(k: K, v: OnboardingFormData[K]) => void
  errors: Partial<Record<keyof OnboardingFormData, string>>
}) {
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex justify-between py-1.5 border-b border-[var(--divider)] last:border-0 text-sm">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="text-[var(--ink)] font-medium text-right max-w-[60%]">{value}</span>
      </div>
    ) : null

  const filingLabels: Record<string, string> = {
    single: lang === 'es' ? 'Soltero / Casado por separado' : 'Single / Married Sep.',
    married_joint: lang === 'es' ? 'Casado en conjunto' : 'Married Filing Jointly',
    married_separate: lang === 'es' ? 'Casado por separado' : 'Married Filing Separately',
    head_of_household: lang === 'es' ? 'Jefe de familia' : 'Head of Household',
  }

  return (
    <div>
      <p className="text-sm text-[var(--muted)] mb-4">{text.reviewSub}</p>

      <div className="mb-4">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">{text.personalInfo}</p>
        <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3">
          {row(lang === 'es' ? 'Nombre' : 'Name', data.full_name)}
          {row(lang === 'es' ? 'Correo' : 'Email', data.email)}
          {row(lang === 'es' ? 'Teléfono' : 'Phone', data.phone)}
          {row(lang === 'es' ? 'Dirección' : 'Address', [data.address_line1, data.city, data.state, data.zip].filter(Boolean).join(', '))}
          {row(lang === 'es' ? 'Fecha de nacimiento' : 'Date of birth', data.date_of_birth)}
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">{text.taxInfo}</p>
        <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3">
          {row(lang === 'es' ? 'Tipo de ID' : 'ID type', data.tax_id_type.toUpperCase())}
          {row(lang === 'es' ? 'Últimos 4 dígitos' : 'Last 4 digits', data.tax_id_last4 ? `***-**-${data.tax_id_last4}` : null)}
          {employeeType !== 'contractor' && row(lang === 'es' ? 'Estado civil' : 'Filing status', filingLabels[data.w4_filing_status] ?? data.w4_filing_status)}
          {employeeType === 'contractor' && row(lang === 'es' ? 'Clasificación' : 'Classification', data.w9_tax_classification)}
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">{text.bankingInfo}</p>
        <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3">
          {data.pay_by_check
            ? row(lang === 'es' ? 'Método de pago' : 'Payment method', lang === 'es' ? 'Cheque' : 'Paper check')
            : <>
                {row(lang === 'es' ? 'Banco' : 'Bank', data.bank_name)}
                {row(lang === 'es' ? 'Tipo de cuenta' : 'Account type', data.account_type)}
                {row(lang === 'es' ? 'Cuenta (últimos 4)' : 'Account (last 4)', data.account_number_last4 ? `****${data.account_number_last4}` : null)}
              </>
          }
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">{text.docsInfo}</p>
        <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3">
          {row('State ID (front)', data.state_id_front_url ? '✓ Uploaded' : null)}
          {row('State ID (back)', data.state_id_back_url ? '✓ Uploaded' : null)}
          {row(lang === 'es' ? 'Doc. de ID fiscal' : 'Tax ID document', data.tax_id_document_url ? '✓ Uploaded' : null)}
        </div>
      </div>

      <div className="mt-5">
        <TypedSignature
          language={lang}
          value={data.signature_name}
          agreed={data.signature_agreed}
          onNameChange={v => onChange('signature_name', v)}
          onAgreedChange={v => onChange('signature_agreed', v)}
          error={errors.signature_name || (errors.signature_agreed as string | undefined)}
        />
      </div>
    </div>
  )
}
