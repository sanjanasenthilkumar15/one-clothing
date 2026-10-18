import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAdminAuthStore } from '../store/store'

const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#111111]'

function PasswordField({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} autoComplete={autoComplete} className={`${inputClass} pr-10`} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} required />
      <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#111111] cursor-pointer">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const role = useAdminAuthStore(s => s.role)
  const adminId = useAdminAuthStore(s => s.adminId) || ''
  const [target, setTarget] = useState<'self' | 'staff'>('self')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 6) return setMsg({ ok: false, text: 'New password must be at least 6 characters.' })
    if (next !== confirm) return setMsg({ ok: false, text: 'New passwords do not match.' })
    setBusy(true); setMsg(null)
    const { data, error } = target === 'staff'
      ? await supabase.rpc('portal_reset_staff_password', { p_admin_id: adminId, p_admin_password: current, p_new: next })
      : await supabase.rpc('portal_change_password', { p_id: adminId, p_old: current, p_new: next })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: 'Password change is not set up yet (run migration 0027).' })
    if (!data) return setMsg({ ok: false, text: 'Current password is incorrect.' })
    setMsg({ ok: true, text: target === 'staff' ? 'Staff password updated.' : 'Password updated. Use it next time you log in.' })
    setCurrent(''); setNext(''); setConfirm('')
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-3xl border border-[#DDD2BE] bg-white p-6 shadow-2xl text-[#111111]">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black">Change Password</h3>
          <button type="button" onClick={onClose} className="rounded-full bg-gray-100 p-1.5 cursor-pointer"><X size={16} /></button>
        </div>
        {role === 'admin' && (
          <div className="flex gap-2 text-xs font-black">
            {(['self', 'staff'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTarget(t)}
                className={`flex-1 rounded-lg px-3 py-2 cursor-pointer ${target === t ? 'bg-[#111111] text-[#C9B79C]' : 'bg-slate-100 text-gray-600'}`}>
                {t === 'self' ? 'My password' : 'Staff password'}
              </button>
            ))}
          </div>
        )}
        <PasswordField autoComplete="current-password" value={current} onChange={setCurrent} placeholder={target === 'staff' ? 'Your admin password (not the staff one)' : 'Current password'} />
        <PasswordField autoComplete="new-password" value={next} onChange={setNext} placeholder={target === 'staff' ? 'New staff password (min 6 characters)' : 'New password (min 6 characters)'} />
        <PasswordField autoComplete="new-password" value={confirm} onChange={setConfirm} placeholder="Confirm new password" />
        {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-2.5 text-sm font-black text-[#C9B79C] disabled:opacity-60 cursor-pointer">
          {busy ? 'Saving...' : 'Update Password'}
        </button>
      </form>
    </div>,
    document.body,
  )
}
