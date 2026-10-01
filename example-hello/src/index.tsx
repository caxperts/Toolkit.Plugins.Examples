import { definePlugin, PLUGIN_API_VERSION } from '@caxperts/toolkit-plugin-sdk'
import { HelloPage } from './HelloPage'
import { ReportPage } from './ReportPage'
import './hello.css'

/**
 * Every import in this file and its children is either the SDK or a bare shared specifier. There is
 * no react, react-dom or devextreme dependency in package.json — that is the point: the host
 * supplies all three at runtime, so this bundle is a few kilobytes and can never ship a second copy.
 */
export default definePlugin({
  id: 'hello',
  name: 'Hello World',
  apiVersion: PLUGIN_API_VERSION,
  routes: [
    { path: '', element: <HelloPage /> },
    // Route params work exactly as in the host's own route table.
    { path: 'report/:reportId', element: <ReportPage /> },
  ],
  menu: [{ path: '', label: 'hello.Hello World', icon: 'extension', section: 'nav', order: 50 }],
})
