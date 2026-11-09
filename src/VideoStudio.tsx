import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines, Check, Clapperboard, Copy, Download, Eye, EyeOff, FilePlus, Film,
  Image as ImageIcon, Lock, Magnet, Maximize2, Music2, Pause, Play, Plus, Redo2,
  RotateCcw, Scissors, SkipBack, SkipForward, StepBack, StepForward, Trash2, Type,
  Undo2, Unlink, Unlock, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import "./videostudio.css";
import {
  ASPECTS, type Aspect, type Clip, type Media, type Project, type Track, type TrackKind, type TitleStyle,
} from "./studio/types";
import {
  FPS, MIN_CLIP, buildStrip, clamp, computePeaks, defaultTracks, fadeFactor, freeStart, isFree,
  newClip, placeClip, readMedia, seconds1, shortTime, timecode, uid,
} from "./studio/utils";
import { clearAll, deleteMedia, loadAll, saveMedia, saveProject } from "./studio/storage";
import { exportSupported, exportVideo, frameSize } from "./studio/exporter";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const LABEL_W = 138;
const TRACK_H = 48;
const RULER_H = 30;
const ADD_ROW_H = 36;
const SNAP_PX = 8;
const MEDIA_MIME = "application/x-mediapark-media";
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const TEXT_COLORS = ["#ffffff", "#b8e99b", "#ffd27a", "#ff9a7a", "#8fd3ff", "#111111"];

const titlePresets: Array<{ name: string; text: string; style: TitleStyle; note: string }> = [
  { name: "Center title", text: "Your title", style: "center", note: "Large text in the middle" },
  { name: "Lower third", text: "Name, role", style: "lower", note: "Names and places" },
  { name: "Subtitle", text: "Type your caption", style: "subtitle", note: "Captions on a dark strip" },
];

type Drag = { mode: "move" | "left" | "right"; id: string; x0: number; y0: number; orig: Clip; moved: boolean };
type DropHint = { trackId: string; start: number; duration: number };
type Actions = {
  togglePlay: () => void; split: () => void; duplicate: () => void; remove: (ripple?: boolean) => void;
  undo: () => void; redo: () => void; step: (seconds: number) => void; seek: (time: number) => void;
  seekEnd: () => void; zoom: (factor: number) => void;
};

const isTrackCompatible = (track: Track, media: Media) => (media.kind === "audio" ? track.kind === "audio" : track.kind === "video");

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function ToolButton({ icon: Icon, label, hint, onClick, disabled, active }: {
  icon: LucideIcon; label: string; hint?: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button className={"vs-tool" + (active ? " active" : "")} onClick={onClick} disabled={disabled} aria-pressed={active} title={hint ? label + " (" + hint + ")" : label}>
      <Icon size={19} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

function buildWave(peaks: number[] | undefined, from: number, to: number): string {
  const count = 120;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < count; i++) {
    let value = 0.12;
    if (peaks && peaks.length > 0) {
      const a = clamp(Math.floor((from + ((to - from) * i) / count) * peaks.length), 0, peaks.length - 1);
      const b = clamp(Math.ceil((from + ((to - from) * (i + 1)) / count) * peaks.length), a + 1, peaks.length);
      value = 0;
      for (let k = a; k < b; k++) value = Math.max(value, peaks[k]);
    }
    const x = (i / (count - 1)) * 100;
    const amp = (0.05 + 0.95 * value) * 46;
    top.push(x.toFixed(2) + "," + (50 - amp).toFixed(2));
    bottom.unshift(x.toFixed(2) + "," + (50 + amp).toFixed(2));
  }
  return top.concat(bottom).join(" ");
}

function Waveform({ peaks, from = 0, to = 1 }: { peaks?: number[]; from?: number; to?: number }) {
  const points = useMemo(() => buildWave(peaks, from, to), [peaks, from, to]);
  return (
    <svg className="vs-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={points} />
    </svg>
  );
}

function thumbStyle(media: Media): CSSProperties {
  if (media.kind === "image") return { backgroundImage: "url(" + media.url + ")", backgroundSize: "cover", backgroundPosition: "center" };
  if (media.kind === "video" && media.strip) {
    return { backgroundImage: "url(" + media.strip + ")", backgroundSize: (media.frames ?? 1) * 100 + "% 100%", backgroundPosition: "0 0" };
  }
  return {};
}

function FrameStrip({ media, clip, pps, height }: { media: Media; clip: Clip; pps: number; height: number }) {
  if (media.kind === "image") {
    return <span className="vs-frames" style={{ backgroundImage: "url(" + media.url + ")", backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />;
  }
  if (!media.strip) return null;
  const frames = media.frames ?? 1;
  const slotW = Math.max(24, Math.round(height * ((media.width ?? 16) / (media.height ?? 9))));
  const count = Math.min(400, Math.ceil((clip.duration * pps) / slotW));
  return (
    <span className="vs-frames">
      {Array.from({ length: count }, (_, k) => {
        const sourceTime = clip.inPoint + (((k + 0.5) * slotW) / pps) * clip.speed;
        const index = clamp(Math.floor((sourceTime / media.duration) * frames), 0, frames - 1);
        return <i key={k} style={{ width: slotW, backgroundImage: "url(" + media.strip + ")", backgroundSize: frames * slotW + "px 100%", backgroundPosition: -index * slotW + "px 0" }} />;
      })}
    </span>
  );
}

function MediaLayer({ clip, media, time, playing, muted, asAudio }: {
  clip: Clip; media: Media; time: number; playing: boolean; muted: boolean; asAudio: boolean;
}) {
  const element = useRef<HTMLMediaElement | null>(null);
  const setElement = useCallback((node: HTMLMediaElement | null) => { element.current = node; }, []);
  const local = clip.inPoint + (time - clip.start) * clip.speed;
  const fade = fadeFactor(clip, time);
  const volume = clamp(clip.volume * fade, 0, 1);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = clip.speed;
    if (!playing) {
      el.pause();
      if (Math.abs(el.currentTime - local) > 0.04) el.currentTime = local;
    } else {
      if (Math.abs(el.currentTime - local) > 0.35) el.currentTime = local;
      if (el.paused) void el.play().catch(() => undefined);
    }
  }, [local, playing, muted, volume, clip.speed]);

  if (asAudio || media.kind === "audio") return <audio ref={setElement} src={media.url} preload="auto" />;
  const style: CSSProperties = { opacity: clip.opacity * fade, objectFit: clip.fit, transform: clip.zoom !== 1 ? "scale(" + clip.zoom + ")" : undefined };
  if (media.kind === "image") return <img className="vs-layer" style={style} src={media.url} alt="" />;
  return <video ref={setElement} className="vs-layer" style={style} src={media.url} playsInline preload="auto" />;
}

/* ------------------------------------------------------------------ */
/* Export dialog                                                       */
/* ------------------------------------------------------------------ */

function ExportDialog({ project, media, aspect, name, onClose }: {
  project: Project; media: Map<string, Media>; aspect: Aspect; name: string; onClose: () => void;
}) {
  const [resolution, setResolution] = useState(720);
  const [phase, setPhase] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ url: string; size: number; extension: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const length = project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
  const dims = frameSize(aspect, resolution);
  const supported = exportSupported();
  const fileName = (name.trim().replace(/[^\w\- ]+/g, "").trim() || "video").replace(/\s+/g, "-");

  const close = useCallback(() => {
    abortRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("rendering");
    setProgress(0);
    try {
      const output = await exportVideo({ project, media, aspect, resolution, fps: 30, signal: controller.signal, onProgress: setProgress });
      if (output.blob.size === 0) throw new Error("The recording came out empty. Try again.");
      const url = URL.createObjectURL(output.blob);
      urlRef.current = url;
      setResult({ url, size: output.blob.size, extension: output.extension });
      setPhase("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "Something went wrong while exporting.");
      setPhase("error");
    }
  };

  return (
    <div className="vs-dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && phase !== "rendering") close(); }}>
      <div className="vs-dialog" role="dialog" aria-modal="true" aria-labelledby="vs-export-title">
        <div className="vs-dialog-head">
          <h3 id="vs-export-title">Export video</h3>
          <button className="vs-icon-btn" onClick={close} aria-label="Close"><X size={18} /></button>
        </div>

        {phase === "idle" && (
          <div className="vs-dialog-body">
            {!supported && <p className="vs-alert">This browser can't record video. Use a recent Chrome, Edge, Firefox or Safari.</p>}
            <div className="vs-field">Quality
              <div className="vs-segment">
                {[480, 720, 1080].map((value) => (
                  <button key={value} className={resolution === value ? "active" : ""} onClick={() => setResolution(value)}>{value}p</button>
                ))}
              </div>
            </div>
            <dl className="vs-readout">
              <div><dt>Size</dt><dd>{dims.width} × {dims.height}</dd></div>
              <div><dt>Length</dt><dd>{shortTime(length)}</dd></div>
            </dl>
            <p className="vs-hint">Your video is rendered in real time, so a {shortTime(length)} video takes about {shortTime(length)} to export. Keep this tab open and visible while it works.</p>
            <button className="vs-cta" onClick={start} disabled={!supported || length <= 0}><Download size={16} /> Start export</button>
          </div>
        )}

        {phase === "rendering" && (
          <div className="vs-dialog-body">
            <div className="vs-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: progress * 100 + "%" }} /></div>
            <p className="vs-hint"><b>{Math.round(progress * 100)}%</b> rendered. Keep this tab open until it finishes.</p>
            <button className="vs-secondary" onClick={() => { abortRef.current?.abort(); setPhase("idle"); }}>Cancel export</button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="vs-dialog-body">
            <video className="vs-result" src={result.url} controls playsInline />
            <p className="vs-hint">Ready: {(result.size / 1048576).toFixed(1)} MB, {result.extension.toUpperCase()} file.</p>
            <a className="vs-cta" href={result.url} download={fileName + "." + result.extension}><Download size={16} /> Download video</a>
          </div>
        )}

        {phase === "error" && (
          <div className="vs-dialog-body">
            <p className="vs-alert">{message}</p>
            <button className="vs-cta" onClick={() => setPhase("idle")}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export default function VideoStudio() {
  const [media, setMedia] = useState<Media[]>([]);
  const [project, setProject] = useState<Project>(() => ({ tracks: defaultTracks(), clips: [] }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(60);
  const [snapOn, setSnapOn] = useState(true);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [panelTab, setPanelTab] = useState<"media" | "text">("media");
  const [projectName, setProjectName] = useState("Untitled video");
  const [status, setStatus] = useState("Add video, music or photos to begin.");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [importing, setImporting] = useState(0);
  const [fileDrag, setFileDrag] = useState(false);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [, setHistoryVersion] = useState(0);

  const projectRef = useRef(project);
  projectRef.current = project;
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const playheadRef = useRef(0);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const pastRef = useRef<Project[]>([]);
  const futureRef = useRef<Project[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const scrubbing = useRef(false);
  const editGuard = useRef(false);
  const statusTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addAfterPick = useRef(false);
  const dragDepth = useRef(0);
  const draggingMedia = useRef<string | null>(null);
  const actions = useRef<Actions | null>(null);

  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const trackById = useMemo(() => new Map(project.tracks.map((t) => [t.id, t])), [project.tracks]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;
  const selectedMedia = selected?.mediaId ? mediaMap.get(selected.mediaId) : undefined;
  const selectedTrack = selected ? trackById.get(selected.trackId) : undefined;
  const contentEnd = project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
  const total = Math.max(contentEnd, 1);
  const totalRef = useRef(total);
  totalRef.current = total;
  const endRef = useRef(contentEnd);
  endRef.current = contentEnd;
  const timelineSeconds = Math.max(total + 10, 30);

  /* ---- status, history, persistence ---- */

  const flash = (message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(projectRef.current.clips.length ? "Ready." : "Add video, music or photos to begin."), 5000);
  };
  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  const snapshot = () => {
    pastRef.current = [...pastRef.current.slice(-99), projectRef.current];
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  };
  const change = (fn: (p: Project) => Project) => { snapshot(); setProject(fn); };
  const liveEdit = (fn: (p: Project) => Project) => {
    if (!editGuard.current) { snapshot(); editGuard.current = true; }
    setProject(fn);
  };
  const undo = () => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(projectRef.current);
    setProject(previous);
    setHistoryVersion((v) => v + 1);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(projectRef.current);
    setProject(next);
    setHistoryVersion((v) => v + 1);
  };
  const updateClip = (id: string, patch: Partial<Clip>, live = false) => {
    const apply = (p: Project): Project => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    if (live) liveEdit(apply); else change(apply);
  };
  const updateTrack = (id: string, patch: Partial<Track>) => change((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const endEdit = () => { editGuard.current = false; };

  const enrich = async (item: Media) => {
    const patch: Partial<Media> = {};
    if (item.kind === "video") {
      const built = await buildStrip(item);
      if (built) { patch.strip = built.strip; patch.frames = built.frames; }
    }
    if (item.kind !== "image") {
      const peaks = await computePeaks(item.blob);
      if (peaks) patch.peaks = peaks;
    }
    if (Object.keys(patch).length === 0 || !mediaRef.current.some((m) => m.id === item.id)) return;
    setMedia((previous) => previous.map((m) => (m.id === item.id ? { ...m, ...patch } : m)));
    void saveMedia({ ...item, ...patch }).catch(() => undefined);
  };

  // Restore the last session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadAll();
      if (cancelled) return;
      if (data) {
        const items: Media[] = data.media.map((m) => ({ ...m, url: URL.createObjectURL(m.blob) }));
        setMedia(items);
        if (data.project) {
          const known = new Set(items.map((m) => m.id));
          const clips = data.project.project.clips.filter((c) => !c.mediaId || known.has(c.mediaId));
          setProject({ tracks: data.project.project.tracks, clips });
          setAspect(data.project.aspect);
          setProjectName(data.project.name);
          if (clips.length > 0) setStatus("Welcome back. Your last project was restored.");
        }
        items.filter((m) => (m.kind === "video" && (m.frames ?? 1) < 2) || (m.kind !== "image" && !m.peaks)).forEach((m) => void enrich(m));
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave.
  useEffect(() => {
    if (!ready) return;
    setSaveState("saving");
    const id = window.setTimeout(() => {
      saveProject({ project, aspect, name: projectName }).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 700);
    return () => window.clearTimeout(id);
  }, [project, aspect, projectName, ready]);

  /* ---- transport ---- */

  const seek = (time: number) => {
    const value = Math.max(0, time);
    playheadRef.current = value;
    setPlayhead(value);
  };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (endRef.current <= 0) { flash("Add a clip to the timeline first."); return; }
    if (playheadRef.current >= endRef.current - 0.01) seek(0);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = playheadRef.current + (now - last) / 1000;
      last = now;
      if (next >= endRef.current) {
        playheadRef.current = endRef.current;
        setPlayhead(endRef.current);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const x = LABEL_W + playhead * pps;
    if (x > scroller.scrollLeft + scroller.clientWidth - 30 || x < scroller.scrollLeft + LABEL_W) scroller.scrollLeft = Math.max(0, x - LABEL_W - 60);
  }, [playhead, playing, pps]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setPps((value) => clamp(value * (1 - event.deltaY * 0.0025), 12, 300));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  const fitTimeline = () => {
    const scroller = scrollRef.current;
    if (!scroller || contentEnd <= 0) return;
    setPps(clamp((scroller.clientWidth - LABEL_W - 48) / contentEnd, 12, 300));
    scroller.scrollLeft = 0;
  };

  /* ---- importing and placing media ---- */

  const placeMedia = (items: Media[], opts: { start?: number; trackId?: string } = {}) => {
    const current = projectRef.current;
    let clips = current.clips;
    let cursor = opts.start ?? playheadRef.current;
    const created: Clip[] = [];
    let blockedKind: TrackKind | null = null;
    for (const item of items) {
      const kind: TrackKind = item.kind === "audio" ? "audio" : "video";
      const usable = current.tracks.filter((t) => t.kind === kind && !t.locked);
      const preferred = opts.trackId ? usable.find((t) => t.id === opts.trackId) : undefined;
      const track = preferred ?? (kind === "video" ? usable[usable.length - 1] : usable[0]);
      if (!track) { blockedKind = kind; continue; }
      const start = freeStart(clips, track.id, cursor, item.duration);
      const clip = newClip({ trackId: track.id, mediaId: item.id, label: item.name, start, duration: item.duration });
      clips = [...clips, clip];
      created.push(clip);
      cursor = start + item.duration;
    }
    if (created.length === 0) {
      if (blockedKind) flash("Unlock a " + blockedKind + " track to add this.");
      return;
    }
    change((p) => ({ ...p, clips: [...p.clips, ...created] }));
    setSelectedId(created[created.length - 1].id);
    flash(created.length === 1 ? "Added " + created[0].label + "." : "Added " + created.length + " clips to the timeline.");
  };

  const importFiles = async (files: File[], opts: { add: boolean; start?: number; trackId?: string }) => {
    if (files.length === 0) return;
    setImporting((n) => n + files.length);
    const added: Media[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const item = await readMedia(file);
      if (item) added.push(item); else rejected.push(file.name);
    }
    setImporting((n) => n - files.length);
    if (added.length > 0) {
      setMedia((previous) => [...previous, ...added]);
      mediaRef.current = [...mediaRef.current, ...added];
      setPanelTab("media");
      for (const item of added) {
        saveMedia(item).catch(() => { setSaveState("error"); flash("Browser storage is full. This file will be gone after a refresh."); });
        void enrich(item);
      }
      if (opts.add) placeMedia(added, { start: opts.start, trackId: opts.trackId });
      else flash("Imported " + added.length + (added.length === 1 ? " file." : " files.") + " Click or drag them onto the timeline.");
    }
    if (rejected.length > 0) flash("Couldn't read " + rejected.slice(0, 2).join(", ") + (rejected.length > 2 ? " and more" : "") + ". Try MP4, WebM, MP3, WAV, JPG or PNG.");
  };

  const pickFiles = (addToTimeline: boolean) => {
    addAfterPick.current = addToTimeline;
    fileRef.current?.click();
  };
  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const add = addAfterPick.current;
    addAfterPick.current = false;
    void importFiles(files, { add });
  };

  const removeMediaItem = (item: Media) => {
    if (project.clips.some((c) => c.mediaId === item.id)) { flash("“" + item.name + "” is used on the timeline. Delete its clips first."); return; }
    URL.revokeObjectURL(item.url);
    setMedia((previous) => previous.filter((m) => m.id !== item.id));
    void deleteMedia(item.id).catch(() => undefined);
  };

  /* ---- editing ---- */

  const trackLocked = (clip: Clip) => trackById.get(clip.trackId)?.locked ?? false;

  const addTitle = (preset: (typeof titlePresets)[number]) => {
    const track = project.tracks.find((t) => t.kind === "title");
    if (!track || track.locked) { flash("Unlock the Text track to add text."); return; }
    const start = freeStart(project.clips, track.id, playheadRef.current, 3);
    const clip = newClip({ trackId: track.id, label: preset.name, start, duration: 3, text: preset.text, titleStyle: preset.style, color: "#ffffff", size: 1, fadeIn: 0.3, fadeOut: 0.3 });
    change((p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
    setPanelTab("media");
    flash("Added text. Type your own in the panel on the right.");
  };

  const split = () => {
    const t = playheadRef.current;
    const inside = (c: Clip) => !trackLocked(c) && t > c.start + 0.05 && t < c.start + c.duration - 0.05;
    const targets = selected ? (inside(selected) ? [selected] : []) : project.clips.filter(inside);
    if (targets.length === 0) { flash(selected ? "Move the playhead over the selected clip to split it." : "Move the playhead over a clip to split it."); return; }
    const ids = new Set(targets.map((c) => c.id));
    let nextSelection: string | null = null;
    const clips = project.clips.flatMap((c) => {
      if (!ids.has(c.id)) return [c];
      const firstLength = t - c.start;
      const second: Clip = { ...c, id: uid("c"), start: t, inPoint: c.inPoint + firstLength * c.speed, duration: c.duration - firstLength, fadeIn: 0 };
      if (targets.length === 1) nextSelection = second.id;
      return [{ ...c, duration: firstLength, fadeOut: 0 }, second];
    });
    change((p) => ({ ...p, clips }));
    setSelectedId(nextSelection);
    flash("Split at " + timecode(t) + ".");
  };

  const duplicate = () => {
    if (!selected) { flash("Select a clip to duplicate it."); return; }
    const start = freeStart(project.clips, selected.trackId, selected.start + selected.duration, selected.duration);
    const copy: Clip = { ...selected, id: uid("c"), start };
    change((p) => ({ ...p, clips: [...p.clips, copy] }));
    setSelectedId(copy.id);
    flash("Duplicated " + selected.label + ".");
  };

  const remove = (ripple = false) => {
    if (!selected) { flash("Select a clip to delete it."); return; }
    if (trackLocked(selected)) { flash("Unlock the track to delete this clip."); return; }
    change((p) => {
      let clips = p.clips.filter((c) => c.id !== selected.id);
      if (ripple) clips = clips.map((c) => (c.trackId === selected.trackId && c.start >= selected.start + selected.duration - 1e-6 ? { ...c, start: c.start - selected.duration } : c));
      return { ...p, clips };
    });
    setSelectedId(null);
    flash(ripple ? "Deleted " + selected.label + " and closed the gap." : "Deleted " + selected.label + ".");
  };

  const detachAudio = () => {
    if (!selected || selectedMedia?.kind !== "video" || selectedTrack?.kind !== "video") { flash("Select a video clip to separate its sound."); return; }
    const target = project.tracks.find((t) => t.kind === "audio" && !t.locked && isFree(project.clips, t.id, selected.start, selected.duration));
    if (!target) { flash("No audio track is free at that spot. Use “+ Audio” to add one."); return; }
    const audio: Clip = { ...selected, id: uid("c"), trackId: target.id, opacity: 1, fadeIn: selected.fadeIn, fadeOut: selected.fadeOut };
    change((p) => ({ ...p, clips: [...p.clips.map((c) => (c.id === selected.id ? { ...c, volume: 0 } : c)), audio] }));
    flash("Sound moved to " + target.name + ". You can now edit it separately.");
  };

  const setSpeed = (clip: Clip, speed: number) => {
    const span = clip.duration * clip.speed;
    let duration = span / speed;
    const nextStart = project.clips.reduce((value, c) => (c.id !== clip.id && c.trackId === clip.trackId && c.start >= clip.start + clip.duration - 1e-6 ? Math.min(value, c.start) : value), Infinity);
    let shortened = false;
    if (clip.start + duration > nextStart + 1e-6) { duration = nextStart - clip.start; shortened = true; }
    if (duration < MIN_CLIP) { flash("There isn't room for that speed. Move the next clip first."); return; }
    updateClip(clip.id, { speed, duration });
    if (shortened) flash("Clip shortened to fit before the next clip.");
  };

  const addTrack = (kind: "video" | "audio") => {
    const existing = projectRef.current.tracks.filter((t) => t.kind === kind);
    if (existing.length >= 4) { flash("You can have up to 4 " + kind + " tracks."); return; }
    const track: Track = { id: uid("t"), name: (kind === "video" ? "Video " : "Audio ") + (existing.length + 1), kind, muted: false, hidden: false, locked: false };
    change((p) => {
      const tracks = [...p.tracks];
      if (kind === "video") tracks.splice(tracks.findIndex((t) => t.kind === "video"), 0, track); else tracks.push(track);
      return { ...p, tracks };
    });
  };
  const removeTrack = (track: Track) => change((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== track.id) }));

  const clearTimeline = () => {
    if (project.clips.length === 0) return;
    change((p) => ({ ...p, clips: [] }));
    setSelectedId(null);
    seek(0);
    setPlaying(false);
    flash("Timeline cleared. Press Undo to bring it back.");
  };

  const newProject = async () => {
    if ((project.clips.length > 0 || media.length > 0) && !window.confirm("Start a new project? This removes the timeline and all imported media from this browser.")) return;
    setPlaying(false);
    mediaRef.current.forEach((m) => URL.revokeObjectURL(m.url));
    pastRef.current = [];
    futureRef.current = [];
    setMedia([]);
    setProject({ tracks: defaultTracks(), clips: [] });
    setSelectedId(null);
    setAspect("16:9");
    setProjectName("Untitled video");
    seek(0);
    try { await clearAll(); } catch { /* storage unavailable */ }
    flash("New project ready.");
  };

  actions.current = {
    togglePlay, split, duplicate, remove, undo, redo,
    step: (delta) => { setPlaying(false); seek(clamp(playheadRef.current + delta, 0, timelineSeconds)); },
    seek,
    seekEnd: () => { setPlaying(false); seek(endRef.current); },
    zoom: (factor) => setPps((value) => clamp(value * factor, 12, 300)),
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']") !== null) return;
      if (document.querySelector(".vs-dialog")) return;
      const api = actions.current;
      if (!api) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) api.redo(); else api.undo(); return; }
      if (mod && key === "y") { event.preventDefault(); api.redo(); return; }
      if (mod && key === "d") { event.preventDefault(); api.duplicate(); return; }
      if (mod || event.altKey) return;
      if (event.key === " " && target?.closest("button, a") === null) { event.preventDefault(); api.togglePlay(); }
      else if (key === "s") api.split();
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); api.remove(event.shiftKey); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); api.step(event.shiftKey ? -1 : -1 / FPS); }
      else if (event.key === "ArrowRight") { event.preventDefault(); api.step(event.shiftKey ? 1 : 1 / FPS); }
      else if (event.key === "Home") { event.preventDefault(); api.seek(0); }
      else if (event.key === "End") { event.preventDefault(); api.seekEnd(); }
      else if (event.key === "=" || event.key === "+") api.zoom(1.25);
      else if (event.key === "-") api.zoom(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- timeline pointer handling ---- */

  const snapEdge = (value: number, points: number[]): number | null => {
    if (!snapOn) return null;
    const threshold = SNAP_PX / ppsRef.current;
    let best: number | null = null;
    let bestDistance = threshold;
    for (const point of points) {
      const distance = Math.abs(point - value);
      if (distance < bestDistance) { bestDistance = distance; best = point; }
    }
    return best;
  };

  const timeAt = (clientX: number, element: HTMLElement | null) => {
    if (!element) return 0;
    return clamp((clientX - element.getBoundingClientRect().left) / ppsRef.current, 0, timelineSeconds);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, clip: Clip, mode: Drag["mode"]) => {
    event.stopPropagation();
    setSelectedId(clip.id);
    if (trackLocked(clip) || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, id: clip.id, x0: event.clientX, y0: event.clientY, orig: clip, moved: false };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      snapshot();
    }
    const current = projectRef.current;
    const { orig } = drag;
    const dt = dx / ppsRef.current;
    const others = current.clips.filter((c) => c.id !== orig.id);
    const points = [0, playheadRef.current, ...others.flatMap((c) => [c.start, c.start + c.duration])];
    const onTrack = others.filter((c) => c.trackId === orig.trackId);
    const originMedia = orig.mediaId ? mediaMap.get(orig.mediaId) : undefined;
    const limited = originMedia?.kind === "video" || originMedia?.kind === "audio";
    let patch: Partial<Clip> | null = null;

    if (drag.mode === "move") {
      let desired = orig.start + dt;
      const a = snapEdge(desired, points);
      const b = snapEdge(desired + orig.duration, points);
      if (a !== null && (b === null || Math.abs(a - desired) <= Math.abs(b - (desired + orig.duration)))) desired = a;
      else if (b !== null) desired = b - orig.duration;
      let trackId = orig.trackId;
      const lanes = lanesRef.current;
      const originKind = trackById.get(orig.trackId)?.kind;
      if (lanes) {
        const row = Math.floor((event.clientY - lanes.getBoundingClientRect().top) / TRACK_H);
        const candidate = current.tracks[clamp(row, 0, current.tracks.length - 1)];
        if (candidate && candidate.kind === originKind && !candidate.locked) trackId = candidate.id;
      }
      let start = placeClip(current.clips, orig, trackId, desired);
      if (start === null && trackId !== orig.trackId) {
        trackId = orig.trackId;
        start = placeClip(current.clips, orig, trackId, desired);
      }
      if (start !== null) patch = { start, trackId };
    } else if (drag.mode === "left") {
      const low = onTrack.reduce((value, c) => (c.start + c.duration <= orig.start + 1e-6 ? Math.max(value, c.start + c.duration) : value), 0);
      const minStart = Math.max(low, limited ? orig.start - orig.inPoint / orig.speed : 0);
      let next = orig.start + dt;
      next = snapEdge(next, points) ?? next;
      next = clamp(next, minStart, orig.start + orig.duration - MIN_CLIP);
      const delta = next - orig.start;
      patch = { start: next, duration: orig.duration - delta, inPoint: limited ? orig.inPoint + delta * orig.speed : orig.inPoint };
    } else {
      const high = onTrack.reduce((value, c) => (c.start >= orig.start + orig.duration - 1e-6 ? Math.min(value, c.start) : value), Infinity);
      const mediaLimit = limited && originMedia ? orig.start + (originMedia.duration - orig.inPoint) / orig.speed : Infinity;
      const maxEnd = Math.max(orig.start + MIN_CLIP, Math.min(high, mediaLimit));
      let end = orig.start + orig.duration + dt;
      end = snapEdge(end, points) ?? end;
      end = clamp(end, orig.start + MIN_CLIP, maxEnd);
      patch = { duration: end - orig.start };
    }

    if (patch) {
      const applied = patch;
      const next: Project = { ...current, clips: current.clips.map((c) => (c.id === orig.id ? { ...c, ...applied } : c)) };
      projectRef.current = next;
      setProject(next);
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    const last = pastRef.current[pastRef.current.length - 1];
    if (last && JSON.stringify(last.clips) === JSON.stringify(projectRef.current.clips)) {
      pastRef.current.pop();
      setHistoryVersion((v) => v + 1);
    }
  };

  /* ---- drag and drop ---- */

  const hasFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  const laneTarget = (event: ReactDragEvent, durationHint: number, item?: Media): DropHint | null => {
    const lanes = lanesRef.current;
    if (!lanes) return null;
    const rect = lanes.getBoundingClientRect();
    const tracks = projectRef.current.tracks;
    let track: Track | undefined = tracks[clamp(Math.floor((event.clientY - rect.top) / TRACK_H), 0, tracks.length - 1)];
    const fits = (t: Track | undefined) => !!t && !t.locked && (item ? isTrackCompatible(t, item) : t.kind !== "title");
    if (!fits(track)) {
      const kind: TrackKind = item?.kind === "audio" ? "audio" : "video";
      const usable = tracks.filter((t) => t.kind === kind && !t.locked);
      track = kind === "video" ? usable[usable.length - 1] : usable[0];
    }
    if (!track) return null;
    const start = Math.max(0, (event.clientX - rect.left) / ppsRef.current);
    return { trackId: track.id, start: freeStart(projectRef.current.clips, track.id, start, durationHint), duration: durationHint };
  };

  const onLaneDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const dragged = draggingMedia.current ? mediaRef.current.find((m) => m.id === draggingMedia.current) : undefined;
    if (!dragged && !hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropHint(laneTarget(event, dragged?.duration ?? 4, dragged));
  };

  const onLaneDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const dragged = draggingMedia.current ? mediaRef.current.find((m) => m.id === draggingMedia.current) : undefined;
    const files = Array.from(event.dataTransfer.files);
    if (!dragged && files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const hint = laneTarget(event, dragged?.duration ?? 4, dragged);
    setDropHint(null);
    setFileDrag(false);
    dragDepth.current = 0;
    draggingMedia.current = null;
    if (dragged) placeMedia([dragged], { start: hint?.start, trackId: hint?.trackId });
    else void importFiles(files, { add: true, start: hint?.start, trackId: hint?.trackId });
  };

  const rootDragEnter = (event: ReactDragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current += 1;
    setFileDrag(true);
  };
  const rootDragLeave = (event: ReactDragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setFileDrag(false);
  };
  const rootDragOver = (event: ReactDragEvent) => { if (hasFiles(event)) event.preventDefault(); };
  const rootDrop = (event: ReactDragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setFileDrag(false);
    void importFiles(Array.from(event.dataTransfer.files), { add: true });
  };

  /* ---- preview layers ---- */

  const isActive = (clip: Clip) => playhead >= clip.start && playhead < clip.start + clip.duration;
  const visualLayers: Array<{ clip: Clip; media: Media }> = [];
  const audioLayers: Array<{ clip: Clip; media: Media; muted: boolean }> = [];
  const titleLayers: Clip[] = [];
  for (const track of [...project.tracks].reverse()) {
    for (const clip of project.clips) {
      if (clip.trackId !== track.id || !isActive(clip)) continue;
      if (track.kind === "title" && !track.hidden) titleLayers.push(clip);
      const item = clip.mediaId ? mediaMap.get(clip.mediaId) : undefined;
      if (!item) continue;
      if (track.kind === "video" && !track.hidden) visualLayers.push({ clip, media: item });
      if (track.kind === "audio") audioLayers.push({ clip, media: item, muted: track.muted });
    }
  }

  /* ---- timeline geometry ---- */

  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 72) ?? 300;
  const ticks = Array.from({ length: Math.floor(timelineSeconds / step) + 1 }, (_, i) => i * step);
  const lanesWidth = timelineSeconds * pps;
  const scrollHeight = RULER_H + project.tracks.length * TRACK_H + ADD_ROW_H + 14;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const empty = project.clips.length === 0;
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved in this browser";

  return (
    <section className="vs" aria-label="Video studio" onClick={(event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (event.detail > 0 && button) button.blur();
    }} onDragEnter={rootDragEnter} onDragLeave={rootDragLeave} onDragOver={rootDragOver} onDrop={rootDrop}>
      <input ref={fileRef} type="file" accept="video/*,audio/*,image/*,.mkv,.mov,.m4v,.flac,.opus" multiple hidden onChange={onPicked} />

      <header className="vs-head">
        <div className="vs-head-title">
          <span className="vs-head-icon"><Clapperboard size={18} /></span>
          <div className="vs-head-text">
            <input className="vs-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
            <div className="vs-status" role="status" aria-live="polite">{importing > 0 ? "Reading " + importing + (importing === 1 ? " file…" : " files…") : status}</div>
          </div>
        </div>
        <span className={"vs-save " + saveState} title="Your project and files are saved in this browser, not uploaded anywhere.">{saveState === "saved" && <Check size={13} />}{saveLabel}</span>
        <button className="vs-secondary" onClick={newProject} title="Start a new, empty project"><FilePlus size={15} /> New</button>
        <button className="vs-export" onClick={() => { setPlaying(false); setExportOpen(true); }} disabled={empty} title={empty ? "Add a clip to export" : "Render your video to a file"}><Download size={16} /> Export</button>
      </header>

      <div className="vs-main">
        {/* Media panel */}
        <aside className="vs-panel vs-media" aria-label="Media panel">
          <div className="vs-panel-head">
            <div className="vs-tabs" role="tablist">
              <button role="tab" aria-selected={panelTab === "media"} className={panelTab === "media" ? "active" : ""} onClick={() => setPanelTab("media")}><Film size={14} /> Media</button>
              <button role="tab" aria-selected={panelTab === "text"} className={panelTab === "text" ? "active" : ""} onClick={() => setPanelTab("text")}><Type size={14} /> Text</button>
            </div>
            <button className="vs-icon-btn" onClick={() => pickFiles(false)} aria-label="Import media" title="Import video, audio or photos"><Upload size={16} /></button>
          </div>
          {panelTab === "media" ? (
            media.length === 0 ? (
              <div className="vs-bin-empty">
                <button className="vs-dropzone" onClick={() => pickFiles(false)}>
                  <Upload size={24} />
                  <b>Import your media</b>
                  <span>Video, music or photos from your device. You can also drop files here.</span>
                </button>
              </div>
            ) : (
              <>
                <div className="vs-bin">
                  {media.map((item) => (
                    <div className="vs-tile" key={item.id}>
                      <button
                        className="vs-tile-main"
                        draggable
                        onDragStart={(e) => { draggingMedia.current = item.id; e.dataTransfer.setData(MEDIA_MIME, item.id); e.dataTransfer.effectAllowed = "copy"; }}
                        onDragEnd={() => { draggingMedia.current = null; setDropHint(null); }}
                        onClick={() => placeMedia([item])}
                        title={"Add " + item.name + " at the playhead, or drag it onto the timeline"}
                      >
                        <span className="vs-tile-thumb" style={thumbStyle(item)}>
                          {item.kind === "audio" && <><Waveform peaks={item.peaks} /><Music2 size={18} className="vs-tile-glyph" /></>}
                          {item.kind === "video" && !item.strip && <Film size={20} className="vs-tile-glyph" />}
                          <span className="vs-tile-time">{item.kind === "image" ? "Photo" : shortTime(item.duration)}</span>
                          <span className="vs-tile-add"><Plus size={16} /></span>
                        </span>
                        <span className="vs-tile-name">{item.name}</span>
                      </button>
                      <button className="vs-tile-remove" onClick={() => removeMediaItem(item)} aria-label={"Remove " + item.name + " from the media panel"} title="Remove from media panel"><X size={13} /></button>
                    </div>
                  ))}
                </div>
                <p className="vs-panel-foot">Click a clip to add it at the playhead, or drag it onto a track.</p>
              </>
            )
          ) : (
            <div className="vs-presets">
              {titlePresets.map((preset) => (
                <button className="vs-preset" key={preset.name} onClick={() => addTitle(preset)}>
                  <span className={"vs-preset-sample " + preset.style}>Aa</span>
                  <span><b>{preset.name}</b><small>{preset.note}</small></span>
                  <Plus size={16} />
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Preview */}
        <div className="vs-panel vs-preview" aria-label="Preview">
          <div className="vs-stage">
            <div className="vs-frame" style={{ "--ratio": ASPECTS[aspect] } as CSSProperties}>
              {visualLayers.map(({ clip, media: item }) => (
                <MediaLayer key={clip.id} clip={clip} media={item} time={playhead} playing={playing} muted={trackById.get(clip.trackId)?.muted ?? false} asAudio={false} />
              ))}
              {audioLayers.map(({ clip, media: item, muted }) => (
                <MediaLayer key={clip.id} clip={clip} media={item} time={playhead} playing={playing} muted={muted} asAudio />
              ))}
              {titleLayers.map((clip) => (
                <div className={"vs-title-overlay " + (clip.titleStyle ?? "center")} style={{ opacity: clip.opacity * fadeFactor(clip, playhead), "--tc": clip.color ?? "#fff", "--ts": clip.size ?? 1 } as CSSProperties} key={clip.id}>
                  <div className="vs-title-text">{clip.text}</div>
                </div>
              ))}
              {empty && (
                <div className="vs-empty welcome">
                  <Clapperboard size={34} />
                  <b>Make your first video</b>
                  <span>Add clips, music or photos. They are placed on the timeline in order, ready to trim, split and export.</span>
                  <button className="vs-cta" onClick={() => pickFiles(true)}><Upload size={16} /> Add media</button>
                  <small>or drag files anywhere into this window</small>
                </div>
              )}
              {!empty && visualLayers.length === 0 && titleLayers.length === 0 && (
                <div className="vs-empty"><b>Nothing at this point</b><span>Move the playhead over a clip.</span></div>
              )}
              {selected && <span className="vs-chip">{selected.label} · {seconds1(selected.duration)}</span>}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside className="vs-panel vs-inspector" aria-label="Inspector">
          <div className="vs-panel-head"><b>{selected ? "Clip settings" : "Project"}</b></div>
          {selected ? (
            <div className="vs-fields">
              <label className="vs-field">Name
                <input className="vs-input" value={selected.label} onChange={(e) => updateClip(selected.id, { label: e.target.value }, true)} onBlur={endEdit} />
              </label>
              <dl className="vs-readout">
                <div><dt>Start</dt><dd>{timecode(selected.start)}</dd></div>
                <div><dt>Length</dt><dd>{seconds1(selected.duration)}</dd></div>
              </dl>

              {selected.text !== undefined && (
                <>
                  <label className="vs-field">Text
                    <textarea rows={3} value={selected.text} placeholder="Type your text" onChange={(e) => updateClip(selected.id, { text: e.target.value }, true)} onBlur={endEdit} />
                  </label>
                  <div className="vs-field">Style
                    <div className="vs-segment">
                      {(["center", "lower", "subtitle"] as TitleStyle[]).map((style) => (
                        <button key={style} className={selected.titleStyle === style ? "active" : ""} onClick={() => updateClip(selected.id, { titleStyle: style })}>{style === "lower" ? "Lower third" : style === "center" ? "Center" : "Subtitle"}</button>
                      ))}
                    </div>
                  </div>
                  <div className="vs-field">Color
                    <div className="vs-swatches">
                      {TEXT_COLORS.map((color) => (
                        <button key={color} className={(selected.color ?? "#ffffff") === color ? "active" : ""} style={{ background: color }} aria-label={"Text color " + color} onClick={() => updateClip(selected.id, { color })} />
                      ))}
                    </div>
                  </div>
                  <label className="vs-field">Size <output>{Math.round((selected.size ?? 1) * 100)}%</output>
                    <input type="range" min={0.5} max={2} step={0.05} value={selected.size ?? 1} onChange={(e) => updateClip(selected.id, { size: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
                  </label>
                </>
              )}

              {selectedMedia && selectedMedia.kind !== "image" && (
                <div className="vs-field">Speed
                  <div className="vs-segment wrap">
                    {SPEEDS.map((value) => (
                      <button key={value} className={selected.speed === value ? "active" : ""} onClick={() => setSpeed(selected, value)}>{value}×</button>
                    ))}
                  </div>
                </div>
              )}

              {selectedMedia && selectedMedia.kind !== "image" && (
                <label className="vs-field">Volume <output>{Math.round(selected.volume * 100)}%</output>
                  <input type="range" min={0} max={1} step={0.01} value={selected.volume} onChange={(e) => updateClip(selected.id, { volume: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
                </label>
              )}

              {selectedTrack?.kind !== "audio" && (
                <label className="vs-field">Opacity <output>{Math.round(selected.opacity * 100)}%</output>
                  <input type="range" min={0} max={1} step={0.01} value={selected.opacity} onChange={(e) => updateClip(selected.id, { opacity: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
                </label>
              )}

              {selectedTrack?.kind === "video" && selectedMedia && (
                <>
                  <div className="vs-field">Framing
                    <div className="vs-segment">
                      <button className={selected.fit === "contain" ? "active" : ""} onClick={() => updateClip(selected.id, { fit: "contain" })}>Fit</button>
                      <button className={selected.fit === "cover" ? "active" : ""} onClick={() => updateClip(selected.id, { fit: "cover" })}>Fill</button>
                    </div>
                  </div>
                  <label className="vs-field">Zoom <output>{Math.round(selected.zoom * 100)}%</output>
                    <input type="range" min={1} max={3} step={0.05} value={selected.zoom} onChange={(e) => updateClip(selected.id, { zoom: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
                  </label>
                </>
              )}

              <label className="vs-field">Fade in <output>{selected.fadeIn.toFixed(1)}s</output>
                <input type="range" min={0} max={Math.min(5, selected.duration / 2)} step={0.1} value={Math.min(selected.fadeIn, selected.duration / 2)} onChange={(e) => updateClip(selected.id, { fadeIn: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
              </label>
              <label className="vs-field">Fade out <output>{selected.fadeOut.toFixed(1)}s</output>
                <input type="range" min={0} max={Math.min(5, selected.duration / 2)} step={0.1} value={Math.min(selected.fadeOut, selected.duration / 2)} onChange={(e) => updateClip(selected.id, { fadeOut: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} />
              </label>
            </div>
          ) : (
            <div className="vs-fields">
              <dl className="vs-readout">
                <div><dt>Length</dt><dd>{timecode(contentEnd)}</dd></div>
                <div><dt>Clips</dt><dd>{project.clips.length}</dd></div>
              </dl>
              <div className="vs-field">Frame shape
                <div className="vs-segment">
                  {(Object.keys(ASPECTS) as Aspect[]).map((value) => (
                    <button key={value} className={aspect === value ? "active" : ""} onClick={() => setAspect(value)}>{value}</button>
                  ))}
                </div>
              </div>
              <p className="vs-hint">16:9 suits YouTube and TV, 9:16 suits phones and Reels, 1:1 suits feeds. Select a clip to edit it.</p>
              <ul className="vs-keys">
                <li><kbd>Space</kbd> play or pause</li>
                <li><kbd>S</kbd> split at playhead</li>
                <li><kbd>Delete</kbd> remove, <kbd>Shift</kbd> + <kbd>Delete</kbd> removes and closes the gap</li>
                <li><kbd>←</kbd> <kbd>→</kbd> one frame, with <kbd>Shift</kbd> one second</li>
                <li><kbd>Ctrl</kbd> + <kbd>Z</kbd> undo, <kbd>Ctrl</kbd> + <kbd>D</kbd> duplicate</li>
                <li><kbd>+</kbd> <kbd>-</kbd> zoom the timeline</li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* Transport, timeline, toolbar */}
      <div className="vs-panel vs-bottom">
        <div className="vs-transport">
          <div className="vs-timecode" aria-label="Current time"><b>{timecode(playhead)}</b><span>/ {timecode(contentEnd)}</span></div>
          <div className="vs-controls">
            <button className="vs-icon-btn" aria-label="Go to start" title="Go to start (Home)" onClick={() => { setPlaying(false); seek(0); }}><SkipBack size={17} /></button>
            <button className="vs-icon-btn" aria-label="Back one frame" title="Back one frame (←)" onClick={() => actions.current?.step(-1 / FPS)}><StepBack size={17} /></button>
            <button className="vs-play" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button className="vs-icon-btn" aria-label="Forward one frame" title="Forward one frame (→)" onClick={() => actions.current?.step(1 / FPS)}><StepForward size={17} /></button>
            <button className="vs-icon-btn" aria-label="Go to end" title="Go to end (End)" onClick={() => actions.current?.seekEnd()}><SkipForward size={17} /></button>
          </div>
          <div className="vs-zoom">
            <ZoomOut size={15} />
            <input type="range" min={12} max={300} step={2} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" />
            <ZoomIn size={15} />
            <button className="vs-icon-btn" onClick={fitTimeline} aria-label="Fit timeline to window" title="Fit timeline to window" disabled={empty}><Maximize2 size={15} /></button>
          </div>
        </div>

        <div className="vs-tl-scroll" ref={scrollRef} style={{ height: Math.min(scrollHeight, 252) }}>
          <div className="vs-tl-inner" style={{ width: LABEL_W + lanesWidth }}>
            <div className="vs-ruler-row" style={{ height: RULER_H }}>
              <div className="vs-ruler-spacer" style={{ width: LABEL_W }} />
              <div
                className="vs-ruler" ref={rulerRef}
                style={{ width: lanesWidth, backgroundSize: (step * pps) / 5 + "px 8px" }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubbing.current = true; setPlaying(false); seek(timeAt(e.clientX, rulerRef.current)); }}
                onPointerMove={(e) => { if (scrubbing.current) seek(timeAt(e.clientX, rulerRef.current)); }}
                onPointerUp={() => { scrubbing.current = false; }}
                onPointerCancel={() => { scrubbing.current = false; }}
              >
                {ticks.map((t) => <span className="vs-tick" key={t} style={{ left: t * pps }}>{shortTime(t)}</span>)}
              </div>
            </div>

            <div className="vs-body">
              <div className="vs-labels" style={{ width: LABEL_W }}>
                {project.tracks.map((track) => {
                  const removable = track.kind !== "title" && project.tracks.filter((t) => t.kind === track.kind).length > 1 && !project.clips.some((c) => c.trackId === track.id);
                  return (
                    <div className={"vs-label" + (track.locked ? " locked" : "")} style={{ height: TRACK_H }} key={track.id}>
                      <span className="vs-label-name" title={track.name}>{track.name}</span>
                      <span className="vs-label-actions">
                        {track.kind === "audio" ? (
                          <button title={track.muted ? "Unmute track" : "Mute track"} aria-label={(track.muted ? "Unmute " : "Mute ") + track.name} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                        ) : (
                          <button title={track.hidden ? "Show track" : "Hide track"} aria-label={(track.hidden ? "Show " : "Hide ") + track.name} aria-pressed={track.hidden} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>{track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        )}
                        <button title={track.locked ? "Unlock track" : "Lock track"} aria-label={(track.locked ? "Unlock " : "Lock ") + track.name} aria-pressed={track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                        {removable && <button className="remove" title="Remove empty track" aria-label={"Remove " + track.name} onClick={() => removeTrack(track)}><X size={13} /></button>}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                className="vs-lanes" ref={lanesRef}
                style={{ width: lanesWidth, height: project.tracks.length * TRACK_H }}
                onPointerDown={(e) => { setSelectedId(null); seek(timeAt(e.clientX, lanesRef.current)); }}
                onDragOver={onLaneDragOver}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(null); }}
                onDrop={onLaneDrop}
              >
                {project.tracks.map((track, row) => (
                  <div className={"vs-lane " + track.kind + (track.locked ? " locked" : "") + (track.hidden || track.muted ? " off" : "")} style={{ top: row * TRACK_H, height: TRACK_H }} key={track.id} />
                ))}
                {project.clips.map((clip) => {
                  const track = trackById.get(clip.trackId);
                  const item = clip.mediaId ? mediaMap.get(clip.mediaId) : undefined;
                  const isSelected = clip.id === selectedId;
                  const row = trackIndex.get(clip.trackId) ?? 0;
                  const kindClass = track?.kind === "audio" ? "audio" : (track?.kind ?? "video");
                  const width = Math.max(clip.duration * pps, 6);
                  const peakFrom = item ? clip.inPoint / item.duration : 0;
                  const peakTo = item ? (clip.inPoint + clip.duration * clip.speed) / item.duration : 1;
                  return (
                    <div
                      key={clip.id}
                      className={"vs-clip " + kindClass + (isSelected ? " selected" : "") + (track?.locked ? " locked" : "")}
                      style={{ left: clip.start * pps, width, top: row * TRACK_H + 4, height: TRACK_H - 8 }}
                      onPointerDown={(e) => beginDrag(e, clip, "move")}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      role="button"
                      tabIndex={0}
                      aria-label={clip.label + ", " + seconds1(clip.duration) + " at " + timecode(clip.start)}
                      aria-pressed={isSelected}
                      onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(clip.id); }}
                    >
                      {track?.kind === "video" && item && <FrameStrip media={item} clip={clip} pps={pps} height={TRACK_H - 10} />}
                      {track?.kind === "audio" && <Waveform peaks={item?.peaks} from={peakFrom} to={peakTo} />}
                      <span className="vs-clip-label">
                        {track?.kind === "audio" && <AudioLines size={11} />}
                        {track?.kind === "title" ? (clip.text?.trim() || "Empty text") : clip.label}
                        {clip.speed !== 1 && <em>{clip.speed}×</em>}
                      </span>
                      {!track?.locked && (
                        <>
                          <span className="vs-handle left" onPointerDown={(e) => beginDrag(e, clip, "left")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                          <span className="vs-handle right" onPointerDown={(e) => beginDrag(e, clip, "right")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                        </>
                      )}
                    </div>
                  );
                })}
                {dropHint && (
                  <div className="vs-drop-hint" style={{ left: dropHint.start * pps, width: Math.max(dropHint.duration * pps, 24), top: (trackIndex.get(dropHint.trackId) ?? 0) * TRACK_H + 4, height: TRACK_H - 8 }} />
                )}
                {empty && !dropHint && <div className="vs-lanes-empty">Drop media here, or click a clip in the media panel.</div>}
              </div>
            </div>

            <div className="vs-add-row" style={{ height: ADD_ROW_H }}>
              <div className="vs-add-label" style={{ width: LABEL_W }}>
                <button onClick={() => addTrack("video")} title="Add a video track above the others"><Plus size={12} /> Video</button>
                <button onClick={() => addTrack("audio")} title="Add an audio track"><Plus size={12} /> Audio</button>
              </div>
            </div>

            <div className="vs-playhead" style={{ left: LABEL_W + playhead * pps }} aria-hidden="true" />
          </div>
        </div>

        <div className="vs-toolbar">
          <div className="vs-tool-group">
            <ToolButton icon={Undo2} label="Undo" hint="Ctrl+Z" onClick={undo} disabled={!canUndo} />
            <ToolButton icon={Redo2} label="Redo" hint="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} />
            <ToolButton icon={RotateCcw} label="Clear all" onClick={clearTimeline} disabled={empty} />
          </div>
          <div className="vs-tool-group center">
            <ToolButton icon={Scissors} label="Split" hint="S" onClick={split} disabled={empty} />
            <ToolButton icon={Copy} label="Duplicate" hint="Ctrl+D" onClick={duplicate} disabled={!selected} />
            <ToolButton icon={Trash2} label="Delete" hint="Delete" onClick={() => remove(false)} disabled={!selected} />
            <ToolButton icon={Unlink} label="Detach audio" onClick={detachAudio} disabled={!(selectedMedia?.kind === "video" && selectedTrack?.kind === "video")} />
            <ToolButton icon={Magnet} label="Snap" onClick={() => setSnapOn((v) => !v)} active={snapOn} />
          </div>
          <div className="vs-tool-group right">
            <ToolButton icon={Type} label="Add text" onClick={() => addTitle(titlePresets[0])} />
            <ToolButton icon={ImageIcon} label="Import" onClick={() => pickFiles(false)} />
          </div>
        </div>
      </div>

      {fileDrag && (
        <div className="vs-drop-overlay" aria-hidden="true">
          <Upload size={34} />
          <b>Drop to add to your video</b>
          <span>Video, music and photos are placed on the timeline.</span>
        </div>
      )}
      {exportOpen && <ExportDialog project={project} media={mediaMap} aspect={aspect} name={projectName} onClose={() => setExportOpen(false)} />}
    </section>
  );
}
