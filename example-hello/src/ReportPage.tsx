import { useNavigate, useParams } from 'react-router'
import { useT } from '@caxperts/toolkit-plugin-sdk'

/** A second route, showing that params and relative navigation work as they do in the host. */
export function ReportPage() {
  const t = useT()
  const navigate = useNavigate()
  const { reportId } = useParams<{ reportId: string }>()

  return (
    <div className="hello-page">
      <h2 className="hello-title">
        {t('Report')} #{reportId}
      </h2>
      <button type="button" className="hello-button" onClick={() => navigate('..')}>
        {t('Hello World')}
      </button>
    </div>
  )
}
