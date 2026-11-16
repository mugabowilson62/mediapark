import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeftToLine, ArrowRightToLine, AudioLines, Check, ClipboardPaste, Copy, Download, FilePlus,
  Headphones, Magnet, Mic, Pause, Play, Plus, Redo2, Scissors, SkipBack, Slice, Square, Trash2,
  Undo2, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import "./videostudio.css";
import "./audiostudio.css";
import { clamp, uid } from "./studio/utils";
import {
  TRACK_COLORS, defaultFx, defaultMeta, defaultTracks, type AClip, type AProject, type ATrack, type Fx, type Meta, type Source,
} from "./audio/types";
import {
  applyTrack, computeSourcePeaks, createMaster, createTrack, decodeBlob, ensureGate, isAudible, projectEnd,
  renderMix, scheduleClips, type TrackNodes,
} from "./audio/engine";
import { detectAac, encodeAac, encodeMp3, encodeWav, type AudioFormat } from "./audio/encoders";
import { clearAudio, deleteFile, loadAudio, saveAudioProject, saveFile } from "./audio/storage";

/* ------------------------------------------------------------------ */
/* Constants and helpers                                               */
/* ------------------------------------------------------------------ */

const LABEL_W = 232;
const TRACK_H = 98;
const RULER_H = 30;
const ADD_ROW_H = 38;
const SNAP_PX = 8;
const MIN_CLIP = 0.1;
const MAX_TRACKS = 8;

type Drag = { mode: "move" | "left" | "right" | "fadeIn" | "fadeOut"; id: string; x0: number; y0: number; orig: AClip; moved: boolean };
type Clipboard = { clip: AClip } | null;
type Engine = {
  ctx: AudioContext; master: { input: GainNode; output: AudioNode }; nodes: Map<string, TrackNodes>; gate: boolean;
  started: AudioBufferSourceNode[]; from: number; startedAt: number; analysers: [AnalyserNode, AnalyserNode];
};
type Actions = {
  togglePlay: () => void; split: () => void; duplicate: () => void; remove: () => void; copy: () => void; cut: () => void;
  paste: () => void; undo: () => void; redo: () => void; seek: (t: number) => void; seekEnd: () => void; zoom: (f: number) => void;
  nudge: (s: number) => void;
};

const fmtTime = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0") + "." + String(Math.floor((s % 1) * 100)).padStart(2, "0");
};
const shortTime = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.round(seconds % 60) % 60).padStart(2, "0");
const panLabel = (pan: number) => (Math.abs(pan) < 0.01 ? "C" : pan < 0 ? "L" + Math.round(-pan * 100) : "R" + Math.round(pan * 100));

function freeStart(clips: AClip[], trackId: string, desired: number, length: number): number {
  const onTrack = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let start = Math.max(0, desired);
  for (const c of onTrack) if (start < c.start + c.duration - 1e-6 && start + length > c.start + 1e-6) start = c.start + c.duration;
  return start;
}

function placeClip(clips: AClip[], self: AClip, trackId: string, desired: number): number | null {
  const centre = desired + self.duration / 2;
  let low = 0;
  let high = Infinity;
  for (const c of clips) {
    if (c.trackId !== trackId || c.id === self.id) continue;
    if (c.start + c.duration / 2 < centre) low = Math.max(low, c.start + c.duration); else high = Math.min(high, c.start);
  }
  if (high - low < self.duration - 1e-6) return null;
  return clamp(desired, low, high - self.duration);
}

function buildWave(peaks: number[], from: number, to: number, gain: number): string {
  const count = 140;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = clamp(Math.floor((from + ((to - from) * i) / count) * peaks.length), 0, peaks.length - 1);
    const b = clamp(Math.ceil((from + ((to - from) * (i + 1)) / count) * peaks.length), a + 1, peaks.length);
    let value = 0;
    for (let k = a; k < b; k++) value = Math.max(value, peaks[k]);
    const x = (i / (count - 1)) * 100;
    const amp = clamp((0.03 + 0.97 * value) * gain, 0.02, 1) * 46;
    top.push(x.toFixed(2) + "," + (50 - amp).toFixed(2));
    bottom.unshift(x.toFixed(2) + "," + (50 + amp).toFixed(2));
  }
  return top.concat(bottom).join(" ");
}

function ClipWave({ source, clip }: { source: Source; clip: AClip }) {
  const points = useMemo(
    () => buildWave(source.peaks, clip.offset / source.duration, (clip.offset + clip.duration) / source.duration, clip.gain),
    [source, clip.offset, clip.duration, clip.gain],
  );
  return <svg className="as-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points} /></svg>;
}

function Slider({ label, value, min, max, step, format, onChange, onCommit, disabled }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string;
  onChange: (v: number) => void; onCommit: () => void; disabled?: boolean;
}) {
  return (
    <label className="vs-field as-slider">{label} <output>{format(value)}</output>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onBlur={onCommit} onKeyUp={onCommit} />
    </label>
  );
}

function ToolButton({ icon: Icon, label, hint, onClick, disabled, active }: {
  icon: LucideIcon; label: string; hint?: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button className={"vs-tool" + (active ? " active" : "")} onClick={onClick} disabled={disabled} aria-pressed={active} title={hint ? label + " (" + hint + ")" : label}>
      <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Export dialog                                                       */
/* ------------------------------------------------------------------ */

function AudioExportDialog({ project, sources, meta, setMeta, name, onClose }: {
  project: AProject; sources: Map<string, Source>; meta: Meta; setMeta: (m: Meta) => void; name: string; onClose: () => void;
}) {
  const [format, setFormat] = useState<AudioFormat>("wav");
  const [sampleRate, setSampleRate] = useState(44100);
  const [bitrate, setBitrate] = useState(192);
  const [normalize, setNormalize] = useState(true);
  const [aac, setAac] = useState<"adts" | "m4a" | null | undefined>(undefined);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ url: string; size: number; extension: string; note?: string } | null>(null);
  const urlRef = useRef<string | null>(null);
  const cancelled = useRef(false);
  const length = projectEnd(project);

  useEffect(() => { void detectAac(44100).then(setAac); }, []);
  const close = useCallback(() => {
    cancelled.current = true;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    onClose();
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(() => () => { cancelled.current = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const setField = (key: keyof Meta, value: string) => setMeta({ ...meta, [key]: value });
  const bitrates = format === "mp3" ? [128, 192, 256, 320] : [96, 128, 192, 256];
  const effectiveBitrate = bitrates.includes(bitrate) ? bitrate : bitrates[1];
  const base = (meta.title.trim() || name.trim() || "mix").replace(/[\\/:*?"<>|]+/g, "").trim();
  const fileName = (meta.artist.trim() ? meta.artist.trim().replace(/[\\/:*?"<>|]+/g, "") + " - " : "") + base;

  const start = async () => {
    cancelled.current = false;
    setPhase("working");
    setProgress(0);
    try {
      setStage("Mixing your tracks…");
      const meta2: Meta = { ...meta, title: meta.title.trim() || name.trim() };
      const rendered = await renderMix(project, sources, sampleRate, normalize);
      if (cancelled.current) return;
      setStage(format === "wav" ? "Writing WAV file…" : "Encoding " + format.toUpperCase() + "…");
      const onProgress = (f: number) => { if (!cancelled.current) setProgress(f); };
      const output = format === "wav" ? encodeWav(rendered, meta2)
        : format === "mp3" ? await encodeMp3(rendered, effectiveBitrate, meta2, onProgress)
        : await encodeAac(rendered, effectiveBitrate, meta2, aac ?? null, onProgress);
      if (cancelled.current) return;
      const url = URL.createObjectURL(output.blob);
      urlRef.current = url;
      setResult({ url, size: output.blob.size, extension: output.extension, note: output.note });
      setPhase("done");
    } catch (error) {
      if (cancelled.current) return;
      setMessage(error instanceof Error ? error.message : "Something went wrong while exporting.");
      setPhase("error");
    }
  };

  return (
    <div className="vs-dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && phase !== "working") close(); }}>
      <div className="vs-dialog as-dialog" role="dialog" aria-modal="true" aria-labelledby="as-export-title">
        <div className="vs-dialog-head"><h3 id="as-export-title">Export audio</h3><button className="vs-icon-btn" onClick={close} aria-label="Close"><X size={18} /></button></div>

        {phase === "idle" && (
          <div className="vs-dialog-body">
            <div className="vs-field">Format
              <div className="vs-segment">
                {(["wav", "mp3", "aac"] as AudioFormat[]).map((f) => (
                  <button key={f} className={format === f ? "active" : ""} onClick={() => setFormat(f)} disabled={f === "aac" && aac === null} title={f === "aac" && aac === null ? "This browser can't encode AAC" : undefined}>.{f}</button>
                ))}
              </div>
              {format === "wav" && <small className="as-note">Lossless, largest files.</small>}
              {format === "mp3" && <small className="as-note">Plays everywhere. Tags are embedded as ID3.</small>}
              {format === "aac" && aac === "m4a" && <small className="as-note">This browser saves AAC as .m4a in real time. Tags can't be embedded.</small>}
              {format === "aac" && aac === "adts" && <small className="as-note">Efficient and widely supported. Tags are embedded as ID3.</small>}
              {format === "aac" && aac === null && <small className="as-note warn">AAC isn't available in this browser.</small>}
            </div>
            <div className="as-two">
              <div className="vs-field">Sample rate
                <div className="vs-segment">{[44100, 48000].map((r) => <button key={r} className={sampleRate === r ? "active" : ""} onClick={() => setSampleRate(r)}>{r / 1000} kHz</button>)}</div>
              </div>
              {format !== "wav" && (
                <div className="vs-field">Bitrate
                  <div className="vs-segment">{bitrates.map((b) => <button key={b} className={effectiveBitrate === b ? "active" : ""} onClick={() => setBitrate(b)}>{b}</button>)}</div>
                </div>
              )}
            </div>
            <label className="as-check"><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> Normalize loudness to −1 dB</label>

            <fieldset className="as-meta">
              <legend>Metadata written into the file</legend>
              <label className="vs-field">Track title<input className="vs-input" value={meta.title} placeholder={name} onChange={(e) => setField("title", e.target.value)} /></label>
              <label className="vs-field">Artist<input className="vs-input" value={meta.artist} placeholder="Your name" onChange={(e) => setField("artist", e.target.value)} /></label>
              <label className="vs-field">Album<input className="vs-input" value={meta.album} placeholder="Album or collection" onChange={(e) => setField("album", e.target.value)} /></label>
              <div className="as-two">
                <label className="vs-field">Year<input className="vs-input" inputMode="numeric" maxLength={4} value={meta.year} placeholder="2026" onChange={(e) => setField("year", e.target.value.replace(/\D/g, ""))} /></label>
                <label className="vs-field">Genre<input className="vs-input" value={meta.genre} placeholder="Optional" onChange={(e) => setField("genre", e.target.value)} /></label>
              </div>
            </fieldset>
            <p className="vs-hint">Length {shortTime(length)}. Muted tracks are left out, and if any track is soloed only soloed tracks are included.</p>
            <button className="vs-cta" onClick={start} disabled={length <= 0}><Download size={16} /> Export .{format}</button>
          </div>
        )}

        {phase === "working" && (
          <div className="vs-dialog-body">
            <div className={"vs-progress" + (progress === 0 ? " busy" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: (progress === 0 ? 35 : progress * 100) + "%" }} /></div>
            <p className="vs-hint"><b>{stage}</b> {progress > 0 && Math.round(progress * 100) + "%"}</p>
            <button className="vs-secondary" onClick={() => { cancelled.current = true; setPhase("idle"); }}>Cancel</button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="vs-dialog-body">
            <audio className="as-result" src={result.url} controls />
            <p className="vs-hint">Ready: {(result.size / 1048576).toFixed(2)} MB, .{result.extension}. {result.note}</p>
            <a className="vs-cta" href={result.url} download={fileName + "." + result.extension}><Download size={16} /> Download {fileName}.{result.extension}</a>
          </div>
        )}

        {phase === "error" && (
          <div className="vs-dialog-body"><p className="vs-alert">{message}</p><button className="vs-cta" onClick={() => setPhase("idle")}>Back</button></div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export default function AudioStudio() {
  const [sources, setSources] = useState<Source[]>([]);
  const [project, setProject] = useState<AProject>(() => ({ tracks: defaultTracks(), clips: [] }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>("a-voice");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [pps, setPps] = useState(48);
  const [snapOn, setSnapOn] = useState(true);
  const [sideTab, setSideTab] = useState<"fx" | "clip">("fx");
  const [name, setName] = useState("Untitled mix");
  const [meta, setMeta] = useState<Meta>(defaultMeta);
  const [status, setStatus] = useState("Import audio or record a voiceover to begin.");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [importing, setImporting] = useState(0);
  const [fileDrag, setFileDrag] = useState(false);
  const [dropHint, setDropHint] = useState<{ trackId: string; start: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [, setHistoryVersion] = useState(0);

  const projectRef = useRef(project); projectRef.current = project;
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  const playingRef = useRef(false); playingRef.current = playing;
  const ppsRef = useRef(pps); ppsRef.current = pps;
  const playheadRef = useRef(0);
  const selectedTrackRef = useRef(selectedTrackId); selectedTrackRef.current = selectedTrackId;
  const pastRef = useRef<AProject[]>([]);
  const futureRef = useRef<AProject[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const scrubbing = useRef(false);
  const editGuard = useRef(false);
  const statusTimer = useRef<number | undefined>(undefined);
  const restartTimer = useRef<number | undefined>(undefined);
  const engineRef = useRef<Engine | null>(null);
  const clipboardRef = useRef<Clipboard>(null);
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; startAt: number; trackId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const meterL = useRef<HTMLSpanElement>(null);
  const meterR = useRef<HTMLSpanElement>(null);
  const dragDepth = useRef(0);
  const actions = useRef<Actions | null>(null);

  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const trackById = useMemo(() => new Map(project.tracks.map((t) => [t.id, t])), [project.tracks]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;
  const selectedTrack = trackById.get(selectedTrackId) ?? project.tracks[0];
  const contentEnd = projectEnd(project);
  const endRef = useRef(contentEnd); endRef.current = contentEnd;
  const timelineSeconds = Math.max(contentEnd + 10, 40);
  const empty = project.clips.length === 0;
  const soloActive = project.tracks.some((t) => t.solo);

  /* ---- status, history, persistence ---- */

  const flash = (message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(projectRef.current.clips.length ? "Ready." : "Import audio or record a voiceover to begin."), 5200);
  };
  useEffect(() => () => { window.clearTimeout(statusTimer.current); window.clearTimeout(restartTimer.current); }, []);

  const snapshot = () => { pastRef.current = [...pastRef.current.slice(-99), projectRef.current]; futureRef.current = []; setHistoryVersion((v) => v + 1); };
  const change = (fn: (p: AProject) => AProject) => { snapshot(); setProject(fn); };
  const liveEdit = (fn: (p: AProject) => AProject) => { if (!editGuard.current) { snapshot(); editGuard.current = true; } setProject(fn); };
  const endEdit = () => { editGuard.current = false; };
  const undo = () => { const prev = pastRef.current.pop(); if (!prev) return; futureRef.current.push(projectRef.current); setProject(prev); setHistoryVersion((v) => v + 1); };
  const redo = () => { const next = futureRef.current.pop(); if (!next) return; pastRef.current.push(projectRef.current); setProject(next); setHistoryVersion((v) => v + 1); };
  const updateClip = (id: string, patch: Partial<AClip>, live = false) => {
    const apply = (p: AProject): AProject => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    if (live) liveEdit(apply); else change(apply);
  };
  const updateTrack = (id: string, patch: Partial<ATrack>, live = false) => {
    const apply = (p: AProject): AProject => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    if (live) liveEdit(apply); else change(apply);
  };
  const updateFx = (id: string, fn: (fx: Fx) => Fx) => {
    liveEdit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, fx: fn(t.fx) } : t)) }));
  };

  // Restore the last session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadAudio();
      if (cancelled) return;
      if (data?.project) {
        const used = new Set(data.project.project.clips.map((c) => c.sourceId));
        const loaded: Source[] = [];
        for (const file of data.files) {
          if (!used.has(file.id)) { void deleteFile(file.id).catch(() => undefined); continue; }
          try {
            const buffer = await decodeBlob(file.blob);
            loaded.push({ id: file.id, name: file.name, duration: buffer.duration, buffer, peaks: computeSourcePeaks(buffer), blob: file.blob });
          } catch { /* skip unreadable file */ }
        }
        if (cancelled) return;
        const known = new Set(loaded.map((s) => s.id));
        setSources(loaded);
        setProject({ tracks: data.project.project.tracks, clips: data.project.project.clips.filter((c) => known.has(c.sourceId)) });
        setMeta(data.project.meta);
        setName(data.project.name);
        if (data.project.project.clips.length) setStatus("Welcome back. Your last session was restored.");
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveState("saving");
    const id = window.setTimeout(() => {
      saveAudioProject({ project, meta, name }).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 700);
    return () => window.clearTimeout(id);
  }, [project, meta, name, ready]);

  /* ---- audio engine ---- */

  const syncTracks = useCallback((smooth: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    const { tracks } = projectRef.current;
    for (const track of tracks) {
      let nodes = e.nodes.get(track.id);
      if (!nodes) { nodes = createTrack(e.ctx, e.master.input, e.gate); e.nodes.set(track.id, nodes); }
      applyTrack(e.ctx, nodes, track, isAudible(track, tracks), smooth);
    }
    for (const id of Array.from(e.nodes.keys())) {
      if (!tracks.some((t) => t.id === id)) { e.nodes.get(id)?.pan.disconnect(); e.nodes.delete(id); }
    }
  }, []);

  const ensureEngine = async (): Promise<Engine> => {
    let e = engineRef.current;
    if (!e) {
      const ctx = new AudioContext();
      const gate = await ensureGate(ctx);
      const master = createMaster(ctx);
      const splitter = ctx.createChannelSplitter(2);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = right.fftSize = 512;
      master.output.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      e = { ctx, master, nodes: new Map(), gate, started: [], from: 0, startedAt: 0, analysers: [left, right] };
      engineRef.current = e;
    }
    if (e.ctx.state === "suspended") await e.ctx.resume();
    return e;
  };

  const stopSources = () => {
    const e = engineRef.current;
    if (!e) return;
    for (const s of e.started) { try { s.stop(); } catch { /* already stopped */ } }
    e.started = [];
  };

  const startPlayback = async (from: number) => {
    const e = await ensureEngine();
    stopSources();
    syncTracks(false);
    e.from = from;
    e.startedAt = e.ctx.currentTime + 0.06;
    e.started = scheduleClips(e.ctx, e.nodes, projectRef.current.clips, new Map(sourcesRef.current.map((s) => [s.id, s])), from, e.startedAt);
  };

  const scheduleRestart = () => {
    window.clearTimeout(restartTimer.current);
    restartTimer.current = window.setTimeout(() => { if (playingRef.current) void startPlayback(playheadRef.current); }, 140);
  };

  // Track settings (volume, pan, mute, solo, effects) apply live.
  useEffect(() => { syncTracks(true); }, [project.tracks, syncTracks]);
  // Clip edits while playing re-schedule from the current position.
  useEffect(() => { if (playingRef.current) scheduleRestart(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [project.clips]);

  useEffect(() => () => {
    stopSources();
    void engineRef.current?.ctx.close().catch(() => undefined);
    engineRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = (time: number) => {
    const value = Math.max(0, time);
    playheadRef.current = value;
    setPlayhead(value);
    const e = engineRef.current;
    if (e && playingRef.current) { e.from = value; e.startedAt = e.ctx.currentTime; scheduleRestart(); }
  };

  const togglePlay = async () => {
    if (playing) { stopSources(); setPlaying(false); return; }
    if (endRef.current <= 0) { flash("Add a clip first: import audio or record a voiceover."); return; }
    let from = playheadRef.current;
    if (from >= endRef.current - 0.02) { from = 0; playheadRef.current = 0; setPlayhead(0); }
    await startPlayback(from);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) {
      if (meterL.current) meterL.current.style.width = "0%";
      if (meterR.current) meterR.current.style.width = "0%";
      return;
    }
    let frame = 0;
    const buf = new Float32Array(512);
    const level = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      return clamp((20 * Math.log10(peak + 1e-6) + 60) / 60, 0, 1) * 100;
    };
    const tick = () => {
      const e = engineRef.current;
      if (!e) return;
      const t = e.from + Math.max(0, e.ctx.currentTime - e.startedAt);
      if (t >= endRef.current + 0.1 && !recorderRef.current) {
        stopSources();
        playheadRef.current = endRef.current;
        setPlayhead(endRef.current);
        setPlaying(false);
        return;
      }
      playheadRef.current = t;
      setPlayhead(t);
      if (meterL.current) meterL.current.style.width = level(e.analysers[0]) + "%";
      if (meterR.current) meterR.current.style.width = level(e.analysers[1]) + "%";
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
      setPps((v) => clamp(v * (1 - event.deltaY * 0.0025), 8, 300));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  /* ---- sources, import, recording ---- */

  const addSourceFromBlob = async (blob: Blob, label: string): Promise<Source | null> => {
    try {
      const buffer = await decodeBlob(blob);
      const source: Source = { id: uid("s"), name: label, duration: buffer.duration, buffer, peaks: computeSourcePeaks(buffer), blob };
      setSources((prev) => [...prev, source]);
      sourcesRef.current = [...sourcesRef.current, source];
      saveFile({ id: source.id, name: source.name, blob }).catch(() => { setSaveState("error"); flash("Browser storage is full. This file will be gone after a refresh."); });
      return source;
    } catch {
      return null;
    }
  };

  const placeSources = (items: Source[], trackId: string, start: number) => {
    let clips = projectRef.current.clips;
    let cursor = start;
    const created: AClip[] = [];
    for (const source of items) {
      const at = freeStart(clips, trackId, cursor, source.duration);
      const clip: AClip = { id: uid("c"), trackId, sourceId: source.id, label: source.name, start: at, offset: 0, duration: source.duration, gain: 1, fadeIn: 0, fadeOut: 0 };
      clips = [...clips, clip];
      created.push(clip);
      cursor = at + source.duration;
    }
    if (created.length === 0) return;
    change((p) => ({ ...p, clips: [...p.clips, ...created] }));
    setSelectedId(created[created.length - 1].id);
    setSelectedTrackId(trackId);
    flash(created.length === 1 ? "Added " + created[0].label + " to " + (projectRef.current.tracks.find((t) => t.id === trackId)?.name ?? "the track") + "." : "Added " + created.length + " clips.");
  };

  const importFiles = async (files: File[], target?: { trackId: string; start: number }) => {
    if (files.length === 0) return;
    setImporting((n) => n + files.length);
    const added: Source[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const source = await addSourceFromBlob(file, file.name.replace(/\.[^.]+$/, "") || "Audio");
      if (source) added.push(source); else rejected.push(file.name);
    }
    setImporting((n) => n - files.length);
    if (added.length > 0) {
      const track = projectRef.current.tracks.find((t) => t.id === (target?.trackId ?? selectedTrackRef.current)) ?? projectRef.current.tracks[0];
      placeSources(added, track.id, target?.start ?? playheadRef.current);
    }
    if (rejected.length > 0) flash("Couldn't read " + rejected.slice(0, 2).join(", ") + (rejected.length > 2 ? " and more" : "") + ". Try MP3, WAV, M4A, OGG, FLAC, or a video file.");
  };

  const stopRecording = () => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.recorder.state !== "inactive") r.recorder.stop();
    setRecording(false);
    stopSources();
    setPlaying(false);
  };

  const startRecording = async () => {
    if (recording) { stopRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { flash("Recording isn't available in this browser."); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    } catch {
      flash("Microphone access was blocked. Allow it in the address bar, then try again.");
      return;
    }
    const trackId = selectedTrackRef.current;
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const startAt = playheadRef.current;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      void (async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const count = sourcesRef.current.filter((s) => s.name.startsWith("Recording")).length + 1;
        const source = await addSourceFromBlob(blob, "Recording " + count);
        if (source) placeSources([source], trackId, startAt); else flash("That recording was too short to use.");
      })();
    };
    recorderRef.current = { recorder, stream, startAt, trackId };
    recorder.start();
    setRecording(true);
    setRecSeconds(0);
    const began = performance.now();
    const timer = window.setInterval(() => {
      if (!recorderRef.current) { window.clearInterval(timer); return; }
      setRecSeconds((performance.now() - began) / 1000);
    }, 200);
    if (projectRef.current.clips.length > 0) {
      await startPlayback(startAt);
      setPlaying(true);
    }
    flash("Recording to " + (projectRef.current.tracks.find((t) => t.id === trackId)?.name ?? "the track") + ". Use headphones if other tracks are playing.");
  };

  /* ---- editing ---- */

  const split = () => {
    const t = playheadRef.current;
    const inside = (c: AClip) => t > c.start + 0.03 && t < c.start + c.duration - 0.03;
    const targets = selected ? (inside(selected) ? [selected] : []) : project.clips.filter(inside);
    if (targets.length === 0) { flash(selected ? "Move the playhead over the selected clip to split it." : "Move the playhead over a clip to split it."); return; }
    const ids = new Set(targets.map((c) => c.id));
    let next: string | null = null;
    const clips = project.clips.flatMap((c) => {
      if (!ids.has(c.id)) return [c];
      const first = t - c.start;
      const second: AClip = { ...c, id: uid("c"), start: t, offset: c.offset + first, duration: c.duration - first, fadeIn: 0 };
      if (targets.length === 1) next = second.id;
      return [{ ...c, duration: first, fadeOut: 0 }, second];
    });
    change((p) => ({ ...p, clips }));
    setSelectedId(next);
    flash("Split at " + fmtTime(t) + ".");
  };

  const copy = () => {
    if (!selected) { flash("Select a clip to copy it."); return false; }
    clipboardRef.current = { clip: selected };
    flash("Copied " + selected.label + ". Move the playhead and press Paste.");
    return true;
  };
  const remove = () => {
    if (!selected) { flash("Select a clip to delete it."); return; }
    change((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selected.id) }));
    setSelectedId(null);
    flash("Deleted " + selected.label + ".");
  };
  const cut = () => {
    if (!selected) { flash("Select a clip to cut it."); return; }
    clipboardRef.current = { clip: selected };
    change((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selected.id) }));
    setSelectedId(null);
    flash("Cut " + selected.label + ". Move the playhead and press Paste.");
  };
  const paste = () => {
    const board = clipboardRef.current;
    if (!board) { flash("Nothing to paste yet. Copy or cut a clip first."); return; }
    const trackId = trackById.has(selectedTrackId) ? selectedTrackId : (trackById.has(board.clip.trackId) ? board.clip.trackId : project.tracks[0].id);
    const start = freeStart(project.clips, trackId, playheadRef.current, board.clip.duration);
    const clip: AClip = { ...board.clip, id: uid("c"), trackId, start };
    change((p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
    flash("Pasted at " + fmtTime(start) + " on " + (trackById.get(trackId)?.name ?? "track") + ".");
  };
  const duplicate = () => {
    if (!selected) { flash("Select a clip to duplicate it."); return; }
    const start = freeStart(project.clips, selected.trackId, selected.start + selected.duration, selected.duration);
    const clip: AClip = { ...selected, id: uid("c"), start };
    change((p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
  };
  const trimToPlayhead = (edge: "start" | "end") => {
    if (!selected) { flash("Select a clip to trim it."); return; }
    const t = playheadRef.current;
    if (t <= selected.start + MIN_CLIP || t >= selected.start + selected.duration - MIN_CLIP) { flash("Move the playhead inside the selected clip first."); return; }
    if (edge === "start") {
      const delta = t - selected.start;
      updateClip(selected.id, { start: t, offset: selected.offset + delta, duration: selected.duration - delta, fadeIn: Math.min(selected.fadeIn, selected.duration - delta) });
    } else {
      const duration = t - selected.start;
      updateClip(selected.id, { duration, fadeOut: Math.min(selected.fadeOut, duration) });
    }
  };

  const addTrack = () => {
    if (project.tracks.length >= MAX_TRACKS) { flash("You can have up to " + MAX_TRACKS + " tracks."); return; }
    const track: ATrack = { id: uid("t"), name: "Track " + (project.tracks.length + 1), color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length], volume: 0.85, pan: 0, mute: false, solo: false, fx: defaultFx() };
    change((p) => ({ ...p, tracks: [...p.tracks, track] }));
    setSelectedTrackId(track.id);
  };
  const removeTrack = (track: ATrack) => {
    change((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== track.id) }));
    if (selectedTrackId === track.id) setSelectedTrackId(project.tracks[0].id);
  };

  const newProject = async () => {
    if ((project.clips.length > 0 || sources.length > 0) && !window.confirm("Start a new project? This removes all tracks and imported audio from this browser.")) return;
    stopSources();
    setPlaying(false);
    pastRef.current = []; futureRef.current = [];
    setSources([]); sourcesRef.current = [];
    setProject({ tracks: defaultTracks(), clips: [] });
    setSelectedId(null); setSelectedTrackId("a-voice");
    setName("Untitled mix"); setMeta(defaultMeta());
    playheadRef.current = 0; setPlayhead(0);
    try { await clearAudio(); } catch { /* storage unavailable */ }
    flash("New project ready.");
  };

  actions.current = {
    togglePlay: () => void togglePlay(), split, duplicate, remove, copy: () => void copy(), cut, paste, undo, redo,
    seek, seekEnd: () => seek(endRef.current), zoom: (f) => setPps((v) => clamp(v * f, 8, 300)),
    nudge: (s) => seek(clamp(playheadRef.current + s, 0, timelineSeconds)),
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']") !== null) return;
      if (document.querySelector(".vs-dialog")) return;
      const a = actions.current;
      if (!a) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) a.redo(); else a.undo(); return; }
      if (mod && key === "y") { event.preventDefault(); a.redo(); return; }
      if (mod && key === "c") { event.preventDefault(); a.copy(); return; }
      if (mod && key === "x") { event.preventDefault(); a.cut(); return; }
      if (mod && key === "v") { event.preventDefault(); a.paste(); return; }
      if (mod && key === "d") { event.preventDefault(); a.duplicate(); return; }
      if (mod || event.altKey) return;
      if (event.key === " " && target?.closest("button, a") === null) { event.preventDefault(); a.togglePlay(); }
      else if (key === "s") a.split();
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); a.remove(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); a.nudge(event.shiftKey ? -1 : -0.1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); a.nudge(event.shiftKey ? 1 : 0.1); }
      else if (event.key === "Home") { event.preventDefault(); a.seek(0); }
      else if (event.key === "End") { event.preventDefault(); a.seekEnd(); }
      else if (event.key === "=" || event.key === "+") a.zoom(1.25);
      else if (event.key === "-") a.zoom(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- timeline pointer handling ---- */

  const snapEdge = (value: number, points: number[]): number | null => {
    if (!snapOn) return null;
    let best: number | null = null;
    let bestDistance = SNAP_PX / ppsRef.current;
    for (const point of points) { const d = Math.abs(point - value); if (d < bestDistance) { bestDistance = d; best = point; } }
    return best;
  };
  const timeAt = (clientX: number, element: HTMLElement | null) => (element ? clamp((clientX - element.getBoundingClientRect().left) / ppsRef.current, 0, timelineSeconds) : 0);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, clip: AClip, mode: Drag["mode"]) => {
    event.stopPropagation();
    setSelectedId(clip.id);
    setSelectedTrackId(clip.trackId);
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, id: clip.id, x0: event.clientX, y0: event.clientY, orig: clip, moved: false };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.moved) { if (Math.abs(dx) + Math.abs(dy) < 4) return; drag.moved = true; snapshot(); }
    const current = projectRef.current;
    const { orig } = drag;
    const dt = dx / ppsRef.current;
    const others = current.clips.filter((c) => c.id !== orig.id);
    const points = [0, playheadRef.current, ...others.flatMap((c) => [c.start, c.start + c.duration])];
    const onTrack = others.filter((c) => c.trackId === orig.trackId);
    const source = sourcesRef.current.find((s) => s.id === orig.sourceId);
    let patch: Partial<AClip> | null = null;

    if (drag.mode === "move") {
      let desired = orig.start + dt;
      const a = snapEdge(desired, points);
      const b = snapEdge(desired + orig.duration, points);
      if (a !== null && (b === null || Math.abs(a - desired) <= Math.abs(b - (desired + orig.duration)))) desired = a;
      else if (b !== null) desired = b - orig.duration;
      let trackId = orig.trackId;
      const lanes = lanesRef.current;
      if (lanes) {
        const row = Math.floor((event.clientY - lanes.getBoundingClientRect().top) / TRACK_H);
        trackId = current.tracks[clamp(row, 0, current.tracks.length - 1)].id;
      }
      let start = placeClip(current.clips, orig, trackId, desired);
      if (start === null && trackId !== orig.trackId) { trackId = orig.trackId; start = placeClip(current.clips, orig, trackId, desired); }
      if (start !== null) patch = { start, trackId };
    } else if (drag.mode === "left") {
      const low = onTrack.reduce((v, c) => (c.start + c.duration <= orig.start + 1e-6 ? Math.max(v, c.start + c.duration) : v), 0);
      let next = orig.start + dt;
      next = snapEdge(next, points) ?? next;
      next = clamp(next, Math.max(low, orig.start - orig.offset), orig.start + orig.duration - MIN_CLIP);
      const delta = next - orig.start;
      const duration = orig.duration - delta;
      patch = { start: next, offset: orig.offset + delta, duration, fadeIn: Math.min(orig.fadeIn, duration), fadeOut: Math.min(orig.fadeOut, duration) };
    } else if (drag.mode === "right") {
      const high = onTrack.reduce((v, c) => (c.start >= orig.start + orig.duration - 1e-6 ? Math.min(v, c.start) : v), Infinity);
      const maxEnd = Math.max(orig.start + MIN_CLIP, Math.min(high, source ? orig.start + (source.duration - orig.offset) : Infinity));
      let end = orig.start + orig.duration + dt;
      end = snapEdge(end, points) ?? end;
      end = clamp(end, orig.start + MIN_CLIP, maxEnd);
      const duration = end - orig.start;
      patch = { duration, fadeIn: Math.min(orig.fadeIn, duration), fadeOut: Math.min(orig.fadeOut, duration) };
    } else if (drag.mode === "fadeIn") {
      patch = { fadeIn: clamp(orig.fadeIn + dt, 0, orig.duration - orig.fadeOut) };
    } else {
      patch = { fadeOut: clamp(orig.fadeOut - dt, 0, orig.duration - orig.fadeIn) };
    }

    if (patch) {
      const applied = patch;
      const next: AProject = { ...current, clips: current.clips.map((c) => (c.id === orig.id ? { ...c, ...applied } : c)) };
      projectRef.current = next;
      setProject(next);
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    const last = pastRef.current[pastRef.current.length - 1];
    if (last && JSON.stringify(last.clips) === JSON.stringify(projectRef.current.clips)) { pastRef.current.pop(); setHistoryVersion((v) => v + 1); }
  };

  /* ---- file drag and drop ---- */

  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const laneTarget = (e: ReactDragEvent) => {
    const lanes = lanesRef.current;
    if (!lanes) return null;
    const rect = lanes.getBoundingClientRect();
    const tracks = projectRef.current.tracks;
    const track = tracks[clamp(Math.floor((e.clientY - rect.top) / TRACK_H), 0, tracks.length - 1)];
    return { trackId: track.id, start: Math.max(0, (e.clientX - rect.left) / ppsRef.current) };
  };
  const onLaneDragOver = (e: ReactDragEvent<HTMLDivElement>) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDropHint(laneTarget(e)); };
  const onLaneDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault(); e.stopPropagation();
    const target = laneTarget(e);
    setDropHint(null); setFileDrag(false); dragDepth.current = 0;
    void importFiles(files, target ?? undefined);
  };
  const rootEnter = (e: ReactDragEvent) => { if (hasFiles(e)) { dragDepth.current += 1; setFileDrag(true); } };
  const rootLeave = (e: ReactDragEvent) => { if (hasFiles(e)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setFileDrag(false); } };
  const rootOver = (e: ReactDragEvent) => { if (hasFiles(e)) e.preventDefault(); };
  const rootDrop = (e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth.current = 0; setFileDrag(false);
    void importFiles(Array.from(e.dataTransfer.files));
  };

  /* ---- geometry ---- */

  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 72) ?? 300;
  const ticks = Array.from({ length: Math.floor(timelineSeconds / step) + 1 }, (_, i) => i * step);
  const lanesWidth = timelineSeconds * pps;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved in this browser";
  const fx = selectedTrack.fx;
  const dB = (v: number) => (v > 0 ? "+" : "") + v.toFixed(0) + " dB";
  const pct = (v: number) => Math.round(v * 100) + "%";
  const fitTimeline = () => {
    const scroller = scrollRef.current;
    if (!scroller || contentEnd <= 0) return;
    setPps(clamp((scroller.clientWidth - LABEL_W - 48) / contentEnd, 8, 300));
    scroller.scrollLeft = 0;
  };

  return (
    <section className="vs as" aria-label="Audio studio" onClick={(e) => { const b = (e.target as HTMLElement).closest("button"); if (e.detail > 0 && b) b.blur(); }}
      onDragEnter={rootEnter} onDragLeave={rootLeave} onDragOver={rootOver} onDrop={rootDrop}>
      <input ref={fileRef} type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus" multiple hidden
        onChange={(e) => { const files = Array.from<File>(e.currentTarget.files ?? []); e.currentTarget.value = ""; void importFiles(files); }} />

      <header className="vs-head">
        <div className="vs-head-title">
          <span className="vs-head-icon"><AudioLines size={18} /></span>
          <div className="vs-head-text">
            <input className="vs-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
            <div className="vs-status" role="status" aria-live="polite">{importing > 0 ? "Reading " + importing + (importing === 1 ? " file…" : " files…") : status}</div>
          </div>
        </div>
        <div className="as-meter" aria-label="Output level" title="Master output level"><span><i ref={meterL} /></span><span><i ref={meterR} /></span></div>
        <span className={"vs-save " + saveState}>{saveState === "saved" && <Check size={13} />}{saveLabel}</span>
        <button className="vs-secondary" onClick={newProject}><FilePlus size={15} /> New</button>
        <button className="vs-export" onClick={() => { stopSources(); setPlaying(false); setExportOpen(true); }} disabled={empty} title={empty ? "Add a clip to export" : "Mix down and export"}><Download size={16} /> Export</button>
      </header>

      <div className="as-main">
        <div className="vs-panel as-workspace">
          <div className="vs-transport">
            <div className="vs-timecode" aria-label="Current time"><b>{fmtTime(playhead)}</b><span>/ {fmtTime(contentEnd)}</span></div>
            <div className="vs-controls">
              <button className="vs-icon-btn" aria-label="Go to start" title="Go to start (Home)" onClick={() => seek(0)}><SkipBack size={17} /></button>
              <button className="vs-play" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => void togglePlay()}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
              <button className={"as-rec" + (recording ? " on" : "")} aria-label={recording ? "Stop recording" : "Record voiceover"} title={recording ? "Stop recording" : "Record from your microphone onto the selected track"} onClick={() => void startRecording()}>
                {recording ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}<span>{recording ? "Stop " + fmtTime(recSeconds).slice(0, 5) : "Record"}</span>
              </button>
            </div>
            <div className="vs-zoom">
              <ZoomOut size={15} />
              <input type="range" min={8} max={300} step={2} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" />
              <ZoomIn size={15} />
              <button className="vs-icon-btn" onClick={fitTimeline} aria-label="Fit to window" title="Fit to window" disabled={empty}><AudioLines size={15} /></button>
            </div>
          </div>

          <div className="vs-tl-scroll as-scroll" ref={scrollRef}>
            <div className="vs-tl-inner" style={{ width: LABEL_W + lanesWidth }}>
              <div className="vs-ruler-row" style={{ height: RULER_H }}>
                <div className="vs-ruler-spacer" style={{ width: LABEL_W }} />
                <div className="vs-ruler" ref={rulerRef} style={{ width: lanesWidth, backgroundSize: (step * pps) / 5 + "px 8px" }}
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubbing.current = true; seek(timeAt(e.clientX, rulerRef.current)); }}
                  onPointerMove={(e) => { if (scrubbing.current) seek(timeAt(e.clientX, rulerRef.current)); }}
                  onPointerUp={() => { scrubbing.current = false; }} onPointerCancel={() => { scrubbing.current = false; }}>
                  {ticks.map((t) => <span className="vs-tick" key={t} style={{ left: t * pps }}>{shortTime(t)}</span>)}
                </div>
              </div>

              <div className="vs-body">
                <div className="vs-labels as-labels" style={{ width: LABEL_W }}>
                  {project.tracks.map((track) => {
                    const removable = project.tracks.length > 1 && !project.clips.some((c) => c.trackId === track.id) && !["a-voice", "a-music", "a-sfx"].includes(track.id);
                    const audible = isAudible(track, project.tracks);
                    return (
                      <div className={"as-track" + (track.id === selectedTrackId ? " selected" : "") + (audible ? "" : " silent")} style={{ height: TRACK_H, "--c": track.color } as CSSProperties} key={track.id} onPointerDown={() => setSelectedTrackId(track.id)}>
                        <div className="as-track-top">
                          <i className="as-dot" />
                          <input className="as-track-name" value={track.name} onChange={(e) => updateTrack(track.id, { name: e.target.value }, true)} onBlur={endEdit} aria-label="Track name" />
                          <button className={"as-ms" + (track.mute ? " on mute" : "")} aria-pressed={track.mute} aria-label={(track.mute ? "Unmute " : "Mute ") + track.name} title="Mute" onClick={() => updateTrack(track.id, { mute: !track.mute })}>{track.mute ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
                          <button className={"as-ms" + (track.solo ? " on solo" : "")} aria-pressed={track.solo} aria-label={(track.solo ? "Unsolo " : "Solo ") + track.name} title="Solo: hear only this track" onClick={() => updateTrack(track.id, { solo: !track.solo })}><Headphones size={13} /></button>
                          {removable && <button className="as-ms" aria-label={"Remove " + track.name} title="Remove empty track" onClick={() => removeTrack(track)}><X size={12} /></button>}
                        </div>
                        <label className="as-mix"><span>Vol</span>
                          <input type="range" min={0} max={1} step={0.01} value={track.volume} aria-label={track.name + " volume"} onChange={(e) => updateTrack(track.id, { volume: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} onKeyUp={endEdit} />
                          <output>{Math.round(track.volume * 100)}</output></label>
                        <label className="as-mix"><span>Pan</span>
                          <input type="range" min={-1} max={1} step={0.02} value={track.pan} aria-label={track.name + " pan"} title="Double-click to center" onDoubleClick={() => updateTrack(track.id, { pan: 0 })} onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) }, true)} onPointerUp={endEdit} onBlur={endEdit} onKeyUp={endEdit} />
                          <output>{panLabel(track.pan)}</output></label>
                      </div>
                    );
                  })}
                </div>

                <div className="vs-lanes" ref={lanesRef} style={{ width: lanesWidth, height: project.tracks.length * TRACK_H }}
                  onPointerDown={(e) => { setSelectedId(null); const row = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / TRACK_H); const t = project.tracks[clamp(row, 0, project.tracks.length - 1)]; if (t) setSelectedTrackId(t.id); seek(timeAt(e.clientX, lanesRef.current)); }}
                  onDragOver={onLaneDragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(null); }} onDrop={onLaneDrop}>
                  {project.tracks.map((track, row) => (
                    <div className={"vs-lane as-lane" + (track.id === selectedTrackId ? " selected" : "") + (isAudible(track, project.tracks) ? "" : " off")} style={{ top: row * TRACK_H, height: TRACK_H }} key={track.id} />
                  ))}
                  {project.clips.map((clip) => {
                    const track = trackById.get(clip.trackId);
                    const source = sourceMap.get(clip.sourceId);
                    if (!track || !source) return null;
                    const isSelected = clip.id === selectedId;
                    const width = Math.max(clip.duration * pps, 6);
                    return (
                      <div key={clip.id} className={"vs-clip as-clip" + (isSelected ? " selected" : "")}
                        style={{ left: clip.start * pps, width, top: (trackIndex.get(clip.trackId) ?? 0) * TRACK_H + 6, height: TRACK_H - 12, "--c": track.color } as CSSProperties}
                        onPointerDown={(e) => beginDrag(e, clip, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                        role="button" tabIndex={0} aria-pressed={isSelected} aria-label={clip.label + " on " + track.name + ", " + clip.duration.toFixed(1) + " seconds"}
                        onKeyDown={(e) => { if (e.key === "Enter") { setSelectedId(clip.id); setSelectedTrackId(clip.trackId); } }}>
                        <ClipWave source={source} clip={clip} />
                        {clip.fadeIn > 0 && <svg className="as-fade" style={{ left: 0, width: clip.fadeIn * pps }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 100,0 0,100" /></svg>}
                        {clip.fadeOut > 0 && <svg className="as-fade" style={{ right: 0, width: clip.fadeOut * pps }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 100,0 100,100" /></svg>}
                        <span className="vs-clip-label"><AudioLines size={11} />{clip.label}{clip.gain !== 1 && <em>{Math.round(clip.gain * 100)}%</em>}</span>
                        <span className="vs-handle left" onPointerDown={(e) => beginDrag(e, clip, "left")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Trim start" />
                        <span className="vs-handle right" onPointerDown={(e) => beginDrag(e, clip, "right")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Trim end" />
                        <span className="as-fade-handle" style={{ left: Math.min(Math.max(width - 9, 9), Math.max(9, clip.fadeIn * pps)) }} onPointerDown={(e) => beginDrag(e, clip, "fadeIn")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Drag to set fade in" aria-label="Fade in handle" />
                        <span className="as-fade-handle" style={{ left: Math.min(Math.max(width - 9, 9), Math.max(9, width - clip.fadeOut * pps)) }} onPointerDown={(e) => beginDrag(e, clip, "fadeOut")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Drag to set fade out" aria-label="Fade out handle" />
                      </div>
                    );
                  })}
                  {dropHint && <div className="vs-drop-hint" style={{ left: dropHint.start * pps, width: 140, top: (trackIndex.get(dropHint.trackId) ?? 0) * TRACK_H + 6, height: TRACK_H - 12 }} />}
                  {empty && !dropHint && (
                    <div className="as-welcome">
                      <b>Start your mix</b>
                      <span>Import audio to the selected track, or record a voiceover. You can also drag audio files onto a track.</span>
                      <div className="as-welcome-actions">
                        <button className="vs-cta" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import audio</button>
                        <button className="vs-secondary" onClick={() => void startRecording()}><Mic size={15} /> Record voiceover</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="vs-add-row" style={{ height: ADD_ROW_H }}>
                <div className="vs-add-label" style={{ width: LABEL_W }}><button onClick={addTrack} title="Add another audio track"><Plus size={12} /> Add track</button></div>
              </div>
              <div className="vs-playhead" style={{ left: LABEL_W + playhead * pps }} aria-hidden="true" />
            </div>
          </div>

          <div className="vs-toolbar as-toolbar">
            <div className="vs-tool-group">
              <ToolButton icon={Undo2} label="Undo" hint="Ctrl+Z" onClick={undo} disabled={!canUndo} />
              <ToolButton icon={Redo2} label="Redo" hint="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} />
            </div>
            <div className="vs-tool-group center">
              <ToolButton icon={Scissors} label="Cut" hint="Ctrl+X" onClick={cut} disabled={!selected} />
              <ToolButton icon={Copy} label="Copy" hint="Ctrl+C" onClick={() => void copy()} disabled={!selected} />
              <ToolButton icon={ClipboardPaste} label="Paste" hint="Ctrl+V" onClick={paste} />
              <ToolButton icon={Slice} label="Split" hint="S" onClick={split} disabled={empty} />
              <ToolButton icon={ArrowLeftToLine} label="Trim start" hint="to playhead" onClick={() => trimToPlayhead("start")} disabled={!selected} />
              <ToolButton icon={ArrowRightToLine} label="Trim end" hint="to playhead" onClick={() => trimToPlayhead("end")} disabled={!selected} />
              <ToolButton icon={Trash2} label="Delete" hint="Delete" onClick={remove} disabled={!selected} />
              <ToolButton icon={Magnet} label="Snap" onClick={() => setSnapOn((v) => !v)} active={snapOn} />
            </div>
            <div className="vs-tool-group right">
              <ToolButton icon={Upload} label="Import" onClick={() => fileRef.current?.click()} />
            </div>
          </div>
        </div>

        <aside className="vs-panel as-side" aria-label="Sound settings">
          <div className="vs-panel-head">
            <div className="vs-tabs" role="tablist">
              <button role="tab" aria-selected={sideTab === "fx"} className={sideTab === "fx" ? "active" : ""} onClick={() => setSideTab("fx")}>Effects</button>
              <button role="tab" aria-selected={sideTab === "clip"} className={sideTab === "clip" ? "active" : ""} onClick={() => setSideTab("clip")}>Clip</button>
            </div>
          </div>

          {sideTab === "fx" ? (
            <div className="vs-fields as-fx">
              <div className="as-fx-target" style={{ "--c": selectedTrack.color } as CSSProperties}><i className="as-dot" /> Effects for <b>{selectedTrack.name}</b>{soloActive && !selectedTrack.solo && <small>not soloed</small>}</div>

              <section className="as-group">
                <header><h4>Equalizer</h4><button onClick={() => updateFx(selectedTrack.id, (f) => ({ ...f, eq: { bass: 0, mid: 0, treble: 0 } }))}>Flat</button></header>
                <Slider label="Bass" value={fx.eq.bass} min={-12} max={12} step={1} format={dB} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, eq: { ...f.eq, bass: v } }))} onCommit={endEdit} />
                <Slider label="Mid" value={fx.eq.mid} min={-12} max={12} step={1} format={dB} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, eq: { ...f.eq, mid: v } }))} onCommit={endEdit} />
                <Slider label="Treble" value={fx.eq.treble} min={-12} max={12} step={1} format={dB} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, eq: { ...f.eq, treble: v } }))} onCommit={endEdit} />
              </section>

              <section className="as-group">
                <header><h4>Noise reduction</h4><button onClick={() => updateFx(selectedTrack.id, (f) => ({ ...f, nr: { amount: 0, hum: 0 } }))}>Off</button></header>
                <Slider label="Hiss and background noise" value={fx.nr.amount} min={0} max={1} step={0.01} format={pct} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, nr: { ...f.nr, amount: v } }))} onCommit={endEdit} />
                <div className="vs-field">Mains hum filter
                  <div className="vs-segment">
                    {([0, 50, 60] as const).map((h) => <button key={h} className={fx.nr.hum === h ? "active" : ""} onClick={() => { endEdit(); updateFx(selectedTrack.id, (f) => ({ ...f, nr: { ...f.nr, hum: h } })); endEdit(); }}>{h === 0 ? "Off" : h + " Hz"}</button>)}
                  </div>
                </div>
              </section>

              <section className="as-group">
                <header><h4>Compressor</h4><button onClick={() => updateFx(selectedTrack.id, (f) => ({ ...f, comp: { amount: 0 } }))}>Off</button></header>
                <Slider label="Amount (evens out loud peaks)" value={fx.comp.amount} min={0} max={1} step={0.01} format={pct} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, comp: { amount: v } }))} onCommit={endEdit} />
              </section>

              <section className="as-group">
                <header><h4>Reverb</h4><button onClick={() => updateFx(selectedTrack.id, (f) => ({ ...f, reverb: { ...f.reverb, mix: 0 } }))}>Off</button></header>
                <div className="vs-field">Room
                  <div className="vs-segment">
                    {([["Small", 0.5], ["Hall", 1.8], ["Large", 3.4]] as const).map(([label, size]) => <button key={label} className={Math.abs(fx.reverb.size - size) < 0.05 ? "active" : ""} onClick={() => { endEdit(); updateFx(selectedTrack.id, (f) => ({ ...f, reverb: { mix: f.reverb.mix || 0.25, size } })); endEdit(); }}>{label}</button>)}
                  </div>
                </div>
                <Slider label="Room size" value={fx.reverb.size} min={0.2} max={4} step={0.1} format={(v) => v.toFixed(1) + " s"} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, reverb: { ...f.reverb, size: v } }))} onCommit={endEdit} />
                <Slider label="Mix" value={fx.reverb.mix} min={0} max={1} step={0.01} format={pct} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, reverb: { ...f.reverb, mix: v } }))} onCommit={endEdit} />
              </section>

              <section className="as-group">
                <header><h4>Delay</h4><button onClick={() => updateFx(selectedTrack.id, (f) => ({ ...f, delay: { ...f.delay, mix: 0 } }))}>Off</button></header>
                <Slider label="Time" value={fx.delay.time} min={0.05} max={1} step={0.01} format={(v) => Math.round(v * 1000) + " ms"} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, delay: { ...f.delay, time: v } }))} onCommit={endEdit} />
                <Slider label="Feedback" value={fx.delay.feedback} min={0} max={0.85} step={0.01} format={pct} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, delay: { ...f.delay, feedback: v } }))} onCommit={endEdit} />
                <Slider label="Mix" value={fx.delay.mix} min={0} max={1} step={0.01} format={pct} onChange={(v) => updateFx(selectedTrack.id, (f) => ({ ...f, delay: { ...f.delay, mix: v } }))} onCommit={endEdit} />
              </section>
            </div>
          ) : selected ? (
            <div className="vs-fields">
              <label className="vs-field">Name<input className="vs-input" value={selected.label} onChange={(e) => updateClip(selected.id, { label: e.target.value }, true)} onBlur={endEdit} /></label>
              <dl className="vs-readout">
                <div><dt>Start</dt><dd>{fmtTime(selected.start)}</dd></div>
                <div><dt>Length</dt><dd>{selected.duration.toFixed(2)} s</dd></div>
              </dl>
              <Slider label="Clip volume" value={selected.gain} min={0} max={2} step={0.01} format={pct} onChange={(v) => updateClip(selected.id, { gain: v }, true)} onCommit={endEdit} />
              <Slider label="Fade in" value={selected.fadeIn} min={0} max={Math.max(0.1, selected.duration - selected.fadeOut)} step={0.05} format={(v) => v.toFixed(2) + " s"} onChange={(v) => updateClip(selected.id, { fadeIn: v }, true)} onCommit={endEdit} />
              <Slider label="Fade out" value={selected.fadeOut} min={0} max={Math.max(0.1, selected.duration - selected.fadeIn)} step={0.05} format={(v) => v.toFixed(2) + " s"} onChange={(v) => updateClip(selected.id, { fadeOut: v }, true)} onCommit={endEdit} />
              <p className="vs-hint">Tip: drag the round handles at the top corners of a clip to set fades right on the timeline. Drag the clip edges to trim.</p>
            </div>
          ) : (
            <div className="vs-fields">
              <p className="vs-hint">Select a clip on the timeline to set its volume and fades, or choose a track on the left to shape its sound in the Effects tab.</p>
              <ul className="vs-keys">
                <li><kbd>Space</kbd> play or pause</li>
                <li><kbd>S</kbd> split at the playhead</li>
                <li><kbd>Ctrl</kbd> + <kbd>C</kbd> <kbd>X</kbd> <kbd>V</kbd> copy, cut, paste</li>
                <li><kbd>Delete</kbd> remove, <kbd>Ctrl</kbd> + <kbd>D</kbd> duplicate</li>
                <li><kbd>←</kbd> <kbd>→</kbd> move playhead (<kbd>Shift</kbd> for 1 s)</li>
                <li><kbd>+</kbd> <kbd>-</kbd> zoom, <kbd>Ctrl</kbd> + scroll also zooms</li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      {fileDrag && (
        <div className="vs-drop-overlay" aria-hidden="true"><Upload size={34} /><b>Drop audio to add it</b><span>Files are placed on the track under your pointer.</span></div>
      )}
      {exportOpen && <AudioExportDialog project={project} sources={sourceMap} meta={meta} setMeta={setMeta} name={name} onClose={() => setExportOpen(false)} />}
    </section>
  );
}
