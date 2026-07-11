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
  plugins: [svelte(), topojson()],
})
