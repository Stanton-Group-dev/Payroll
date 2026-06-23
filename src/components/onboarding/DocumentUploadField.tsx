'use client'

import { useState, useRef } from 'react'
import { Camera, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

interface DocumentUploadFieldProps {
  label: string
  labelEs: string
  helperText?: string
  helperTextEs?: string
  language: 'en' | 'es'
  value: string // stored path
  onUpload: (file: File, documentType: string) => Promise<void>
  documentType: string
  required?: boolean
  error?: string
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const COMPRESS_THRESHOLD = 2 * 1024 * 1024 // 2MB

async function compressImage(file: File): Promise<File> {
  if (file.size <= COMPRESS_THRESHOLD) return file
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const maxDim = 2000
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height / width) * maxDim); width = maxDim }
        else { width = Math.round((width / height) * maxDim); height = maxDim }
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Compression failed')); return }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.82)
    }
    img.onerror = reject
    img.src = url
  })
}

async function convertHeicToJpeg(file: File): Promise<File> {
  // Most iOS browsers (Safari, Chrome on iOS 17+) automatically convert HEIC to JPEG
  // when using capture="environment", so no explicit conversion is needed for most cases.
  // Future enhancement: install heic2any package and add conversion here.
  return file
}

export function DocumentUploadField({
  label, labelEs, helperText, helperTextEs, language,
  value, onUpload, documentType, required, error,
}: DocumentUploadFieldProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const displayLabel = language === 'es' ? labelEs : label
  const displayHelper = language === 'es' ? helperTextEs : helperText

  const errorMsg = {
    en: { size: 'File too large (max 10MB)', type: 'Please upload an image (JPG, PNG, HEIC)', failed: 'Upload failed. Tap to retry.' },
    es: { size: 'Archivo muy grande (máx 10MB)', type: 'Sube una imagen (JPG, PNG, HEIC)', failed: 'Error al subir. Toca para reintentar.' },
  }[language]

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_SIZE_BYTES) {
      setUploadError(errorMsg.size)
      setStatus('error')
      return
    }
    if (!file.type.startsWith('image/') && !file.name.match(/\.(jpg|jpeg|png|heic|heif)$/i)) {
      setUploadError(errorMsg.type)
      setStatus('error')
      return
    }

    setStatus('uploading')
    setUploadError(null)
    const previewUrl = URL.createObjectURL(file)
    setPreview(previewUrl)

    let retries = 3
    while (retries > 0) {
      try {
        let processed = await convertHeicToJpeg(file)
        processed = await compressImage(processed)
        await onUpload(processed, documentType)
        setStatus('done')
        return
      } catch {
        retries--
        if (retries > 0) await new Promise(r => setTimeout(r, 1000 * (4 - retries)))
      }
    }
    setStatus('error')
    setUploadError(errorMsg.failed)
  }

  const handleRetry = () => {
    setStatus('idle')
    setUploadError(null)
    setAttempt(a => a + 1)
    if (inputRef.current) inputRef.current.value = ''
  }

  const isDone = status === 'done' || (status === 'idle' && !!value)

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-[var(--ink)] mb-1">
        {displayLabel}
        {required && <span className="text-[var(--error)] ml-0.5">*</span>}
      </label>

      <div
        className={`relative border-2 transition-colors duration-150 ${
          isDone ? 'border-[var(--success)]/40 bg-[var(--success)]/5'
          : status === 'error' ? 'border-[var(--error)]/50 bg-[var(--error)]/5'
          : 'border-dashed border-[var(--border)] bg-[var(--bg-input)] hover:border-[var(--primary)]'
        }`}
      >
        <input
          key={attempt}
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          capture="environment"
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={status === 'uploading'}
        />

        <div className="flex flex-col items-center justify-center py-6 px-4 text-center min-h-[100px]">
          {status === 'uploading' && (
            <>
              {preview && <img src={preview} alt="" className="h-16 w-16 object-cover mb-2 opacity-60" />}
              <Loader2 size={20} className="animate-spin text-[var(--primary)] mb-1" />
              <p className="text-xs text-[var(--muted)]">{language === 'es' ? 'Subiendo...' : 'Uploading...'}</p>
            </>
          )}
          {isDone && (
            <>
              {preview && <img src={preview} alt="" className="h-16 w-16 object-cover mb-2" />}
              <CheckCircle size={20} className="text-[var(--success)] mb-1" />
              <p className="text-xs text-[var(--success)] font-medium">
                {language === 'es' ? 'Foto guardada ✓' : 'Photo saved ✓'}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {language === 'es' ? 'Toca para cambiar' : 'Tap to replace'}
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertCircle size={20} className="text-[var(--error)] mb-1" />
              <p className="text-xs text-[var(--error)]">{uploadError}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-2 flex items-center gap-1 text-xs text-[var(--primary)] underline"
              >
                <RefreshCw size={12} /> {language === 'es' ? 'Reintentar' : 'Retry'}
              </button>
            </>
          )}
          {status === 'idle' && !value && (
            <>
              <Camera size={24} className="text-[var(--muted)] mb-2" />
              <p className="text-sm text-[var(--ink)] font-medium">
                {language === 'es' ? 'Tomar foto o subir imagen' : 'Take photo or upload image'}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">JPG, PNG, HEIC</p>
            </>
          )}
        </div>
      </div>

      {displayHelper && !isDone && (
        <p className="mt-1 text-xs text-[var(--muted)]">{displayHelper}</p>
      )}
      {(error || uploadError) && status !== 'error' && (
        <p className="mt-1 text-xs text-[var(--error)]">{error || uploadError}</p>
      )}
    </div>
  )
}
