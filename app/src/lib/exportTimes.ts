// Export the current observer's contact times as the JSON schema used by
// third-party eclipse-photography tooling (direct request) -- e.g.
// komakallio/eclipse2024's times.json:
// github.com/komakallio/eclipse2024/blob/main/times.json. A plain
// {times: {C1,C2,MAX,C3,C4}} object, ISO 8601 UTC timestamps to one
// decimal -- matching that exact schema (nothing else this app tracks,
// e.g. sunset/magnitude, is added).
import { formatIsoTenths } from './format';

export interface TimesJson {
  times: {
    C1: string;
    // C2/C3 (totality bounds) are null for a partial-only observer --
    // C1/C4 (any partial eclipse's own start/end) are the only fields
    // this export actually requires (direct request/correction: don't
    // gate the whole export on totality existing here at all).
    C2: string | null;
    MAX: string;
    C3: string | null;
    C4: string;
  };
}

export function buildTimesJson(
  c1: Date,
  c2: Date | null,
  max: Date,
  c3: Date | null,
  c4: Date,
): TimesJson {
  return {
    times: {
      C1: formatIsoTenths(c1),
      C2: c2 ? formatIsoTenths(c2) : null,
      MAX: formatIsoTenths(max),
      C3: c3 ? formatIsoTenths(c3) : null,
      C4: formatIsoTenths(c4),
    },
  };
}

// Minimal ambient shape for the File System Access API's save-dialog path
// (Chromium-only, secure contexts only -- not yet in TypeScript's bundled
// DOM lib, and not worth a whole @types package for the handful of members
// actually used here).
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

/** Saves `json` to a file -- prefers a real native "Save As" dialog (the
 * File System Access API's showSaveFilePicker) so the user actually picks
 * where it goes, rather than a silent drop into the browser's default
 * downloads folder. That API needs a secure context (HTTPS or localhost,
 * NOT plain file://, one of this app's own supported access methods -- see
 * docs/STATUS.md's field-deployment notes) and is Chromium-only, so this
 * falls back to the previous Blob + object-URL anchor-click approach
 * whenever it's unavailable, rather than ever leaving the button unable to
 * export at all. Either path is entirely client-side -- no server/upload
 * involved, matching this app's zero-runtime-network architecture. */
export async function downloadTimesJson(json: TimesJson, filename = 'times.json'): Promise<void> {
  const text = JSON.stringify(json, null, 2);
  const showSaveFilePicker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;

  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
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

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
