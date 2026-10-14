import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "../components/Ask";
import { FileButton } from "../components/FileButton";
import { useFileDrop } from "../components/useFileDrop";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { Modal } from "../components/Modal";
import { transcribeLines } from "../lib/audio/transcribe";
import { exportPack } from "../lib/pack/export";
import { ImportError, importFiles } from "../lib/pack/import";
import { store } from "../lib/store";
import type { Pack } from "../lib/types";
import { extOf, uid, VIDEO_EXT } from "../lib/util";
import { useT, type Dict } from "../i18n";
import { notify, useApp } from "../state/app";

type ImportState =
  | { kind: "busy"; video: boolean }
  | { kind: "text"; pack: Pack; done: number; total: number; download: [number, number] | null }
  | { kind: "done"; pack: Pack; video: boolean }
  | { kind: "error"; title: string; text: string; paths?: string[] };

export function Packs() {
  const t = useT();
  const go = useApp((s) => s.go);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [imp, setImp] = useState<ImportState | null>(null);

  const refresh = useCallback(() => { store.listPacks().then(setPacks); }, []);
  useEffect(refresh, [refresh]);

  const newPack = async () => {
    const p: Pack = { id: uid(), name: t.editor.newPackName, scenes: [], updated: Date.now() };
    await store.putPack(p);
    go({ name: "editor", packId: p.id });
  };

  const stopText = useRef<{ requested: boolean } | null>(null);

  /** The words of the found lines, by the speech model in the browser; each text is saved as soon as it's ready. */
  const recognize = async (pack: Pack) => {
    const scene = pack.scenes[0];
    const media = await store.getMedia(scene.id);
    const stop = { requested: false };
    stopText.current = stop;
    setImp({ kind: "text", pack, done: 0, total: scene.lines.length, download: null });
    try {
      if (media) await transcribeLines(media, scene.lines, {
        onDownload: (loaded, total) => setImp((s) => (s?.kind === "text" ? { ...s, download: [loaded, total] } : s)),
        onLine: (id, text, done, total) => {
          const line = scene.lines.find((l) => l.id === id);
          if (line && text) { line.text = text; store.putPack(pack); }
          setImp((s) => (s?.kind === "text" ? { ...s, done, total, download: null } : s));
        },
      }, stop);
    } catch {
      notify(t.importer.textFailed);
    }
    stopText.current = null;
  };

  /** A single video is the quick way in: its lines, voices and words are found, and it can be played at once. */
  const runImport = useCallback(async (files: File[]) => {
    const video = files.length === 1 && VIDEO_EXT.includes(extOf(files[0].name));
    setImp({ kind: "busy", video });
    try {
      const [pack] = await importFiles(files);
      if (video && pack.scenes[0]?.lines.length) await recognize(pack);
      setImp({ kind: "done", pack, video });
      refresh();
    } catch (e) {
      const m = t.importer;
      if (e instanceof ImportError && e.kind === "rar") setImp({ kind: "error", title: m.rarTitle, text: m.rarText });
      else if (e instanceof ImportError && e.kind === "novideo") setImp({ kind: "error", title: m.noVideoTitle, text: m.noVideoText, paths: e.paths });
      else if (e instanceof ImportError && e.kind === "zip") setImp({ kind: "error", title: m.zipTitle, text: m.zipText });
      else {
        console.error(e);
        setImp({ kind: "error", title: m.failTitle, text: m.failText });
      }
    }
  }, [refresh, t]);
  const dragging = useFileDrop(runImport);

  const remove = async (p: Pack) => {
    if (!(await ask({ ...t.home.confirmDelete(p.name), kind: "delete", danger: true }))) return;
    await store.deletePack(p);
    refresh();
  };

  const doExport = async (p: Pack) => {
    if (!p.scenes.length) return notify(t.exporter.noScenes);
    notify(t.exporter.building);
    try { if ((await exportPack(p)) === "saved") notify(t.exporter.saved); }
    catch { notify(t.exporter.failed); }
  };

  return (
    <div className="wrap stack">
      <div className="page-head">
        <div>
          <h2>{t.packs.title}</h2>
          <p className="muted">{t.packs.lead}</p>
        </div>
        <div className="row">
          <FileButton className="btn primary" accept="video/*,.mkv,.ogv,.mov" onFiles={runImport}><Icon name="upload" />{t.packs.dropVideo}</FileButton>
          <Menu label={<>{t.packs.import}</>}>
            <FileButton className="menu-item" multiple onFiles={runImport}>{t.home.importFiles}</FileButton>
            <FileButton className="menu-item" directory onFiles={runImport}>{t.home.importFolder}</FileButton>
          </Menu>
          <button onClick={newPack}><Icon name="plus" />{t.packs.newPack}</button>
        </div>
      </div>

      {packs && !packs.length && (
        <div className="empty-state">
          <p><b>{t.packs.emptyTitle}</b></p>
          <p className="muted">{t.packs.emptyText}</p>
        </div>
      )}
      <div className="pack-grid">
        {packs?.map((p, i) => (
          <article className="pack-card rise" style={{ ["--i" as string]: i }} key={p.id}>
            <div className="pack-cover" aria-hidden="true"><Icon name="film" size={28} /></div>
            <div className="pack-body">
              <h3>{p.name || t.common.untitled}</h3>
              <p className="muted fine">{t.home.packMeta(p.scenes.length, p.author)}</p>
            </div>
            <div className="pack-actions">
              <button className="small primary" disabled={!p.scenes.length} onClick={() => go({ name: "online", intent: "create", packId: p.id })}>{t.common.play}</button>
              <Menu className="small ghost icon-only" ariaLabel={t.packs.more} label={<Icon name="dots" />}>
                <button className="menu-item" onClick={() => go({ name: "editor", packId: p.id })}>{t.common.edit}</button>
                <button className="menu-item" onClick={() => doExport(p)}>{t.common.export}</button>
                <button className="menu-item danger" onClick={() => remove(p)}>{t.common.delete}</button>
              </Menu>
            </div>
          </article>
        ))}
      </div>

      {dragging && <div className="drop-overlay" aria-hidden="true"><span>{t.packs.dropHere}</span></div>}
      {imp?.kind === "busy" && (
        <Modal title={imp.video ? t.importer.videoBusyTitle : t.importer.busyTitle}>
          <div className="row"><div className="spinner" /><span className="muted">{imp.video ? t.importer.videoBusyText : t.importer.busyText}</span></div>
        </Modal>
      )}
      {imp?.kind === "text" && (
        <Modal title={t.importer.textTitle} actions={<button onClick={() => { if (stopText.current) stopText.current.requested = true; }}>{t.tutorial.skip}</button>}>
          <div className="row"><div className="spinner" /><span>{imp.download ? t.importer.textDownload(imp.download[0], imp.download[1]) : t.importer.textProgress(imp.done, imp.total)}</span></div>
          <progress max={imp.download ? imp.download[1] : imp.total} value={imp.download ? imp.download[0] : imp.done} style={{ width: "100%" }} />
          <p className="muted fine">{t.importer.textHint}</p>
        </Modal>
      )}
      {imp?.kind === "done" && (
        <ImportDone
          t={t} pack={imp.pack} video={imp.video} onClose={() => setImp(null)}
          onEdit={() => go({ name: "editor", packId: imp.pack.id })}
          onPlay={() => go({ name: "online", intent: "create", packId: imp.pack.id })}
        />
      )}
      {imp?.kind === "error" && (
        <Modal
          title={imp.title}
          onClose={() => setImp(null)}
          actions={<>
            {imp.paths && <button onClick={() => navigator.clipboard.writeText(imp.paths!.join("\n")).then(() => notify(t.importer.copied), () => notify(t.importer.copyFailed))}>{t.importer.copyList}</button>}
            <button className="primary" onClick={() => setImp(null)}>{t.common.ok}</button>
          </>}
        >
          <p>{imp.text}</p>
          {imp.paths && <pre className="diag">{imp.paths.slice(0, 80).join("\n") || t.importer.empty}{imp.paths.length > 80 ? "\n" + t.importer.more(imp.paths.length - 80) : ""}</pre>}
        </Modal>
      )}
    </div>
  );
}

function ImportDone({ t, pack, video, onClose, onEdit, onPlay }: { t: Dict; pack: Pack; video: boolean; onClose(): void; onEdit(): void; onPlay(): void }) {
  const lines = pack.scenes.reduce((n, s) => n + s.lines.length, 0);
  const noLines = pack.scenes.filter((s) => !s.lines.length).length;
  const ogv = pack.scenes.some((s) => s.ext === "ogv");
  const roles = pack.scenes[0]?.roles.length ?? 0;
  const playable = lines > 0;
  return (
    <Modal
      title={video && playable ? t.importer.videoDoneTitle : video ? t.importer.videoNoLinesTitle : t.importer.doneTitle(pack.name)}
      onClose={onClose}
      actions={playable
        ? <><button onClick={video ? onEdit : onClose}>{video ? t.common.edit : t.common.close}</button><button className="primary" onClick={onPlay}>{t.common.play}</button></>
        : <><button onClick={onClose}>{t.common.close}</button><button className="primary" onClick={onEdit}>{t.common.edit}</button></>}
    >
      {video ? (
        <p>{lines ? t.importer.videoDone(lines, roles) : t.importer.videoNoLines}</p>
      ) : (
        <>
          <p>{t.importer.doneStats(pack.scenes.length, lines, pack.scenes.some((s) => s.bg))}</p>
          {noLines > 0 && <p className="muted">{t.importer.noLines(noLines === pack.scenes.length)}</p>}
        </>
      )}
      {ogv && <p className="muted">{t.importer.ogv}</p>}
    </Modal>
  );
}
