import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Vite's built-in JSON handling only recognizes .json/.json5 -- .topojson
// (PLAN.md Sec3) is JSON too, just a domain-specific extension for it.
function topojson(): Plugin {
  return {
    name: 'topojson-as-json',
    transform(code, id) {
      if (!id.endsWith('.topojson')) return
      return { code: `export default ${code}`, map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, not absolute /assets/... -- PLAN.md's "quick
  // peek" fallback row claims dist/ is double-click-openable via file://
  // with no server at all, which absolute paths silently break (they
  // resolve against the filesystem root, not the html file's own
  // folder). Harmless for the real field-day path too (served from
  // localhost's root either way), so this is a pure win, not a tradeoff.
  base: './',
  plugins: [svelte(), topojson()],
})
