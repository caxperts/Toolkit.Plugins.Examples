import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import DataGrid, { Column } from '@caxperts/toolkit-plugin-sdk/ui/data-grid'
import { toast, useAuth, usePluginApi, useT, useTheme } from '@caxperts/toolkit-plugin-sdk'

interface Greeting {
  id: number
  message: string
  createdByEmail: string
  createdAtUtc: string
}

interface GreetingsResponse {
  data: { greetings: Greeting[]; hostPageCount: number }
}

/** Module-level so the empty case does not hand the grid a new array on every render. */
const NO_ROWS: readonly Greeting[] = []

/**
 * Exercises every inherited capability, so this doubles as the living style guide: host React hooks,
 * the host's router, the host's DevExtreme (no watermark), auth, i18n, toasts, authenticated HTTP —
 * and the plugin's OWN backend, which reads and writes its own `plg_hello` schema.
 *
 * Note what is NOT here: no colours. Every rule in hello.css uses the host's theme variables, so this
 * page is readable in Dark and Vienna without a single conditional.
 */
export function HelloPage() {
  const t = useT()
  const { user, isAuthenticated } = useAuth()
  const { isVienna } = useTheme()
  const navigate = useNavigate()

  /*
   * The plugin's own API. The host's route convention forces every plugin controller under
   * `api/plugins/{id}/`, so the prefix is not a choice this plugin makes — and writing it out by hand
   * was the one place the id was duplicated where a mistake is neither a build nor an install error,
   * just a 404 in the browser. `api.http` takes paths relative to that prefix; it still accepts a full
   * `/api/…` path, so calling another part of the product needs nothing else.
   */
  const api = usePluginApi()

  const [rows, setRows] = useState<readonly Greeting[]>(NO_ROWS)
  const [hostPageCount, setHostPageCount] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  // Three separate flags rather than one "busy": the user needs to know whether the list is arriving,
  // whether their own submission is in flight, and whether the first load has finished at all —
  // "empty" and "not loaded yet" must not look the same.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // `t` and `api` are both memoised by the SDK, so this callback is stable and the effect below runs
  // once. That is why they can appear in a dependency array at all.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.http.get<GreetingsResponse>('greetings')
      setRows(response.data.greetings)
      setHostPageCount(response.data.hostPageCount)
      setLoadFailed(false)
    } catch {
      // Surfaced, never swallowed: without this the grid would just sit empty and look like "no data".
      setLoadFailed(true)
      toast.error(t('Could not load greetings'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
  }, [load])

  const add = useCallback(async () => {
    const message = draft.trim()
    if (message.length === 0) return

    setSaving(true)
    try {
      await api.http.post('greetings', { message })
      setDraft('')
      toast.success(t('Greeting added'))
      await load()
    } catch {
      toast.error(t('Could not save the greeting'))
    } finally {
      setSaving(false)
    }
  }, [api, draft, load, t])

  const remove = useCallback(
    async (id: number) => {
      setSaving(true)
      try {
        // Numbers are accepted as segments, so no template string and no hand-built URL.
        await api.http.delete(api.path('greetings', id))
        toast.success(t('Greeting deleted'))
        await load()
      } catch {
        toast.error(t('Could not delete the greeting'))
      } finally {
        setSaving(false)
      }
    },
    [api, load, t],
  )

  // Stable reference: DevExtreme re-initialises on a new dataSource, and an array built inline in JSX
  // would produce one on every render. This is the most common DataGrid bug in this codebase.
  const dataSource = useMemo(() => rows.map(row => ({ ...row })), [rows])

  return (
    // Vienna inverts some surfaces, so branch on isVienna and add a class rather than hardcoding.
    <div className={`hello-page${isVienna ? ' hello-page-vienna' : ''}`}>
      <h2 className="hello-title">{t('Hello World')}</h2>

      <p className="hello-line">
        {t('Signed in as')}: <strong>{isAuthenticated ? user?.email : '—'}</strong>
      </p>
      <p className="hello-line">
        {t('Groups')}: <strong>{user?.groups?.length ? user.groups.join(', ') : '—'}</strong>
      </p>
      <p className="hello-line">
        {t('Theme')}: <strong>{isVienna ? 'Vienna' : 'Dark'}</strong>
      </p>

      <div className="hello-actions">
        {/* The host's own router instance: this navigates without a full page load. */}
        <button type="button" className="hello-button" onClick={() => navigate('report/42')}>
          {t('Open the report')}
        </button>
        <button type="button" className="hello-button" onClick={() => void load()} disabled={loading}>
          {t('Refresh')}
        </button>
      </div>

      <h3 className="hello-title">{t('Greetings')}</h3>

      {/* Writes go to the plugin's own table. The owner is taken from the host's ICurrentUser on the
          server — never sent from here — so one user cannot write rows as another. */}
      <div className="hello-actions">
        <input
          className="hello-input"
          type="text"
          value={draft}
          maxLength={400}
          placeholder={t('Message')}
          aria-label={t('Message')}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void add()
          }}
        />
        <button
          type="button"
          className="hello-button"
          onClick={() => void add()}
          disabled={saving || draft.trim().length === 0}
        >
          {saving ? '…' : t('Add greeting')}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="hello-line">{t('Loading...')}</p>
      ) : loadFailed ? (
        <p className="hello-line" role="alert">
          {t('Could not load greetings')}
        </p>
      ) : rows.length === 0 ? (
        <p className="hello-line">{t('No greetings yet')}</p>
      ) : (
        /* The host's DevExtreme instance, so the licence key applies and there is no watermark. */
        <div className="hello-grid">
          <DataGrid dataSource={dataSource} keyExpr="id" showBorders>
            <Column dataField="message" caption={t('Message')} />
            <Column
              dataField="createdAtUtc"
              caption={t('Created')}
              dataType="datetime"
              width={160}
            />
            <Column
              caption=""
              width={90}
              alignment="center"
              allowSorting={false}
              cellRender={cell => (
                <button
                  type="button"
                  className="hello-button hello-button-subtle"
                  disabled={saving}
                  onClick={() => void remove((cell.data as Greeting).id)}
                >
                  {t('Delete')}
                </button>
              )}
            />
          </DataGrid>
        </div>
      )}

      {/* Proof that a plugin can read the HOST's model through ToolkitDbContext, not only its own. */}
      {hostPageCount !== null && (
        <p className="hello-line">
          <small>host PageAccess rows: {hostPageCount}</small>
        </p>
      )}
    </div>
  )
}
