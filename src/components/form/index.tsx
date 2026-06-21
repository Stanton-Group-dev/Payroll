'use client'

import React from 'react'

// FormField
export function FormField({
  label,
  required,
  helperText,
  error,
  children,
}: {
  label: string
  required?: boolean
  helperText?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-[var(--ink)] mb-1">
        {label}
        {required && <span className="text-[var(--error)] ml-0.5">*</span>}
      </label>
      {children}
      {helperText && !error && <p className="mt-1 text-xs text-[var(--muted)]">{helperText}</p>}
      {error && <p className="mt-1 text-xs text-[var(--error)]">{error}</p>}
    </div>
  )
}

// FormInput
export function FormInput({
  error,
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 border ${error ? 'border-[var(--error)]' : 'border-[var(--border)]'} rounded-none
        bg-[var(--bg-input)] text-[var(--ink)] text-sm placeholder:text-[var(--muted)]
        focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20
        disabled:bg-[var(--bg-section)] disabled:cursor-not-allowed
        transition-colors duration-200 ${className}`}
    />
  )
}

// FormSelect
export function FormSelect({
  error,
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 border ${error ? 'border-[var(--error)]' : 'border-[var(--border)]'} rounded-none
        bg-[var(--bg-input)] text-[var(--ink)] text-sm
        focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20
        disabled:bg-[var(--bg-section)] disabled:cursor-not-allowed
        transition-colors duration-200 ${className}`}
    >
      {children}
    </select>
  )
}

// FormTextarea
export function FormTextarea({
  error,
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2 border ${error ? 'border-[var(--error)]' : 'border-[var(--border)]'} rounded-none
        bg-[var(--bg-input)] text-[var(--ink)] text-sm placeholder:text-[var(--muted)]
        focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20
        transition-colors duration-200 resize-y ${className}`}
    />
  )
}

// FormButton
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--primary)] text-white border-[var(--primary)] hover:bg-[var(--primary-light)]',
  secondary: 'bg-transparent text-[var(--primary)] border-[var(--primary)] hover:bg-[var(--primary)] hover:text-white',
  danger: 'bg-[var(--error)] text-white border-[var(--error)] hover:opacity-90',
  ghost: 'bg-transparent text-[var(--muted)] border-transparent hover:text-[var(--ink)] hover:bg-[var(--bg-section)]',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function FormButton({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
}) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`
        ${sizeStyles[size]} ${variantStyles[variant]}
        border-2 rounded-none font-medium
        focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-200
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {children}
        </span>
      ) : children}
    </button>
  )
}

// Toggle — accessible on/off switch styled with the app's design tokens.
export function Toggle({
  on, disabled, onChange, label,
}: { on: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// StatusBadge
const statusColors: Record<string, string> = {
  draft: 'bg-[var(--muted)]/15 text-[var(--muted)]',
  corrections_complete: 'bg-[var(--primary)]/10 text-[var(--primary)]',
  payroll_approved: 'bg-[var(--success)]/10 text-[var(--success)]',
  invoiced: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  statement_sent: 'bg-[var(--success)]/10 text-[var(--success)]',
  approved: 'bg-[var(--success)]/10 text-[var(--success)]',
  sent: 'bg-[var(--primary)]/10 text-[var(--primary)]',
  active: 'bg-[var(--success)]/10 text-[var(--success)]',
  inactive: 'bg-[var(--muted)]/15 text-[var(--muted)]',
  flagged: 'bg-[var(--warning)]/15 text-[var(--warning)]',
  resolved: 'bg-[var(--success)]/10 text-[var(--success)]',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const colorClass = statusColors[status] ?? 'bg-[var(--muted)]/15 text-[var(--muted)]'
  const display = label ?? status.replace(/_/g, ' ')
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${colorClass}`}>
      {display}
    </span>
  )
}

// PageHeader
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between px-6 py-5 border-b border-[var(--divider)] bg-[var(--bg-section)]">
      <div>
        <h1 className="font-serif text-2xl text-[var(--primary)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--muted)] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 ml-4">{actions}</div>}
    </div>
  )
}

// Drawer / Modal overlay
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div
        className="absolute right-0 top-0 bottom-0 bg-white shadow-xl flex flex-col"
        style={{ width }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--divider)]">
          <h2 className="font-serif text-lg text-[var(--primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// SectionDivider
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative py-4 mb-4">
      <div className="absolute left-0 top-1/2 w-full h-px bg-[var(--divider)]" />
      <span className="relative inline-block bg-white pr-3 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

// InfoBlock
export function InfoBlock({
  variant = 'default',
  title,
  children,
}: {
  variant?: 'default' | 'warning' | 'error' | 'success'
  title?: string
  children: React.ReactNode
}) {
  const styles = {
    default: 'border-l-4 border-[var(--accent)] bg-[var(--bg-section)]',
    warning: 'border-l-4 border-[var(--warning)] bg-[var(--warning)]/5',
    error: 'border-l-4 border-[var(--error)] bg-[var(--error)]/5',
    success: 'border-l-4 border-[var(--success)] bg-[var(--success)]/5',
  }
  return (
    <div className={`${styles[variant]} p-4 my-3`}>
      {title && <p className="font-medium text-sm text-[var(--ink)] mb-1">{title}</p>}
      <div className="text-sm text-[var(--ink)]">{children}</div>
    </div>
  )
}
