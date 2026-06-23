'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface OnboardingFormData {
  // Step 1
  full_name: string
  email: string
  phone: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  tax_id_type: 'ssn' | 'itin' | 'ein'
  tax_id_number: string // full number, never sent to DB
  tax_id_last4: string
  date_of_birth: string
  // Step 2 - W4
  w4_filing_status: string
  w4_multiple_jobs: boolean
  w4_dependents_amount: string
  w4_other_income: string
  w4_deductions: string
  w4_extra_withholding: string
  w4_exempt: boolean
  // Step 2 - W9
  w9_business_name: string
  w9_tax_classification: string
  w9_llc_tax_classification: string
  // Step 3 - Documents
  state_id_front_url: string
  state_id_back_url: string
  tax_id_document_url: string
  voided_check_url: string
  // Step 3 - Banking
  pay_by_check: boolean
  bank_name: string
  account_type: 'checking' | 'savings' | ''
  routing_number: string
  account_number: string // full number, never sent to DB
  account_number_last4: string
  // Step 4 - Sign
  signature_name: string
  signature_agreed: boolean
  // Metadata
  language: 'en' | 'es'
  filled_by_helper: boolean
  helper_name: string
  helper_role: string
  start_date: string
  job_title: string
}

export const blankFormData = (): OnboardingFormData => ({
  full_name: '', email: '', phone: '',
  address_line1: '', address_line2: '', city: '', state: '', zip: '',
  tax_id_type: 'ssn', tax_id_number: '', tax_id_last4: '',
  date_of_birth: '',
  w4_filing_status: 'single', w4_multiple_jobs: false,
  w4_dependents_amount: '', w4_other_income: '', w4_deductions: '',
  w4_extra_withholding: '', w4_exempt: false,
  w9_business_name: '', w9_tax_classification: 'individual', w9_llc_tax_classification: '',
  state_id_front_url: '', state_id_back_url: '',
  tax_id_document_url: '', voided_check_url: '',
  pay_by_check: false, bank_name: '', account_type: '',
  routing_number: '', account_number: '', account_number_last4: '',
  signature_name: '', signature_agreed: false,
  language: 'en', filled_by_helper: false, helper_name: '', helper_role: '',
  start_date: '', job_title: '',
})

export interface InvitationInfo {
  id: string
  employee_type: 'hourly' | 'salaried' | 'contractor'
  full_name: string | null
  email: string | null
  expires_at: string
}

type TokenState = 'loading' | 'valid' | 'invalid' | 'expired' | 'completed'

export function useOnboardingForm(token: string) {
  const [tokenState, setTokenState] = useState<TokenState>('loading')
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [formData, setFormData] = useState<OnboardingFormData>(blankFormData())
  const [currentStep, setCurrentStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load invitation + draft on mount
  useEffect(() => {
    if (!token) return
    fetch(`/api/onboarding/draft?token=${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.error === 'expired') { setTokenState('expired'); return }
        if (data.error === 'already_completed') { setTokenState('completed'); return }
        if (data.error) { setTokenState('invalid'); return }
        setInvitation(data.invitation)
        if (data.draft) {
          const restored = { ...blankFormData(), ...data.draft.form_data }
          // Detect browser language
          const browserLang = typeof navigator !== 'undefined'
            ? navigator.language?.startsWith('es') ? 'es' : 'en'
            : 'en'
          if (!data.draft.form_data.language) restored.language = browserLang
          // Pre-fill from invitation if blank
          if (!restored.full_name && data.invitation.full_name) restored.full_name = data.invitation.full_name
          if (!restored.email && data.invitation.email) restored.email = data.invitation.email
          setFormData(restored)
          setCurrentStep(data.draft.current_step ?? 1)
        } else {
          const browserLang = typeof navigator !== 'undefined'
            ? navigator.language?.startsWith('es') ? 'es' : 'en'
            : 'en'
          const blank = blankFormData()
          blank.language = browserLang
          if (data.invitation.full_name) blank.full_name = data.invitation.full_name
          if (data.invitation.email) blank.email = data.invitation.email
          setFormData(blank)
        }
        setTokenState('valid')
      })
      .catch(() => setTokenState('invalid'))
  }, [token])

  const saveDraft = useCallback(async (data: OnboardingFormData, step: number) => {
    if (!token) return
    setSaving(true)
    try {
      // Strip sensitive fields before saving to draft
      const safe = { ...data }
      delete (safe as Partial<typeof safe>).tax_id_number
      delete (safe as Partial<typeof safe>).account_number
      await fetch('/api/onboarding/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, form_data: safe, current_step: step }),
      })
      setLastSaved(new Date())
    } catch (e) {
      console.error('Auto-save failed', e)
    } finally {
      setSaving(false)
    }
  }, [token])

  const updateField = useCallback(<K extends keyof OnboardingFormData>(
    key: K, value: OnboardingFormData[K]
  ) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value }
      // Keep last4 in sync
      if (key === 'tax_id_number') {
        const num = String(value).replace(/\D/g, '')
        next.tax_id_last4 = num.slice(-4)
      }
      if (key === 'account_number') {
        const num = String(value).replace(/\D/g, '')
        next.account_number_last4 = num.slice(-4)
      }
      // Debounced auto-save
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(() => saveDraft(next, currentStep), 30000)
      return next
    })
  }, [currentStep, saveDraft])

  const goToStep = useCallback((step: number) => {
    setCurrentStep(step)
    saveDraft(formData, step)
  }, [formData, saveDraft])

  const uploadDocument = useCallback(async (file: File, documentType: string): Promise<string> => {
    const form = new FormData()
    form.append('token', token)
    form.append('document_type', documentType)
    form.append('file', file)
    const res = await fetch('/api/onboarding/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok || !data.path) throw new Error(data.error ?? 'Upload failed')
    return data.path
  }, [token])

  const submitForm = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = {
        token,
        form_data: {
          ...formData,
          tax_id_number: undefined, // never send full number
          account_number: undefined, // never send full account
        },
      }
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      return data.submission_id as string
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Submission failed'
      setSubmitError(msg)
      throw e
    } finally {
      setSubmitting(false)
    }
  }, [token, formData])

  return {
    tokenState,
    invitation,
    formData,
    currentStep,
    saving,
    submitting,
    submitError,
    lastSaved,
    updateField,
    setFormData,
    goToStep,
    uploadDocument,
    submitForm,
    saveDraft,
  }
}
