import { useCallback, useEffect, useRef, useState } from "react";
import { Band } from "../components/Band";
import { FileButton } from "../components/FileButton";
import { VideoErrorModal } from "../components/VideoErrorModal";
import { findSpeech } from "../lib/audio/speech";
import { transcribeLines } from "../lib/audio/transcribe";
import { exportPack } from "../lib/pack/export";
import { sceneMediaKeys, store } from "../lib/store";
import type { Line, Pack, Role, Scene } from "../lib/types";
import { MIME, colorFor, extOf, prefersReducedMotion, uid, withMime } from "../lib/util";
import { Icon } from "../components/Icon";
import { useT } from "../i18n";
import { notify, useApp } from "../state/app";

const round1 = (t: number) => Math.round(t * 10) / 10;

/**
 * Find where people speak in the scene's video and turn each stretch into a line, with one role
 * per voice heard (the scene's own roles first, new ones for voices beyond them). No text.
 */
async function detectLines(scene: Scene, roleName: (n: number) => string): Promise<{ lines: Line[]; roles: Role[]; voices: number } | null> {
  const media = await store.getMedia(scene.id);
  const found = media ? await findSpeech(media) : null;
  if (!found) return null;
  const roles = [...scene.roles];
  while (roles.length < found.voices) roles.push({ id: uid(), name: roleName(roles.length + 1), color: colorFor(roles.length) });
  return { roles, voices: found.voices, lines: found.spans.map((s) => ({ id: uid(), roleId: roles[s.voice].id, start: s.start, end: s.end, text: "" })) };
}

export function Editor({ packId }: { packId: string }) {
  const t = useT();
  const go = useApp((s) => s.go);
  const [pack, setPack] = useState<Pack | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const saveTimer = useRef(0);
  const latest = useRef<Pack | null>(null);

  useEffect(() => {
    store.getPack(packId).then((p) => {
      if (!p) { notify(t.editor.notFound); go({ name: "home" }); return; }
      setPack(p);
      latest.current = p;
      setSceneId(p.scenes[0]?.id ?? null);
    });
  }, [packId, go]);

  // Flush a pending save when leaving the editor.
  useEffect(() => () => {
    if (saveTimer.current && latest.current) { clearTimeout(saveTimer.current); store.putPack(latest.current); }
  }, []);

  /** Apply a change to a copy of the pack and save it shortly after. */
  const mutate = useCallback((fn: (draft: Pack) => void, immediate = false) => {
    setPack((prev) => {
      if (!prev) return prev;
      const draft = structuredClone(prev);
      fn(draft);
      latest.current = draft;
      clearTimeout(saveTimer.current);
      if (immediate) { saveTimer.current = 0; store.putPack(draft); }
      else saveTimer.current = window.setTimeout(() => { saveTimer.current = 0; store.putPack(draft); }, 400);
      return draft;
    });
  }, []);

  if (!pack) return <div className="wrap"><div className="spinner" aria-label={t.common.loading} /></div>;
  const scene = pack.scenes.find((s) => s.id === sceneId) ?? null;

  const addScene = async (file: File) => {
    const ext = extOf(file.name) || "mp4";
    const s: Scene = { id: uid(), title: file.name.replace(/\.[^.]+$/, "").slice(0, 60), mediaType: file.type || MIME[ext] || "video/mp4", ext, duration: 0, roles: [{ id: uid(), name: t.editor.defaultRole(1), color: colorFor(0) }], lines: [] };
    await store.putMedia(s.id, withMime(file, ext));
    mutate((d) => { d.scenes.push(s); }, true);
    setSceneId(s.id);
    // A raw video is enough: the lines are found by ear, the author only checks roles and types the text.
    notify(t.editor.autoBusy);
    const found = await detectLines(s, t.editor.defaultRole);
    if (!found) { notify(t.editor.autoNoAudio); return; }
    if (!found.lines.length) { notify(t.editor.autoNone); return; }
    mutate((d) => { const sc = d.scenes.find((x) => x.id === s.id); if (sc && !sc.lines.length) { sc.roles = found.roles; sc.lines = found.lines; } }, true);
    notify(t.editor.autoFound(found.lines.length, found.voices));
  };

  const doExport = async () => {
    if (!pack.scenes.length) return notify(t.exporter.noScenes);
    notify(t.exporter.building);
    try { if ((await exportPack(pack)) === "saved") notify(t.exporter.saved); } catch { notify(t.exporter.failed); }
  };

  return (
    <div className="wrap stack">
      <div className="row" style={{ alignItems: "end" }}>
        <label className="field" style={{ flex: 1 }}>
          {t.editor.packName}
          <input value={pack.name} maxLength={80} onChange={(e) => { const v = e.target.value; mutate((d) => { d.name = v; }); }} />
        </label>
        <button onClick={doExport}>{t.editor.exportPack}</button>
      </div>

      <div className="row" role="tablist" aria-label={t.editor.scenes}>
        {pack.scenes.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === sceneId} className={"small scene-tab" + (s.id === sceneId ? " on" : "")} onClick={() => setSceneId(s.id)}>
            {s.title || t.common.scene}
          </button>
        ))}
        <FileButton className="btn small" accept="video/*,.ogv,.mkv" onFiles={([f]) => addScene(f)}>{t.editor.addScene}</FileButton>
      </div>

      {scene ? (
        <SceneEditor
          key={scene.id}
          scene={scene}
          update={(fn, immediate) => mutate((d) => { const s = d.scenes.find((x) => x.id === scene.id); if (s) fn(s); }, immediate)}
          onDelete={async () => {
            if (!confirm(t.editor.confirmDeleteScene)) return;
            for (const k of sceneMediaKeys(scene)) await store.deleteMedia(k);
            const rest = pack.scenes.filter((s) => s.id !== scene.id);
            mutate((d) => { d.scenes = d.scenes.filter((s) => s.id !== scene.id); }, true);
            setSceneId(rest[0]?.id ?? null);
          }}
        />
      ) : (
        <div className="panel muted">{t.editor.noScene}</div>
      )}
    </div>
  );
}

interface SceneEditorProps {
  scene: Scene;
  update(fn: (s: Scene) => void, immediate?: boolean): void;
  onDelete(): void;
}

function SceneEditor({ scene, update, onDelete }: SceneEditorProps) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const clipAudio = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [mediaRev, setMediaRev] = useState(0);
  const [detecting, setDetecting] = useState(false);
  /** Text recognition in progress: lines done of total, or the model download in bytes. */
  const [textJob, setTextJob] = useState<{ done: number; total: number; download: [number, number] | null } | null>(null);
  const stopText = useRef<{ requested: boolean } | null>(null);

  /** Fill in the text of the lines that have none (or of all of them, after asking) with the speech model. */
  const recognizeText = async () => {
    if (textJob || !scene.lines.length) return;
    let target = scene.lines.filter((l) => !l.text.trim());
    if (!target.length) {
      if (!confirm(t.editor.textReplace)) return;
      target = scene.lines;
    }
    const media = await store.getMedia(scene.id);
    if (!media) return notify(t.editor.autoNoAudio);
    const stop = { requested: false };
    stopText.current = stop;
    setTextJob({ done: 0, total: target.length, download: null });
    try {
      const res = await transcribeLines(media, target, {
        onDownload: (loaded, total) => setTextJob((j) => (j ? { ...j, download: [loaded, total] } : j)),
        onLine: (id, text, done, total) => {
          if (text) update((s) => { const l = s.lines.find((x) => x.id === id); if (l) l.text = text; });
          setTextJob({ done, total, download: null });
        },
      }, stop);
      if (!res) notify(t.editor.autoNoAudio);
    } catch {
      notify(t.importer.textFailed);
    }
    stopText.current = null;
    setTextJob(null);
  };

  const autoLines = async () => {
    if (detecting) return;
    if (scene.lines.length && !confirm(t.editor.autoReplace)) return;
    setDetecting(true);
    const found = await detectLines(scene, t.editor.defaultRole);
    setDetecting(false);
    if (!found) return notify(t.editor.autoNoAudio);
    if (!found.lines.length) return notify(t.editor.autoNone);
    update((s) => { s.roles = found.roles; s.lines = found.lines; }, true);
    notify(t.editor.autoFound(found.lines.length, found.voices));
  };

  useEffect(() => {
    let live = true;
    store.mediaUrl(scene.id).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [scene.id, mediaRev]);

  useEffect(() => () => { clipAudio.current?.pause(); }, []);

  const now = () => video.current?.currentTime ?? 0;

  const setLine = (id: string, fn: (l: Line) => void, sort = false) =>
    update((s) => {
      const l = s.lines.find((x) => x.id === id);
      if (!l) return;
      fn(l);
      l.start = Math.max(0, l.start);
      if (l.end <= l.start) l.end = round1(l.start + 0.5);
      if (sort) s.lines.sort((a, b) => a.start - b.start);
    });

  const addLine = () => {
    if (!scene.roles.length) return notify(t.editor.needRole);
    const at = now();
    const prev = [...scene.lines].reverse().find((l) => l.start <= at);
    const nextRole = prev ? scene.roles[(scene.roles.findIndex((r) => r.id === prev.roleId) + 1) % scene.roles.length] ?? scene.roles[0] : scene.roles[0];
    const nl: Line = { id: uid(), roleId: nextRole.id, start: round1(at), end: round1(at + 2), text: "" };
    update((s) => { s.lines.push(nl); s.lines.sort((a, b) => a.start - b.start); });
    setFresh(nl.id);
  };

  useEffect(() => {
    if (!fresh) return;
    const row = document.querySelector<HTMLElement>(`[data-line="${fresh}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    row?.querySelector<HTMLInputElement>(".ln-text")?.focus({ preventScroll: true });
  }, [fresh]);

  const playClip = async (key: string) => {
    const u = await store.mediaUrl(key);
    if (!u) return;
    clipAudio.current ??= new Audio();
    clipAudio.current.src = u;
    clipAudio.current.play().catch(() => {});
  };

  return (
    <div className="stack">
      <div className="grid2">
        <div className="stack">
          <div className="stage">
            <video
              ref={video}
              src={src ?? undefined}
              controls
              playsInline
              preload="metadata"
              onError={() => { if (src) setVideoError(true); }}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (isFinite(d) && Math.abs(d - scene.duration) > 0.01) update((s) => { s.duration = d; });
              }}
            />
          </div>
          <Band lines={scene.lines} roles={scene.roles} duration={scene.duration} time={now} emptyText={t.editor.bandEmpty} />
        </div>

        <div className="panel stack">
          <label className="field">
            {t.editor.sceneTitle}
            <input value={scene.title} maxLength={80} onChange={(e) => { const v = e.target.value; update((s) => { s.title = v; }); }} />
          </label>

          <div className="stack" style={{ gap: 8 }}>
            <h3>{t.editor.roles}</h3>
            <div className="chips">
              {scene.roles.length ? scene.roles.map((r) => (
                <span className="chip" key={r.id} style={{ ["--c" as string]: r.color }}>
                  {r.name}
                  <button
                    aria-label={t.editor.deleteRole(r.name)}
                    onClick={() => {
                      if (scene.lines.some((l) => l.roleId === r.id) && !confirm(t.editor.confirmDeleteRole)) return;
                      update((s) => { s.roles = s.roles.filter((x) => x.id !== r.id); s.lines = s.lines.filter((l) => l.roleId !== r.id); });
                    }}
                  >✕</button>
                </span>
              )) : <span className="muted fine">{t.editor.addRoleHint}</span>}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = roleName.trim();
                if (!n) return;
                update((s) => { s.roles.push({ id: uid(), name: n, color: colorFor(s.roles.length) }); });
                setRoleName("");
              }}
            >
              <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={t.editor.roleName} maxLength={40} style={{ flex: 1 }} aria-label={t.editor.newRoleLabel} />
              <button className="small">{t.common.add}</button>
            </form>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <h3>{t.editor.files}</h3>
            <div className="row">
              <FileButton
                className="btn small"
                accept="video/*,.ogv,.mkv"
                onFiles={async ([f]) => {
                  const ext = extOf(f.name) || "mp4";
                  await store.putMedia(scene.id, withMime(f, ext));
                  update((s) => { s.ext = ext; s.mediaType = f.type || MIME[ext] || "video/mp4"; }, true);
                  setVideoError(false);
                  setMediaRev((n) => n + 1);
                  notify(t.editor.videoReplaced);
                }}
              >{t.editor.replaceVideo}</FileButton>
            </div>
            <div className="row">
              <span className="muted fine" style={{ flex: 1 }}>{scene.bg ? t.editor.bgYes : t.editor.bgNo}</span>
              <FileButton
                className="btn small"
                accept="audio/*,.ogg,.opus"
                onFiles={async ([f]) => {
                  const key = scene.bg ?? scene.id + "_bg";
                  await store.putMedia(key, withMime(f, extOf(f.name)));
                  update((s) => { s.bg = key; s.bgExt = extOf(f.name); }, true);
                }}
              >{scene.bg ? t.editor.bgReplace : t.editor.bgAdd}</FileButton>
              {scene.bg && (
                <button className="small ghost danger" onClick={async () => { await store.deleteMedia(scene.bg); update((s) => { delete s.bg; delete s.bgExt; }, true); }}>
                  {t.editor.bgRemove}
                </button>
              )}
            </div>
          </div>
          <button className="small danger ghost" style={{ justifySelf: "start" }} onClick={onDelete}>{t.editor.deleteScene}</button>
        </div>
      </div>

      <section className="panel stack" aria-labelledby="lines-h">
        <div className="row">
          <h3 id="lines-h" style={{ flex: 1 }}>{t.editor.lines}</h3>
          {detecting ? <div className="row"><div className="spinner" /><span className="muted fine">{t.editor.autoBusy}</span></div> : <button className="small" onClick={autoLines} disabled={!!textJob}>{t.editor.autoLines}</button>}
          {textJob ? (
            <div className="row">
              <div className="spinner" />
              <span className="muted fine">{textJob.download ? t.importer.textDownload(textJob.download[0], textJob.download[1]) : t.importer.textProgress(textJob.done, textJob.total)}</span>
              <button className="small ghost" onClick={() => { if (stopText.current) stopText.current.requested = true; }}>{t.common.stop}</button>
            </div>
          ) : <button className="small" onClick={recognizeText} disabled={detecting || !scene.lines.length}>{t.editor.recognizeText}</button>}
          <button className="small primary" onClick={addLine}>{t.editor.addLine}</button>
        </div>
        <p className="muted fine">{t.editor.linesHint}</p>
        <div className="lines">
          {scene.lines.length ? scene.lines.map((l) => (
            <div className={"ln" + (l.id === fresh ? " fresh" : "")} key={l.id} data-line={l.id}>
              <select aria-label={t.common.role} value={l.roleId} onChange={(e) => { const v = e.target.value; setLine(l.id, (x) => { x.roleId = v; }); }}>
                {scene.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {(["start", "end"] as const).map((f) => (
                <div className="ln-time" key={f}>
                  <TimeInput label={f === "start" ? t.editor.start : t.editor.end} value={l[f]} onCommit={(v, done) => setLine(l.id, (x) => { x[f] = v; }, done)} />
                  <button title={f === "start" ? t.editor.startFromVideo : t.editor.endFromVideo} aria-label={f === "start" ? t.editor.startFromVideo : t.editor.endFromVideo}
                    onClick={() => setLine(l.id, (x) => { x[f] = round1(now()); }, true)}><Icon name="clock" size={15} /></button>
                </div>
              ))}
              <input className="ln-text" value={l.text} placeholder={t.editor.textPlaceholder} aria-label={t.editor.text}
                onChange={(e) => { const v = e.target.value; setLine(l.id, (x) => { x.text = v; }); }} />
              <div className="ln-acts">
                {l.clip && <button className="small ghost" title={t.editor.playOriginal} aria-label={t.editor.playOriginal} onClick={() => playClip(l.clip!)}><Icon name="play" size={15} /></button>}
                <button className="small ghost" title={t.editor.seekLine} aria-label={t.editor.seekLine} onClick={() => { if (video.current) video.current.currentTime = l.start; }}>↦</button>
                <button className="small ghost danger" aria-label={t.editor.deleteLine} onClick={() => update((s) => { s.lines = s.lines.filter((x) => x.id !== l.id); })}>✕</button>
              </div>
            </div>
          )) : <p className="muted">{t.editor.noLines}</p>}
        </div>
      </section>

      {videoError && <VideoErrorModal onClose={() => setVideoError(false)} />}
    </div>
  );
}

/** Number field that keeps its own text while typing and commits parsed seconds. */
function TimeInput({ value, label, onCommit }: { value: number; label: string; onCommit(v: number, done: boolean): void }) {
  const [text, setText] = useState(value.toFixed(1));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value.toFixed(1)); }, [value]);
  return (
    <input
      type="number" step="0.1" min="0" aria-label={label} value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v)) onCommit(v, false); }}
      onBlur={() => { focused.current = false; onCommit(value, true); setText(value.toFixed(1)); }}
    />
  );
}
