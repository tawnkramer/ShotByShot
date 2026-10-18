import { useEffect, useRef, useState } from 'react';
import { ComicExportCancelled, comicsJsonEntry, defaultSlug, exportComic, publishOf, type ComicOutput, type ComicProgress } from '../../comic/exportComic';
import { pageName, pagesOf } from '../../comic/pages';
import { saveFile } from '../../shell/download';
import { useProjectStore } from '../../state/store';
import { exportProjectFile } from '../../storage/projectIO';

const WIDTHS = [1200, 1600, 2400];
const OUTPUT_LABELS: Record<ComicOutput, string> = { pages: 'Page images', pdf: 'PDF', site: 'Site package' };

export function ComicExport() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const pages = pagesOf(project);
  const [width, setWidth] = useState(1600);
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [letteredCover, setLetteredCover] = useState(false);
  const [busy, setBusy] = useState<ComicOutput | null>(null);
  const [progress, setProgress] = useState<ComicProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: ComicOutput; blob: Blob; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const publish = publishOf(project);
  const setPublish = (patch: Partial<typeof publish>) => dispatch({
    label: 'Edit comic site details',
    mergeKey: `publish:${Object.keys(patch).join()}`,
    apply: (d) => { d.comic = { ...d.comic, publish: { ...d.comic?.publish, ...patch } }; },
  });
  const ext = format === 'png' ? 'png' : 'jpg';
  const entry = comicsJsonEntry(project, pages.length, ext);
  const previs = pages.filter((p) => !project.shots.find((s) => s.id === p.shotId)?.image).length;

  if (!pages.length) {
    return (
      <div className="page empty">
        <p>No pages to export yet.</p>
        <p className="muted small">Break a script into panels, then check the Pages step.</p>
      </div>
    );
  }

  const run = async (kind: ComicOutput) => {
    setError(null); setResult(null); setBusy(kind); setProgress(null);
    controller.current = new AbortController();
    try {
      const out = await exportComic(project, kind, { width, format, letteredCover }, setProgress, controller.current.signal);
      setResult({ kind, ...out });
    } catch (e) {
      if (!(e instanceof ComicExportCancelled)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      controller.current = null;
    }
  };

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  return (
    <div className="page export-page">
      <section className="panel">
        <h2>Pages</h2>
        <p className="muted small">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'} ({pageName(1)}–{pageName(pages.length)}) and a cover, one panel per page, with lettering.
          {previs > 0 && ` ${previs} ${previs === 1 ? 'page is' : 'pages are'} still previs and will export as the grey 3D frame.`}
        </p>
        {pages.length > 99 && <p className="error small">More than 99 pages: names past Page99 won't sort correctly on the comic site.</p>}
        <label className="field">
          <span>Width</span>
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}
          </select>
        </label>
        <div className="field">
          <span>Image format</span>
          <div className="segmented" role="radiogroup" aria-label="Image format">
            {(['jpeg', 'png'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f === 'jpeg' ? 'JPEG' : 'PNG'}</button>
            ))}
          </div>
        </div>
        <label className="row gap small"><input type="checkbox" checked={letteredCover} onChange={(e) => setLetteredCover(e.target.checked)} /> Lettering on the cover</label>
        <div className="row gap wrap">
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => void run('pages')}>Make page images</button>
          <button className="btn" disabled={Boolean(busy)} onClick={() => void run('pdf')}>Make PDF</button>
        </div>
        {format === 'png' && <p className="muted small">The PDF always uses JPEG.</p>}
      </section>

      <section className="panel">
        <h2>For your comic site</h2>
        <p className="muted small">A zip with <code>comics/{publish.slug}/</code> (cover and pages) and the entry to add to your <code>comics.json</code>.</p>
        <label className="field">
          <span>Folder name (slug)</span>
          <input value={publish.slug} placeholder={defaultSlug(project.name)} onChange={(e) => setPublish({ slug: e.target.value.replace(/[^\w-]/g, '_') })} />
        </label>
        <label className="field">
          <span>Title</span>
          <input value={publish.title} onChange={(e) => setPublish({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>Tags (comma separated)</span>
          <input defaultValue={publish.tags.join(', ')} onBlur={(e) => setPublish({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </label>
        <pre className="json-entry" aria-label="comics.json entry">{JSON.stringify(entry, null, 4)}</pre>
        <div className="row gap wrap">
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => void run('site')}>Make site package</button>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(entry, null, 4)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied' : 'Copy entry'}</button>
        </div>
      </section>

      {busy && (
        <section className="panel">
          <div className="row gap">
            <strong className="grow">Drawing {OUTPUT_LABELS[busy].toLowerCase()}… {progress ? `${progress.done} / ${progress.total}` : ''}</strong>
            <button className="btn small-btn" onClick={() => controller.current?.abort()}>Cancel</button>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <section className="panel">
          <h2>{OUTPUT_LABELS[result.kind]} ready</h2>
          <p className="small">{result.kind === 'pdf' ? 'The cover, then every page.' : result.kind === 'site' ? 'Unzip it, upload the comics folder, and add the entry to comics.json (see README.txt).' : 'Page01… and cover, ready to upload.'}</p>
          <p className="muted small">{result.name} · {(result.blob.size / 1024 / 1024).toFixed(1)} MB</p>
          <button className="btn primary" onClick={() => void saveFile(result.blob, result.name, result.blob.type)}>Save {result.kind === 'pdf' ? 'PDF' : 'zip'}</button>
        </section>
      )}

      <section className="panel">
        <h2>Project</h2>
        <p className="muted small">Save the whole project, including images and lettering, to open it on another device or keep a backup.</p>
        <button className="btn" onClick={() => void exportProjectFile(project)}>Save project file</button>
      </section>
    </div>
  );
}
