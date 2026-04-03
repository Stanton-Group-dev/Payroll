'use client'

import { useState, useCallback } from 'react'
import { Plus, Copy, Check, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect,
  Drawer, InfoBlock, StatusBadge, SectionDivider,
} from '@/components/form'
import { useOnboardingInvitations } from '@/hooks/payroll/useOnboardingInvitations'
import { useOnboardingSubmissions } from '@/hooks/payroll/useOnboardingSubmissions'
import type { OnboardingSubmission, ApprovalOperationalData } from '@/hooks/payroll/useOnboardingSubmissions'
import { useAuth } from '@/hooks/payroll/useAuth'
import { format } from 'date-fns'

// ─── Status badges ─────────────────────────────────────────────────────────────
const statusLabelMap: Record<string, string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_correction: 'Needs Correction',
}

// ─── Create Invitation Drawer ─────────────────────────────────────────────────
function CreateInvitationDrawer({
  open,
  onClose,
  getOnboardingUrl,
  createInvitation,
}: {
  open: boolean
  onClose: () => void
  getOnboardingUrl: (token: string) => string
  createInvitation: (email: string, fullName: string | null, type: 'hourly' | 'salaried' | 'contractor') => Promise<{ token: string }>
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [employeeType, setEmployeeType] = useState<'hourly' | 'salaried' | 'contractor'>('hourly')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    if (!email.trim()) { setError('Email is required'); return }
    if (!email.includes('@')) { setError('Enter a valid email'); return }
    setError(null)
    setSaving(true)
    try {
      const inv = await createInvitation(email.trim(), fullName.trim() || null, employeeType)
      setCreatedLink(getOnboardingUrl(inv.token))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create invitation')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    if (!createdLink) return
    navigator.clipboard.writeText(createdLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setEmail(''); setFullName(''); setEmployeeType('hourly')
    setError(null); setCreatedLink(null); setCopied(false)
    onClose()
  }

  return (
    <Drawer open={open} onClose={handleClose} title="Create Onboarding Invitation">
      {!createdLink ? (
        <>
          {error && <InfoBlock variant="error">{error}</InfoBlock>}
          <FormField label="Email address" required>
            <FormInput
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="employee@example.com"
            />
          </FormField>
          <FormField label="Full name (optional)" helperText="Employee can fill this in themselves">
            <FormInput
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="First Last"
            />
          </FormField>
          <FormField label="Employee type" required helperText="Determines W-4 (hourly/salaried) or W-9 (contractor)">
            <FormSelect value={employeeType} onChange={e => setEmployeeType(e.target.value as 'hourly' | 'salaried' | 'contractor')}>
              <option value="hourly">Hourly (W-2)</option>
              <option value="salaried">Salaried (W-2)</option>
              <option value="contractor">Contractor (1099)</option>
            </FormSelect>
          </FormField>
          <div className="mt-2 p-3 bg-[var(--bg-section)] border border-[var(--divider)] text-xs text-[var(--muted)]">
            The link will be valid for 7 days. Copy and send it via text, WhatsApp, or email.
            No automatic delivery — you send it.
          </div>
          <div className="flex gap-2 pt-4 border-t border-[var(--divider)] mt-4">
            <FormButton onClick={handleCreate} loading={saving} fullWidth>
              Generate Link
            </FormButton>
            <FormButton variant="ghost" onClick={handleClose}>Cancel</FormButton>
          </div>
        </>
      ) : (
        <>
          <InfoBlock variant="success" title="Link generated">
            Copy this link and send it to the employee via text, WhatsApp, or email.
            The link expires in 7 days.
          </InfoBlock>
          <div className="mt-4 p-3 bg-[var(--bg-section)] border border-[var(--border)] break-all text-sm font-mono text-[var(--ink)]">
            {createdLink}
          </div>
          <FormButton
            onClick={handleCopy}
            fullWidth
            className="mt-3"
            variant={copied ? 'secondary' : 'primary'}
          >
            {copied ? (
              <span className="flex items-center gap-2"><Check size={14} /> Copied!</span>
            ) : (
              <span className="flex items-center gap-2"><Copy size={14} /> Copy Link</span>
            )}
          </FormButton>
          <FormButton variant="ghost" onClick={handleClose} fullWidth className="mt-2">
            Done
          </FormButton>
        </>
      )}
    </Drawer>
  )
}

// ─── Submission Review Drawer ─────────────────────────────────────────────────
function SubmissionReviewDrawer({
  open,
  onClose,
  submission,
  approveSubmission,
  rejectSubmission,
  requestCorrection,
  getSignedUrl,
  isAdmin,
}: {
  open: boolean
  onClose: () => void
  submission: OnboardingSubmission | null
  approveSubmission: (id: string, data: ApprovalOperationalData, notes: string) => Promise<string>
  rejectSubmission: (id: string, notes: string) => Promise<void>
  requestCorrection: (id: string, notes: string) => Promise<void>
  getSignedUrl: (path: string) => Promise<string>
  isAdmin: boolean
}) {
  const [adminNotes, setAdminNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operational, setOperational] = useState<ApprovalOperationalData>({
    hourly_rate: null, weekly_rate: null, trade: null, workyard_id: null,
    ot_allowed: false, pay_tax: false, wc: false,
  })
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null)

  const loadSignedUrl = async (path: string) => {
    if (!path || signedUrls[path]) return
    setLoadingUrl(path)
    try {
      const url = await getSignedUrl(path)
      setSignedUrls(prev => ({ ...prev, [path]: url }))
    } catch { /* ignore */ }
    finally { setLoadingUrl(null) }
  }

  const handleApprove = async () => {
    if (!submission) return
    setSaving(true); setError(null)
    try {
      await approveSubmission(submission.id, operational, adminNotes)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to approve')
    } finally { setSaving(false) }
  }

  const handleReject = async () => {
    if (!submission || !adminNotes.trim()) {
      setError('Please add a note before rejecting')
      return
    }
    setSaving(true); setError(null)
    try {
      await rejectSubmission(submission.id, adminNotes)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally { setSaving(false) }
  }

  const handleRequestCorrection = async () => {
    if (!submission || !adminNotes.trim()) {
      setError('Please describe what needs to be corrected')
      return
    }
    setSaving(true); setError(null)
    try {
      await requestCorrection(submission.id, adminNotes)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to request correction')
    } finally { setSaving(false) }
  }

  if (!submission) return null

  const row = (label: string, value: string | null | undefined | boolean) => {
    const display = value === true ? 'Yes' : value === false ? 'No' : value
    if (!display) return null
    return (
      <div className="flex justify-between py-1.5 border-b border-[var(--divider)] last:border-0 text-sm">
        <span className="text-[var(--muted)] shrink-0">{label}</span>
        <span className="text-[var(--ink)] font-medium text-right ml-4">{String(display)}</span>
      </div>
    )
  }

  const docImg = (label: string, path: string | null) => {
    if (!path) return <p className="text-xs text-[var(--muted)]">{label}: Not uploaded</p>
    const url = signedUrls[path]
    return (
      <div className="mb-3">
        <p className="text-xs text-[var(--muted)] mb-1">{label}</p>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt={label} className="max-h-40 border border-[var(--border)] object-contain" />
          </a>
        ) : (
          <button
            onClick={() => loadSignedUrl(path)}
            disabled={loadingUrl === path}
            className="text-xs text-[var(--primary)] underline flex items-center gap-1"
          >
            <ExternalLink size={11} />
            {loadingUrl === path ? 'Loading…' : 'View document'}
          </button>
        )}
      </div>
    )
  }

  const isPending = submission.status === 'pending' || submission.status === 'needs_correction'

  return (
    <Drawer open={open} onClose={onClose} title={submission.full_name} width={560}>
      <div className="flex items-center gap-2 mb-4">
        <StatusBadge status={submission.status} label={statusLabelMap[submission.status]} />
        <span className="text-xs text-[var(--muted)]">{submission.employee_type} • {submission.language.toUpperCase()}</span>
        {submission.filled_by_helper && (
          <span className="text-xs bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5">
            via {submission.helper_name ?? 'helper'}
          </span>
        )}
      </div>

      {error && <InfoBlock variant="error">{error}</InfoBlock>}

      <SectionDivider label="Personal Information" />
      <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3 mb-4">
        {row('Name', submission.full_name)}
        {row('Email', submission.email)}
        {row('Phone', submission.phone)}
        {row('Address', [submission.address_line1, submission.address_line2, submission.city, submission.state, submission.zip].filter(Boolean).join(', '))}
        {row('Date of birth', submission.date_of_birth)}
        {row('Tax ID type', submission.tax_id_type.toUpperCase())}
        {row('Tax ID (last 4)', submission.tax_id_last4 ? `***-**-${submission.tax_id_last4}` : null)}
        {row('Start date', submission.start_date)}
      </div>

      <SectionDivider label={submission.employee_type === 'contractor' ? 'W-9 Information' : 'W-4 Information'} />
      <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3 mb-4">
        {submission.employee_type === 'contractor' ? (
          <>
            {row('Classification', submission.w9_tax_classification)}
            {row('LLC classification', submission.w9_llc_tax_classification)}
            {row('Business name', submission.w9_business_name)}
          </>
        ) : (
          <>
            {row('Filing status', submission.w4_filing_status)}
            {row('Multiple jobs', submission.w4_multiple_jobs)}
            {row('Exempt', submission.w4_exempt)}
            {submission.w4_dependents_amount ? row('Dependents amt', `$${submission.w4_dependents_amount}`) : null}
            {submission.w4_extra_withholding ? row('Extra withholding', `$${submission.w4_extra_withholding}`) : null}
          </>
        )}
      </div>

      <SectionDivider label="Banking" />
      <div className="bg-[var(--bg-section)] border border-[var(--divider)] px-3 mb-4">
        {submission.pay_by_check
          ? row('Payment method', 'Paper check')
          : <>
              {row('Bank', submission.bank_name)}
              {row('Account type', submission.account_type)}
              {row('Account (last 4)', submission.account_number_last4 ? `****${submission.account_number_last4}` : null)}
              {row('Routing', submission.routing_number)}
            </>
        }
      </div>

      <SectionDivider label="Documents" />
      <div className="mb-4">
        {docImg('State ID (front)', submission.state_id_front_url)}
        {docImg('State ID (back)', submission.state_id_back_url)}
        {docImg('Tax ID document', submission.tax_id_document_url)}
        {submission.voided_check_url && docImg('Voided check', submission.voided_check_url)}
      </div>

      {isAdmin && isPending && (
        <>
          <SectionDivider label="Payroll Setup (Admin Only)" />
          <InfoBlock variant="default" title="Complete before approving">
            These fields create the employee record in payroll.
          </InfoBlock>

          <div className="grid grid-cols-2 gap-3">
            {submission.employee_type === 'hourly' && (
              <FormField label="Hourly rate ($)">
                <FormInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={operational.hourly_rate ?? ''}
                  onChange={e => setOperational(o => ({ ...o, hourly_rate: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="0.00"
                />
              </FormField>
            )}
            {submission.employee_type === 'salaried' && (
              <FormField label="Weekly rate ($)">
                <FormInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={operational.weekly_rate ?? ''}
                  onChange={e => setOperational(o => ({ ...o, weekly_rate: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="0.00"
                />
              </FormField>
            )}
            {submission.employee_type === 'contractor' && (
              <FormField label="Rate ($)" helperText="Hourly or weekly">
                <FormInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={operational.hourly_rate ?? ''}
                  onChange={e => setOperational(o => ({ ...o, hourly_rate: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="0.00"
                />
              </FormField>
            )}
            <FormField label="Trade / Department">
              <FormInput
                value={operational.trade ?? ''}
                onChange={e => setOperational(o => ({ ...o, trade: e.target.value || null }))}
                placeholder="e.g. Plumbing, HVAC"
              />
            </FormField>
          </div>

          <FormField label="Workyard ID (optional)">
            <FormInput
              value={operational.workyard_id ?? ''}
              onChange={e => setOperational(o => ({ ...o, workyard_id: e.target.value || null }))}
            />
          </FormField>

          <div className="flex flex-wrap gap-4 mb-4">
            {([
              ['ot_allowed', 'OT Allowed'],
              ['pay_tax', 'Payroll Tax (8%)'],
              ['wc', "Workers' Comp (3%)"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={operational[key] ?? false}
                  onChange={e => setOperational(o => ({ ...o, [key]: e.target.checked }))}
                  className="w-4 h-4 border border-[var(--border)] rounded-none
                    checked:bg-[var(--primary)] checked:border-[var(--primary)]"
                />
                <span className="text-sm text-[var(--ink)]">{label}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {isAdmin && (
        <>
          <SectionDivider label="Admin Notes" />
          <FormField label="Notes">
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-none
                bg-[var(--bg-input)] text-sm text-[var(--ink)] resize-y
                focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20"
              placeholder={isPending ? 'Optional notes for your records' : 'Required when rejecting or requesting correction'}
            />
          </FormField>
        </>
      )}

      {submission.admin_notes && !isAdmin && (
        <>
          <SectionDivider label="Notes" />
          <p className="text-sm text-[var(--ink)]">{submission.admin_notes}</p>
        </>
      )}

      {isAdmin && isPending && (
        <div className="flex gap-2 pt-4 border-t border-[var(--divider)] mt-2">
          <FormButton onClick={handleApprove} loading={saving} className="flex-1">
            Approve &amp; Create Employee
          </FormButton>
          <FormButton variant="secondary" onClick={handleRequestCorrection} loading={saving}>
            Request Correction
          </FormButton>
          <FormButton variant="danger" onClick={handleReject} loading={saving}>
            Reject
          </FormButton>
        </div>
      )}
    </Drawer>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OnboardingAdminPage() {
  const { isAdmin } = useAuth()
  const { invitations, loading: invLoading, createInvitation, getOnboardingUrl, refetch: refetchInv } = useOnboardingInvitations()
  const { submissions, loading: subLoading, approveSubmission, rejectSubmission, requestCorrection, getSignedUrl, refetch: refetchSub } = useOnboardingSubmissions()

  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [reviewDrawer, setReviewDrawer] = useState<OnboardingSubmission | null>(null)
  const [tab, setTab] = useState<'submissions' | 'invitations'>('submissions')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const handleCopyLink = useCallback((token: string) => {
    navigator.clipboard.writeText(getOnboardingUrl(token))
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }, [getOnboardingUrl])

  const filteredSubmissions = statusFilter === 'all'
    ? submissions
    : submissions.filter(s => s.status === statusFilter)

  const pendingCount = submissions.filter(s => s.status === 'pending').length
  const correctionCount = submissions.filter(s => s.status === 'needs_correction').length

  return (
    <div>
      <PageHeader
        title="Employee Onboarding"
        subtitle="Manage onboarding invitations and review submitted forms"
        actions={
          isAdmin ? (
            <FormButton size="sm" onClick={() => setCreateDrawerOpen(true)}>
              <Plus size={14} className="mr-1" />
              New Invitation
            </FormButton>
          ) : undefined
        }
      />

      {/* Stats strip */}
      <div className="px-6 py-3 border-b border-[var(--divider)] flex gap-6 bg-[var(--bg-section)]">
        {[
          { label: 'Pending Review', count: pendingCount, highlight: pendingCount > 0 },
          { label: 'Needs Correction', count: correctionCount, highlight: correctionCount > 0 },
          { label: 'Total Submissions', count: submissions.length, highlight: false },
          { label: 'Active Invitations', count: invitations.filter(i => !i.completed_at && new Date(i.expires_at) > new Date()).length, highlight: false },
        ].map(s => (
          <div key={s.label}>
            <p className={`text-lg font-semibold ${s.highlight ? 'text-[var(--warning)]' : 'text-[var(--primary)]'}`}>{s.count}</p>
            <p className="text-xs text-[var(--muted)]">{s.label}</p>
          </div>
        ))}
        <button onClick={() => { refetchInv(); refetchSub() }} className="ml-auto text-[var(--muted)] hover:text-[var(--ink)] p-1">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-[var(--divider)] flex gap-0">
        {(['submissions', 'invitations'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm border-b-2 transition-colors capitalize ${
              tab === t
                ? 'border-[var(--primary)] text-[var(--primary)] font-medium'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {t === 'submissions' ? 'Submissions' : 'Invitations'}
            {t === 'submissions' && pendingCount > 0 && (
              <span className="ml-1.5 bg-[var(--warning)] text-white text-xs rounded-full px-1.5 py-0.5">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="px-6 py-4">
        {/* Submissions tab */}
        {tab === 'submissions' && (
          <>
            {/* Filter */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-[var(--muted)]">Filter:</span>
              {['all', 'pending', 'needs_correction', 'approved', 'rejected'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1 border transition-colors ${
                    statusFilter === s
                      ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                      : 'text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'
                  }`}
                >
                  {s === 'all' ? 'All' : statusLabelMap[s] ?? s}
                </button>
              ))}
            </div>

            {subLoading ? (
              <p className="text-sm text-[var(--muted)] py-8 text-center">Loading submissions…</p>
            ) : filteredSubmissions.length === 0 ? (
              <p className="text-sm text-[var(--muted)] py-8 text-center">No submissions yet.</p>
            ) : (
              <div className="border border-[var(--divider)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--bg-section)] border-b border-[var(--divider)]">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Name</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Email</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Submitted</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Lang</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubmissions.map(sub => (
                      <tr
                        key={sub.id}
                        className="border-b border-[var(--divider)] hover:bg-[var(--bg-section)] cursor-pointer transition-colors"
                        onClick={() => setReviewDrawer(sub)}
                      >
                        <td className="px-4 py-3 font-medium text-[var(--ink)]">
                          {sub.full_name}
                          {sub.filled_by_helper && (
                            <span className="ml-1.5 text-xs text-[var(--accent)]">via helper</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">{sub.email}</td>
                        <td className="px-4 py-3 capitalize text-[var(--muted)]">{sub.employee_type}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={sub.status} label={statusLabelMap[sub.status]} />
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {format(new Date(sub.submitted_at), 'MMM d, yyyy')}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)] uppercase text-xs">{sub.language}</td>
                        <td className="px-4 py-3">
                          <ChevronDown size={14} className="text-[var(--muted)] -rotate-90" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Invitations tab */}
        {tab === 'invitations' && (
          <>
            {invLoading ? (
              <p className="text-sm text-[var(--muted)] py-8 text-center">Loading invitations…</p>
            ) : invitations.length === 0 ? (
              <p className="text-sm text-[var(--muted)] py-8 text-center">No invitations yet. Create one above.</p>
            ) : (
              <div className="border border-[var(--divider)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--bg-section)] border-b border-[var(--divider)]">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Email</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Name</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Expires</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map(inv => {
                      const expired = new Date(inv.expires_at) < new Date()
                      const completed = !!inv.completed_at
                      const status = completed ? 'completed' : expired ? 'expired' : 'active'
                      return (
                        <tr key={inv.id} className="border-b border-[var(--divider)] hover:bg-[var(--bg-section)] transition-colors">
                          <td className="px-4 py-3 text-[var(--ink)]">{inv.email}</td>
                          <td className="px-4 py-3 text-[var(--muted)]">{inv.full_name ?? '—'}</td>
                          <td className="px-4 py-3 capitalize text-[var(--muted)]">{inv.employee_type}</td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              status={status}
                              label={status === 'completed' ? 'Completed' : status === 'expired' ? 'Expired' : 'Active'}
                            />
                          </td>
                          <td className="px-4 py-3 text-[var(--muted)]">
                            {format(new Date(inv.expires_at), 'MMM d')}
                          </td>
                          <td className="px-4 py-3 text-[var(--muted)]">
                            {format(new Date(inv.created_at), 'MMM d')}
                          </td>
                          <td className="px-4 py-3">
                            {!completed && isAdmin && (
                              <button
                                onClick={() => handleCopyLink(inv.token)}
                                className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                              >
                                {copiedToken === inv.token ? <Check size={12} /> : <Copy size={12} />}
                                {copiedToken === inv.token ? 'Copied' : 'Copy link'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <CreateInvitationDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        getOnboardingUrl={getOnboardingUrl}
        createInvitation={createInvitation}
      />

      <SubmissionReviewDrawer
        open={!!reviewDrawer}
        onClose={() => setReviewDrawer(null)}
        submission={reviewDrawer}
        approveSubmission={approveSubmission}
        rejectSubmission={rejectSubmission}
        requestCorrection={requestCorrection}
        getSignedUrl={getSignedUrl}
        isAdmin={isAdmin}
      />
    </div>
  )
}
