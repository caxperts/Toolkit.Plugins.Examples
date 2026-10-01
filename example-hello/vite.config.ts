import { defineConfig } from 'vite'
import { toolkitPlugin } from '@caxperts/toolkit-plugin-sdk/vite'

// The whole build. The preset applies the ESM lib build, externalisation of every shared specifier,
// the CSS scope prefixer, the dev proxy, and the guards that turn four always-wrong imports into
// build errors.
//
// It does NOT apply @vitejs/plugin-react, and does not need to: Vite's oxc transform handles .tsx on
// its own, and tsconfig.json pins `"jsx": "react-jsx"` so the automatic runtime is what gets emitted.
// There is no plugin dev server to Fast-Refresh — the host serves the built bundle from
// /api/plugin-assets/ — so the dev loop is `npm run dev` (build --watch), re-stage, reload.
// No `id` argument: the preset reads it from the plugin.json next to this file, so the id is spelled
// once on the frontend side rather than twice. Pass `{ id }` if your manifest lives elsewhere.
export default defineConfig({
  plugins: [toolkitPlugin()],
})
