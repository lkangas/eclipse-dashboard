// "Save an offline copy" button (direct request) -- builds a genuinely
// self-contained copy of the currently-running app: this build's own
// index.html with its hashed JS bundle inlined directly, instead of
// referenced via <script src>. A bare index.html alone would NOT work
// offline on its own: this app's build emits it as a separate file that
// references assets/index-<hash>.js by a relative path (see
// vite.config.ts's own comments on why -- classic script, relative
// paths, both there specifically for file:// compatibility), so handing
// someone just the HTML file without the assets/ folder alongside it
// would produce a blank page the instant they open it without internet
// access to re-fetch anything. Fetching this page's OWN already-served
// resources and folding them into one file is the only way a single
// downloaded file actually works standalone, matching this app's
// existing file://-compatibility bar exactly, just as one file instead
// of two.
// Same File System Access API / Blob+anchor dual path as exportTimes.ts's
// downloadTimesJson -- see that file's own comment for why: a real "Save
// As" dialog where available (Chromium, secure contexts only -- HTTPS or
// localhost, not file://), falling back to a silent download into the
// browser's default folder everywhere else, including file://, rather
// than ever leaving the button unable to produce a file at all.
interface FileSystemWritableStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableStream>;
}
type ShowSaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandleLike>;

/** Fetches this page's own raw served source (NOT the live/rendered DOM,
 * which could be mid-session in some particular reactive state -- the
 * freshly-served file is always the pristine boot shell regardless of
 * how long the app has been running or what it's currently showing),
 * then its referenced JS bundle and favicon, folding both in as a single
 * self-contained HTML string with zero external dependencies. */
async function buildSelfContainedHtml(): Promise<string> {
  let html = await (await fetch(location.href)).text();

  const scriptMatch = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/i);
  if (scriptMatch) {
    const jsUrl = new URL(scriptMatch[1], location.href).href;
    const jsText = await (await fetch(jsUrl)).text();
    // A literal "</script" occurring inside the bundle's own text (e.g. a
    // string constant) would otherwise prematurely close this inline
    // <script> the instant a browser parses the saved file from scratch
    // -- escaping the slash is a semantic no-op inside a string/template-
    // literal/regex (the only place "</script" can legally appear in
    // already-valid JS), so this can't change what the bundle does.
    const safeJsText = jsText.replace(/<\/script/gi, '<\\/script');
    // The original tag sits in <head> as `<script defer src="...">`
    // (vite.config.ts's own classicScriptHtml plugin put it there) --
    // `defer` is what delays an EXTERNAL script's execution until after
    // <body>'s #app div has actually been parsed, since the tag itself
    // comes before it in the document. `defer`/`async` are BOTH a no-op
    // for an inline script with no `src` (per the HTML spec) -- a bare
    // in-place replacement would run immediately, synchronously, the
    // moment the parser reaches it in <head>, before #app exists yet,
    // silently failing to mount (confirmed live: an iframe loaded from
    // such a file rendered an empty, childless #app with no console
    // error). Removing the original tag and appending the inline
    // replacement just before </body> instead reproduces the same
    // "runs after the DOM it needs already exists" guarantee, the
    // classic script-tag-placement way, without needing defer at all.
    html = html.replace(scriptMatch[0], '');
    // A replacer FUNCTION, not a string: String.replace() treats a string
    // replacement's "$`"/"$'"/"$&"/"$$"/"$<n>" sequences specially (e.g.
    // "$`" means "insert everything before the match"). This bundle's own
    // minified code contains a one-character template literal `` `$` ``
    // (NMEA `$`-prefix detection) -- as a plain string replacement, that
    // "$`" spliced the ENTIRE preceding HTML document into the middle of
    // the script, corrupting it (confirmed live: `node --check` on the
    // extracted script pinpointed "<!doctype html>" appearing mid-function).
    // A function's return value is inserted literally, with no pattern
    // substitution, so it can't happen regardless of what the bundle contains.
    html = html.replace(/<\/body>/i, () => `<script>${safeJsText}</script></body>`);
  }

  const faviconMatch = html.match(/<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"[^>]*>/i);
  if (faviconMatch) {
    const favUrl = new URL(faviconMatch[1], location.href).href;
    const svgText = await (await fetch(favUrl)).text();
    // encodeURIComponent, not base64 -- avoids btoa's Latin1-only
    // restriction throwing on an SVG that happens to contain a non-ASCII
    // character (e.g. a stray non-breaking space from an editor), with no
    // downside for a file this small.
    html = html.replace(faviconMatch[1], () => `data:image/svg+xml,${encodeURIComponent(svgText)}`);
  }

  return html;
}

export async function downloadOfflineCopy(): Promise<void> {
  const html = await buildSelfContainedHtml();
  const filename = `eclipse-dashboard-offline-${new Date().toISOString().slice(0, 10)}.html`;

  const showSaveFilePicker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;
  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(html);
      await writable.close();
      return;
    } catch (err) {
      // AbortError = the user cancelled the dialog -- respect that, don't
      // fall through to a surprise silent download instead.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Any other failure (permission denied, unsupported context despite
      // the feature-detect above, etc.) -- fall through below rather than
      // leaving the user with nothing.
    }
  }

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
