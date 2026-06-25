'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useDashboard } from '@/components/DashboardContext'
import { User, Building2, Mail, Lock, LogOut, Save, CheckCircle, AlertTriangle, Trash2, Loader2 } from 'lucide-react'

export default function ProfilePage() {
  const router = useRouter()
  const { email } = useDashboard()

  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        setFullName(d.full_name || '')
        setCompany(d.company || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const saveProfile = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, company }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Errore')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setPwError('La password deve avere almeno 6 caratteri')
      return
    }
    setPwLoading(true)
    setPwError(null)
    setPwMsg(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwMsg('Password aggiornata con successo')
      setOldPassword('')
      setNewPassword('')
      setTimeout(() => setPwMsg(null), 3000)
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setPwLoading(false)
    }
  }

  const onLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const deleteAccount = async () => {
    if (deleteConfirmText !== 'ELIMINA') {
      setDeleteError('Devi scrivere ELIMINA per confermare.')
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/profile/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'ELIMINA' }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok) {
        setDeleteError(data?.error || 'Errore eliminazione account.')
        return
      }
      // Account eliminato → logout e redirect home
      const supabase = createClient()
      try {
        await supabase.auth.signOut()
      } catch {
        /* ignora: l'utente è già cancellato server-side */
      }
      router.push('/login?deleted=1')
      router.refresh()
    } catch (e: any) {
      setDeleteError(e?.message || 'Errore di rete.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Profilo</h1>
        <p className="text-sm text-slate-500 mt-1">Gestisci le tue informazioni personali e la sicurezza</p>
      </div>

      {/* Info personali */}
      <Card className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
          Informazioni personali
        </h2>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-10 bg-slate-100 rounded-lg" />
            <div className="h-10 bg-slate-100 rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Email</label>
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <Mail className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                <span className="text-sm text-slate-600">{email}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Nome completo</label>
              <Input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Mario Rossi"
                className="h-10 rounded-lg border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Azienda</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" strokeWidth={1.75} />
                <Input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="La mia agenzia"
                  className="h-10 rounded-lg border-slate-200 pl-10 focus-visible:ring-1 focus-visible:ring-slate-900"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            {saved && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.75} /> Profilo salvato
              </p>
            )}

            <Button
              onClick={saveProfile}
              disabled={saving}
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-md font-medium"
            >
              <Save className="w-4 h-4 mr-2" strokeWidth={1.75} />
              {saving ? 'Salvataggio...' : 'Salva modifiche'}
            </Button>
          </div>
        )}
      </Card>

      {/* Cambio password */}
      <Card className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
          Cambia password
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Nuova password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Almeno 6 caratteri"
              className="h-10 rounded-lg border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
            />
          </div>

          {pwError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwError}</p>
          )}

          {pwMsg && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.75} /> {pwMsg}
            </p>
          )}

          <Button
            onClick={changePassword}
            disabled={pwLoading || !newPassword}
            variant="outline"
            className="rounded-md border-slate-200"
          >
            {pwLoading ? 'Aggiornamento...' : 'Aggiorna password'}
          </Button>
        </div>
      </Card>

      {/* Logout */}
      <Card className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Esci dal tuo account</h2>
            <p className="text-xs text-slate-500 mt-0.5">Verrai reindirizzato alla pagina di login</p>
          </div>
          <Button variant="outline" onClick={onLogout} className="rounded-md border-slate-200">
            <LogOut className="w-4 h-4 mr-2" strokeWidth={1.75} />
            Logout
          </Button>
        </div>
      </Card>

      {/* Danger Zone — GDPR right to erasure */}
      <Card className="bg-red-50/40 border border-red-200 rounded-lg p-6">
        <h2 className="text-base font-semibold text-red-900 mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" strokeWidth={1.75} />
          Zona pericolo
        </h2>
        <p className="text-xs text-red-700/80 mb-4">
          L’eliminazione dell’account è <strong>definitiva</strong>. Verranno rimossi: liste,
          ambienti, pipeline, integrazioni CRM, cronologia ricerche e l’accesso. I dati di
          fatturazione vengono conservati solo per gli obblighi di legge.
        </p>

        {!showDeleteConfirm ? (
          <Button
            variant="outline"
            onClick={() => {
              setShowDeleteConfirm(true)
              setDeleteConfirmText('')
              setDeleteError(null)
            }}
            className="rounded-md border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
          >
            <Trash2 className="w-4 h-4 mr-2" strokeWidth={1.75} />
            Elimina account
          </Button>
        ) : (
          <div className="space-y-3 bg-white rounded-lg border border-red-200 p-4">
            <p className="text-sm text-slate-800">
              Per confermare scrivi <strong className="text-red-700">ELIMINA</strong> qui sotto.
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => {
                setDeleteConfirmText(e.target.value)
                if (deleteError) setDeleteError(null)
              }}
              placeholder="ELIMINA"
              className="h-10 rounded-lg border-red-200 focus-visible:ring-1 focus-visible:ring-red-400"
              autoCapitalize="characters"
              autoComplete="off"
            />
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="destructive"
                onClick={deleteAccount}
                disabled={deleting || deleteConfirmText !== 'ELIMINA'}
                className="rounded-md"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" strokeWidth={1.75} /> Eliminazione…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" strokeWidth={1.75} /> Conferma eliminazione
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setDeleteConfirmText('')
                  setDeleteError(null)
                }}
                disabled={deleting}
                className="rounded-md"
              >
                Annulla
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
