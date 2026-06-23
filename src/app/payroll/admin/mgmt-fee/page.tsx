'use client'

import { useState, useEffect } from 'react'
import { Plus, Check } from 'lucide-react'
import { useAdminMgmtFee } from '@/hooks/payroll/useAdminMgmtFee'
import { useAdminGlobalConfig } from '@/hooks/payroll/useAdminGlobalConfig'
import { useAuth } from '@/hooks/payroll/useAuth'
import { PageHeader, FormButton, FormField, FormInput, FormSelect, InfoBlock, SectionDivider, Toggle } from '@/components/form'
import { format } from 'date-fns'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function MgmtFeePage() {
  const { configs, portfolios, loading, addRate } = useAdminMgmtFee()
  const { config: globalConfig, properties, users, loading: gcLoading, saveCutoff, savePrefundToggle, saveRateSettings, saveNotificationsEnabled, setPropertyApprover } = useAdminGlobalConfig()
  const { isAdmin } = useAuth()

  // Mgmt fee form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ rate_pct: '10', portfolio_id: '', effective_date: format(new Date(), 'yyyy-MM-dd') })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Expense cutoff form
  const [cutoffDay, setCutoffDay] = useState<string>('')
  const [cutoffTime, setCutoffTime] = useState<string>('')
  const [savingCutoff, setSavingCutoff] = useState(false)
  const [cutoffSaved, setCutoffSaved] = useState(false)
  const [cutoffError, setCutoffError] = useState<string | null>(null)

  // Prefund toggle
  const [prefundIncludesMgmtFee, setPrefundIncludesMgmtFee] = useState(true)
  const [savingPrefund, setSavingPrefund] = useState(false)
  const [prefundSaved, setPrefundSaved] = useState(false)
  const [prefundError, setPrefundError] = useState<string | null>(null)

  // Rate settings (payroll tax, workers' comp, phone, OT threshold)
  const [payrollTaxRate, setPayrollTaxRate] = useState('8')
  const [workersCompRate, setWorkersCompRate] = useState('3')
  const [phoneAmount, setPhoneAmount] = useState('8')
  const [otThresholdHours, setOtThresholdHours] = useState('40')
  const [savingRates, setSavingRates] = useState(false)
  const [ratesSaved, setRatesSaved] = useState(false)
  const [ratesError, setRatesError] = useState<string | null>(null)

  // Approver filter
  const [approverFilter, setApproverFilter] = useState('')

  // Automated unallocated-hours notification switch
  const [notifOn, setNotifOn] = useState(false)
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)

  // Initialise cutoff form, prefund toggle, rate settings, and notification switch from loaded config
  useEffect(() => {
    if (globalConfig) {
      setCutoffDay(String(globalConfig.expense_cutoff_day ?? 3))
      setCutoffTime((globalConfig.expense_cutoff_time ?? '17:00:00').slice(0, 5))
      setPrefundIncludesMgmtFee(globalConfig.prefund_includes_mgmt_fee ?? true)
      setPayrollTaxRate(String(Number((globalConfig.payroll_tax_rate ?? 0.08) * 100).toFixed(2)).replace(/\.?0+$/, ''))
      setWorkersCompRate(String(Number((globalConfig.workers_comp_rate ?? 0.03) * 100).toFixed(2)).replace(/\.?0+$/, ''))
      setPhoneAmount(String(globalConfig.phone_reimbursement_amount ?? 8))
      setOtThresholdHours(String(globalConfig.ot_threshold_hours ?? 40))
      setNotifOn(globalConfig.unallocated_notifications_enabled ?? false)
    }
  }, [globalConfig])

  const handleToggleNotif = async (next: boolean) => {
    setNotifOn(next) // optimistic
    setNotifError(null)
    setNotifSaving(true)
    try {
      await saveNotificationsEnabled(next)
    } catch (e: unknown) {
      setNotifOn(!next) // roll back
      setNotifError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setNotifSaving(false)
    }
  }

  const handleSave = async () => {
    const rate = parseFloat(form.rate_pct)
    if (isNaN(rate) || rate < 0 || rate > 100) { setError('Enter a valid rate between 0 and 100'); return }
    setSaving(true)
    setError(null)
    try {
      await addRate(rate, form.portfolio_id || null, form.effective_date)
      setShowForm(false)
      setForm({ rate_pct: '10', portfolio_id: '', effective_date: format(new Date(), 'yyyy-MM-dd') })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCutoff = async () => {
    if (!cutoffTime) { setCutoffError('Time is required.'); return }
    setSavingCutoff(true)
    setCutoffError(null)
    try {
      await saveCutoff(parseInt(cutoffDay, 10), cutoffTime + ':00')
      setCutoffSaved(true)
      setTimeout(() => setCutoffSaved(false), 2500)
    } catch (e: unknown) {
      setCutoffError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingCutoff(false)
    }
  }

  const handleSavePrefund = async () => {
    setSavingPrefund(true)
    setPrefundError(null)
    try {
      await savePrefundToggle(prefundIncludesMgmtFee)
      setPrefundSaved(true)
      setTimeout(() => setPrefundSaved(false), 2500)
    } catch (e: unknown) {
      setPrefundError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingPrefund(false)
    }
  }

  const handleSaveRates = async () => {
    const taxRate = parseFloat(payrollTaxRate)
    const wcRate = parseFloat(workersCompRate)
    const phone = parseFloat(phoneAmount)
    const ot = parseFloat(otThresholdHours)
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) { setRatesError('Payroll tax rate must be 0–100%.'); return }
    if (isNaN(wcRate) || wcRate < 0 || wcRate > 100) { setRatesError("Workers' comp rate must be 0–100%."); return }
    if (isNaN(phone) || phone < 0) { setRatesError('Phone amount must be 0 or greater.'); return }
    if (isNaN(ot) || ot < 1 || ot > 168) { setRatesError('OT threshold must be between 1 and 168 hours.'); return }
    setSavingRates(true)
    setRatesError(null)
    try {
      await saveRateSettings({
        payrollTaxRate: taxRate / 100,
        workersCompRate: wcRate / 100,
        phoneAmount: phone,
        otThresholdHours: ot,
      })
      setRatesSaved(true)
      setTimeout(() => setRatesSaved(false), 2500)
    } catch (e: unknown) {
      setRatesError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingRates(false)
    }
  }

  // Group by portfolio
  const globalConfigs = configs.filter(c => c.portfolio_id === null)
  const portfolioConfigs = configs.filter(c => c.portfolio_id !== null)

  const portfolioName = (id: string) => portfolios.find(p => p.id === id)?.name ?? id

  const filteredProperties = approverFilter
    ? properties.filter(p =>
        p.code.toLowerCase().includes(approverFilter.toLowerCase()) ||
        p.name.toLowerCase().includes(approverFilter.toLowerCase()) ||
        (p.portfolio_name ?? '').toLowerCase().includes(approverFilter.toLowerCase())
      )
    : properties

  return (
    <div>
      <PageHeader
        title="Management Fee Configuration"
        subtitle="Per-portfolio rates with effective dates — rate history is append-only"
        actions={
          <FormButton size="sm" onClick={() => setShowForm(true)}>
            <Plus size={14} className="mr-1" />
            Add Rate
          </FormButton>
        }
      />

      <div className="p-6 max-w-3xl">
        <InfoBlock variant="default" title="How rates work">
          A portfolio-specific rate overrides the global rate. Rates are effective from the date entered forward.
          The most recent effective rate is used for each payroll week.
        </InfoBlock>

        {showForm && (
          <div className="border border-[var(--border)] bg-white p-5 mt-5 mb-5">
            <h3 className="font-serif text-base text-[var(--primary)] mb-4">New Rate Entry</h3>
            {error && <InfoBlock variant="error">{error}</InfoBlock>}
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Rate (%)" required>
                <FormInput
                  type="number" step="0.1" min="0" max="100"
                  value={form.rate_pct}
                  onChange={e => setForm(p => ({ ...p, rate_pct: e.target.value }))}
                />
              </FormField>
              <FormField label="Portfolio" helperText="Leave blank for global rate">
                <FormSelect value={form.portfolio_id} onChange={e => setForm(p => ({ ...p, portfolio_id: e.target.value }))}>
                  <option value="">— All portfolios (global) —</option>
                  {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </FormSelect>
              </FormField>
              <FormField label="Effective Date" required>
                <FormInput type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))} />
              </FormField>
            </div>
            <div className="flex gap-2 mt-2">
              <FormButton onClick={handleSave} loading={saving}>Save Rate</FormButton>
              <FormButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</FormButton>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : (
          <>
            <SectionDivider label="Global Rate (applies to all portfolios)" />
            <table className="w-full text-sm border border-[var(--border)] mb-6">
              <thead>
                <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 text-left font-medium">Rate</th>
                  <th className="px-4 py-2.5 text-left font-medium">Effective Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {globalConfigs.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-3 text-[var(--muted)] text-sm">No global rate configured</td></tr>
                ) : globalConfigs.map((c, i) => (
                  <tr key={c.id} className={`border-t border-[var(--divider)] ${i === 0 ? 'font-semibold' : 'text-[var(--muted)]'}`}>
                    <td className="px-4 py-2.5">
                      {(Number(c.rate_pct) * 100).toFixed(1)}%
                      {i === 0 && <span className="ml-2 text-xs text-[var(--success)] font-normal">current</span>}
                    </td>
                    <td className="px-4 py-2.5">{c.effective_date}</td>
                    <td className="px-4 py-2.5 text-xs">{format(new Date(c.created_at), 'MMM d, yyyy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {portfolioConfigs.length > 0 && (
              <>
                <SectionDivider label="Portfolio-Specific Overrides" />
                <table className="w-full text-sm border border-[var(--border)]">
                  <thead>
                    <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                      <th className="px-4 py-2.5 text-left font-medium">Portfolio</th>
                      <th className="px-4 py-2.5 text-left font-medium">Rate</th>
                      <th className="px-4 py-2.5 text-left font-medium">Effective Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioConfigs.map(c => (
                      <tr key={c.id} className="border-t border-[var(--divider)]">
                        <td className="px-4 py-2.5">{portfolioName(c.portfolio_id!)}</td>
                        <td className="px-4 py-2.5 font-medium">{(Number(c.rate_pct) * 100).toFixed(1)}%</td>
                        <td className="px-4 py-2.5">{c.effective_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {/* ── Expense Submission Cutoff ─────────────────────────────────── */}
        <div className="mt-10">
          <SectionDivider label="Expense Submission Cutoff" />
          <InfoBlock variant="default" title="How the cutoff works">
            Submissions received before the cutoff are included in the current payroll week.
            Submissions after the cutoff are automatically queued for the following week.
            Employees are shown which week their submission will pay in — before they sign.
          </InfoBlock>
          {gcLoading ? (
            <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
          ) : (
            <div className="flex items-end gap-4 mt-4">
              <FormField label="Cutoff Day">
                <FormSelect value={cutoffDay} onChange={e => setCutoffDay(e.target.value)}>
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={String(i)}>{d}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="Cutoff Time">
                <FormInput
                  type="time"
                  value={cutoffTime}
                  onChange={e => setCutoffTime(e.target.value)}
                />
              </FormField>
              <div className="mb-4">
                <FormButton onClick={handleSaveCutoff} loading={savingCutoff}>
                  {cutoffSaved ? <><Check size={13} className="mr-1 inline" />Saved</> : 'Save Cutoff'}
                </FormButton>
              </div>
            </div>
          )}
          {cutoffError && <InfoBlock variant="error">{cutoffError}</InfoBlock>}
        </div>

        {/* ── Prefund Toggle ───────────────────────────────────────────── */}
        <div className="mt-10">
          <SectionDivider label="Required Pre-Fund Calculation" />
          <InfoBlock variant="default" title="Management fee in pre-fund">
            When enabled, the Required Pre-Fund amount on the payroll review page includes the management fee
            (gross pay + tax + workers&apos; comp + mgmt fee). Disable to exclude the fee from the pre-fund figure.
          </InfoBlock>
          {gcLoading ? (
            <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
          ) : (
            <div className="flex items-end gap-4 mt-4">
              <FormField label="Include management fee in required prefund">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefundIncludesMgmtFee}
                    onChange={e => setPrefundIncludesMgmtFee(e.target.checked)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--primary)]">
                    {prefundIncludesMgmtFee ? 'Enabled — fee included in pre-fund' : 'Disabled — fee excluded from pre-fund'}
                  </span>
                </label>
              </FormField>
              <div className="mb-4">
                <FormButton onClick={handleSavePrefund} loading={savingPrefund}>
                  {prefundSaved ? <><Check size={13} className="mr-1 inline" />Saved</> : 'Save'}
                </FormButton>
              </div>
            </div>
          )}
          {prefundError && <InfoBlock variant="error">{prefundError}</InfoBlock>}
        </div>

        {/* ── Payroll Rate Settings ────────────────────────────────────── */}
        <div className="mt-10">
          <SectionDivider label="Payroll Rate Settings" />
          <InfoBlock variant="default" title="Configurable rate constants">
            These rates are applied when calculating each week&apos;s payroll. Changes take effect on
            the next payroll calculation — they do not retroactively alter approved weeks.
            The FLSA overtime multiplier (1.5×) is a legal constant and cannot be changed here.
          </InfoBlock>
          {gcLoading ? (
            <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <FormField label="Payroll Tax Rate (%)" helperText="Employer FICA/SUTA burden on taxable wages (default 8%)">
                <FormInput
                  type="number" step="0.01" min="0" max="100"
                  value={payrollTaxRate}
                  onChange={e => setPayrollTaxRate(e.target.value)}
                />
              </FormField>
              <FormField label="Workers' Comp Rate (%)" helperText="Applied to taxable wages (default 3%)">
                <FormInput
                  type="number" step="0.01" min="0" max="100"
                  value={workersCompRate}
                  onChange={e => setWorkersCompRate(e.target.value)}
                />
              </FormField>
              <FormField label="Phone Reimbursement ($)" helperText="Weekly amount per eligible employee (default $8)">
                <FormInput
                  type="number" step="0.01" min="0"
                  value={phoneAmount}
                  onChange={e => setPhoneAmount(e.target.value)}
                />
              </FormField>
              <FormField label="OT Threshold (hours)" helperText="Weekly hours before overtime kicks in for eligible employees (default 40)">
                <FormInput
                  type="number" step="0.5" min="1" max="168"
                  value={otThresholdHours}
                  onChange={e => setOtThresholdHours(e.target.value)}
                />
              </FormField>
            </div>
          )}
          {!gcLoading && (
            <div className="flex items-center gap-4 mt-3">
              <FormButton onClick={handleSaveRates} loading={savingRates}>
                {ratesSaved ? <><Check size={13} className="mr-1 inline" />Saved</> : 'Save Rates'}
              </FormButton>
            </div>
          )}
          {ratesError && <InfoBlock variant="error">{ratesError}</InfoBlock>}
        </div>

        {/* ── Automated Unallocated-Hours Notifications ─────────────────── */}
        {isAdmin && (
          <div className="mt-10">
            <SectionDivider label="Automated Unallocated-Hours Notifications" />
            <InfoBlock variant="warning" title="Off by default — turn on only when you're ready to text employees">
              When <strong>on</strong>, a daily job texts each employee who has hours not yet assigned
              to a property in Workyard, telling them to open Workyard and assign them (unassigned
              hours can&apos;t be paid). When <strong>off</strong>, nothing automated is sent — managers
              can still hold &amp; notify by hand from the weekly review screen. Texts stay in dry-run
              (logged, not delivered) until Twilio credentials are configured.
            </InfoBlock>
            {gcLoading ? (
              <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
            ) : (
              <div className="flex items-center gap-3 mt-4">
                <Toggle
                  on={notifOn}
                  disabled={notifSaving}
                  onChange={handleToggleNotif}
                  label="Enable automated unallocated-hours notifications"
                />
                <span className="text-sm text-[var(--ink)]">
                  {notifOn ? 'On — daily texts will be sent' : 'Off — no automated texts'}
                </span>
                {notifSaving && <span className="text-xs text-[var(--muted)]">Saving…</span>}
              </div>
            )}
            {notifError && <InfoBlock variant="error">{notifError}</InfoBlock>}
          </div>
        )}

        {/* ── Property Expense Approvers ────────────────────────────────── */}
        <div className="mt-10 mb-8">
          <SectionDivider label="Expense Approvers by Property" />
          <InfoBlock variant="default" title="How approver routing works">
            When an employee submits an expense for a property, it routes to that property&apos;s
            assigned approver. Properties with no approver set will fall to global admin review.
          </InfoBlock>
          <div className="mt-4 mb-3">
            <FormInput
              placeholder="Filter by property code, name, or portfolio…"
              value={approverFilter}
              onChange={e => setApproverFilter(e.target.value)}
            />
          </div>
          {gcLoading ? (
            <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
          ) : (
            <table className="w-full text-sm border border-[var(--border)]">
              <thead>
                <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 text-left font-medium">Code</th>
                  <th className="px-4 py-2.5 text-left font-medium">Property</th>
                  <th className="px-4 py-2.5 text-left font-medium">Portfolio</th>
                  <th className="px-4 py-2.5 text-left font-medium">Approver</th>
                </tr>
              </thead>
              <tbody>
                {filteredProperties.map(prop => (
                  <tr key={prop.id} className="border-t border-[var(--divider)]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--muted)]">{prop.code}</td>
                    <td className="px-4 py-2.5">{prop.name}</td>
                    <td className="px-4 py-2.5 text-[var(--muted)]">{prop.portfolio_name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <FormSelect
                        value={prop.approver_user_id ?? ''}
                        onChange={async e => {
                          try {
                            await setPropertyApprover(prop.id, e.target.value || null)
                          } catch {}
                        }}
                      >
                        <option value="">— No approver set —</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.full_name ?? u.email} ({u.role})
                          </option>
                        ))}
                      </FormSelect>
                    </td>
                  </tr>
                ))}
                {filteredProperties.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-[var(--muted)] text-sm">
                      {approverFilter ? 'No properties match filter.' : 'No active properties.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
