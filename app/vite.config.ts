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

// Vite's HTML generation always writes type="module" on the entry
// <script> for a normal (non-library-mode) build, regardless of
// build.rollupOptions.output.format -- even though the bundle itself IS
// a genuine classic-script-compatible IIFE with that format set
// (verified: no top-level import/export, wrapped in an IIFE). A module
// script is exactly what Chrome refuses to fetch/execute from a
// file:// origin at all (a restriction on the *origin*, unrelated to
// path format -- base: './' alone didn't fix the blank-page bug report),
// so this strips the attribute Vite insists on adding, matching what
// the bundle already actually is.
//
// defer is added back in its place (bug report: blank page even over a
// real localhost server, no console error surfaced) -- module scripts
// are deferred by the HTML spec automatically (execute only after the
// document is parsed), but plain classic <script> in <head> is NOT: it
// runs immediately, before <body><div id="app"> has even been parsed
// yet, so main.ts's document.getElementById('app') returned null and
// mount() had nothing to attach to. defer restores the "run after
// parsing" timing without needing type="module" itself.
//
// Production build ONLY (bug report: dev server -- `npm run dev` --
// went blank too, with no console error). transformIndexHtml runs for
// BOTH `vite build` and `vite dev`/serve, and Vite's dev server's own
// injected entry script genuinely needs to stay a real ES module --
// that's how it wires up HMR and per-file on-demand transformation.
// Stripping type="module" there breaks module resolution entirely
// (main.ts's own `import` statements become a syntax error in a
// classic-script context), which is a silent, uncaught parse-time
// failure -- consistent with the reported "nothing mounts, no console
// error" symptom. configResolved's command ('build' vs 'serve') is the
// correct way to tell these apart; only the production build's bundle
// is actually IIFE-format and file://-safe to rewrite this way.
function classicScriptHtml(): Plugin {
  let isBuild = false
  return {
    name: 'classic-script-html',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      if (!isBuild) return html
      return html.replace(/<script type="module"( crossorigin)?/g, '<script defer')
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
  plugins: [svelte(), topojson(), classicScriptHtml()],
  build: {
    rollupOptions: {
      output: {
        // IIFE, not Vite's default ES-module output -- base: './' alone
        // wasn't enough to make dist/index.html work via file:// (bug
        // report: blank white page). The actual blocker is
        // `<script type="module">` itself: Chrome refuses to fetch/
        // execute module scripts loaded from a file:// origin at all
        // (a CORS restriction on the origin, unrelated to the path
        // format) -- the HTML shell renders, but the script that mounts
        // the Svelte app into #app never runs, hence blank. A classic
        // (non-module) IIFE <script src="..."> isn't subject to that
        // restriction and loads fine over file://. No downside for the
        // real localhost-server path either. No inlineDynamicImports
        // needed alongside it -- this app has no dynamic import()
        // anywhere, and Rolldown already disables chunk splitting by
        // default for this build regardless, so there's only ever one
        // chunk for format: 'iife' to apply to in the first place.
        format: 'iife',
      },
    },
  },
})
