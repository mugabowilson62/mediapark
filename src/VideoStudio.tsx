import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines, Clapperboard, Copy, Download, Eye, EyeOff, Film, Image as ImageIcon,
  Lock, Magnet, Music2, Pause, Play, Plus, Redo2, RotateCcw, Scissors, SkipBack,
  SkipForward, StepBack, StepForward, Trash2, Type, Undo2, Unlock, Upload,
  Volume2, VolumeX, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import "./videostudio.css";

/* ------------------------------------------------------------------ */
/* Types and constants                                                 */
/* ------------------------------------------------------------------ */

type MediaKind = "video" | "audio" | "image" | "color";
type TrackKind = "title" | "video" | "audio";
type TitleStyle = "center" | "lower" | "subtitle";
type Aspect = "16:9" | "9:16" | "1:1";

type Media = {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  url?: string;
  thumb?: string;
  gradient?: string;
};

type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
};

type Clip = {
  id: string;
  trackId: string;
  mediaId?: string;
  label: string;
  start: number;
  inPoint: number;
  duration: number;
  volume: number;
  opacity: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  scale?: number;
  rotation?: number;
  text?: string;
  titleStyle?: TitleStyle;
};

type Project = { tracks: Track[]; clips: Clip[] };

type Drag = {
  mode: "move" | "left" | "right";
  id: string;
  x0: number;
  y0: number;
  orig: Clip;
  moved: boolean;
};

type Actions = {
  togglePlay: () => void;
  split: () => void;
  duplicate: () => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  step: (seconds: number) => void;
  seek: (time: number) => void;
  seekEnd: () => void;
};

const FPS = 30;
const LABEL_W = 118;
const TRACK_H = 46;
const RULER_H = 30;
const MIN_CLIP = 0.25;
const SNAP_PX = 8;
const ASPECTS: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

const titlePresets: Array<{ name: string; text: string; style: TitleStyle; note: string }> = [
  { name: "Center title", text: "Your title here", style: "center", note: "Large, centered text" },
  { name: "Lower third", text: "Name, role", style: "lower", note: "Names and places" },
  { name: "Subtitle", text: "A line of dialogue", style: "subtitle", note: "Captions on a dark strip" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
const uid = (prefix: string) => prefix + "-" + ++idCounter + Math.random().toString(36).slice(2, 6);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const pad = (value: number, length = 2) => String(Math.floor(value)).padStart(length, "0");

function timecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const frames = Math.floor((safe - whole) * FPS + 1e-6);
  return pad(whole / 3600) + ":" + pad((whole % 3600) / 60) + ":" + pad(whole % 60) + ":" + pad(frames);
}

function shortTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return Math.floor(whole / 60) + ":" + pad(whole % 60);
}

function seconds1(value: number): string {
  return value.toFixed(1) + "s";
}

function waveformPoints(seed: string, count = 96): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * 100;
    const swell = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.19 + 1.3));
    const amp = (0.12 + 0.88 * rnd()) * swell * 46;
    top.push(x.toFixed(2) + "," + (50 - amp).toFixed(2));
    bottom.unshift(x.toFixed(2) + "," + (50 + amp).toFixed(2));
  }
  return top.concat(bottom).join(" ");
}

/** A soft, generated pad so the audio track works without any uploaded file. */
function makeAmbientWav(seconds: number): string {
  const rate = 22050;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples * 2, true);
  const notes = [110, 164.81, 220, 277.18, 329.63];
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const envelope = Math.max(0, Math.min(1, t / 1.5, (seconds - t) / 1.5));
    const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.3 * t);
    let sum = 0;
    notes.forEach((frequency, index) => {
      sum += Math.sin(2 * Math.PI * frequency * t + Math.sin(2 * Math.PI * 0.2 * t + index) * 0.4) / notes.length;
    });
    view.setInt16(44 + i * 2, Math.round(sum * envelope * swell * 0.35 * 32767), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function captureThumb(video: HTMLVideoElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    const finish = (value?: string) => {
      video.onseeked = null;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(undefined), 2500);
    video.onseeked = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext("2d");
        if (!context) return finish(undefined);
        context.drawImage(video, 0, 0, 160, 90);
        finish(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        finish(undefined);
      }
    };
    video.currentTime = Math.min(0.5, video.duration / 2);
  });
}

function readMedia(file: File): Promise<Media | null> {
  const url = URL.createObjectURL(file);
  const name = file.name.replace(/\.[^.]+$/, "");
  if (file.type.startsWith("image/")) {
    const image: Media = { id: uid("m"), name, kind: "image", duration: 4, url, thumb: url };
    return Promise.resolve(image);
  }
  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");
  if (!isVideo && !isAudio) {
    URL.revokeObjectURL(url);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const element = document.createElement(isVideo ? "video" : "audio");
    element.preload = "metadata";
    element.muted = true;
    const fail = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    element.onerror = fail;
    element.onloadedmetadata = async () => {
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      if (duration <= 0) return fail();
      const thumb = element instanceof HTMLVideoElement ? await captureThumb(element) : undefined;
      const item: Media = { id: uid("m"), name, kind: isVideo ? "video" : "audio", duration, url, thumb };
      resolve(item);
    };
    element.src = url;
  });
}

function defaultTracks(): Track[] {
  const base = { muted: false, hidden: false, locked: false };
  return [
    { id: "t-title", name: "Titles", kind: "title", ...base },
    { id: "t-v2", name: "Overlay", kind: "video", ...base },
    { id: "t-v1", name: "Video", kind: "video", ...base },
    { id: "t-a1", name: "Audio", kind: "audio", ...base },
    { id: "t-a2", name: "Music", kind: "audio", ...base },
  ];
}

const M_GOLD = "m-golden-hour";
const M_SAVANNA = "m-savanna";
const M_CANOPY = "m-canopy";
const M_LAKE = "m-lake";
const M_PAD = "m-pad";

function initialMedia(): Media[] {
  return [
    { id: M_GOLD, name: "Golden hour", kind: "color", duration: 6, gradient: "linear-gradient(135deg,#f6c453,#e2703a 55%,#5b2a4a)" },
    { id: M_SAVANNA, name: "Savanna walk", kind: "color", duration: 5, gradient: "linear-gradient(160deg,#d3e08f,#5f9f5a 50%,#173d27)" },
    { id: M_CANOPY, name: "Forest canopy", kind: "color", duration: 5, gradient: "linear-gradient(135deg,#7bd69a,#1e6b46 55%,#071a10)" },
    { id: M_LAKE, name: "Lake mist", kind: "color", duration: 4, gradient: "linear-gradient(180deg,#b3dde9,#5b8fa8 50%,#1c3446)" },
    { id: M_PAD, name: "Ambient pad", kind: "audio", duration: 12, url: makeAmbientWav(12) },
  ];
}

function initialProject(): Project {
  const clip = (partial: Partial<Clip> & Pick<Clip, "trackId" | "label" | "start" | "duration">): Clip => ({
    id: uid("c"),
    inPoint: 0,
    volume: 1,
    opacity: 1,
    ...partial,
  });
  return {
    tracks: defaultTracks(),
    clips: [
      clip({ trackId: "t-v1", mediaId: M_GOLD, label: "Golden hour", start: 0, duration: 6 }),
      clip({ trackId: "t-v1", mediaId: M_SAVANNA, label: "Savanna walk", start: 6, duration: 5 }),
      clip({ trackId: "t-v1", mediaId: M_CANOPY, label: "Forest canopy", start: 11, duration: 5 }),
      clip({ trackId: "t-title", label: "Title", start: 0.6, duration: 4, text: "Kigali, at dawn", titleStyle: "lower" }),
      clip({ trackId: "t-title", label: "Title", start: 11.5, duration: 3.5, text: "Into the forest", titleStyle: "center" }),
      clip({ trackId: "t-a1", mediaId: M_PAD, label: "Ambient pad", start: 0, duration: 12, volume: 0.8 }),
    ],
  };
}

/** First free start time on a track at or after `desired` where a clip of `length` fits. */
function freeStart(clips: Clip[], trackId: string, desired: number, length: number): number {
  const onTrack = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let start = desired;
  for (const c of onTrack) {
    if (start < c.start + c.duration - 1e-6 && start + length > c.start + 1e-6) start = c.start + c.duration;
  }
  return start;
}

/** Clamp a clip between its neighbours on a track. Returns null when it cannot fit there. */
function placeClip(clips: Clip[], self: Clip, trackId: string, desired: number): number | null {
  const centre = desired + self.duration / 2;
  let low = 0;
  let high = Infinity;
  for (const c of clips) {
    if (c.trackId !== trackId || c.id === self.id) continue;
    if (c.start + c.duration / 2 < centre) low = Math.max(low, c.start + c.duration);
    else high = Math.min(high, c.start);
  }
  if (high - low < self.duration - 1e-6) return null;
  return clamp(desired, low, high - self.duration);
}

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function ToolButton({ icon: Icon, label, onClick, disabled, active }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button className={"vs-tool" + (active ? " active" : "")} onClick={onClick} disabled={disabled} aria-pressed={active}>
      <Icon size={19} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

function Waveform({ seed }: { seed: string }) {
  const points = useMemo(() => waveformPoints(seed), [seed]);
  return (
    <svg className="vs-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={points} />
    </svg>
  );
}

function thumbStyle(media: Media | undefined): CSSProperties {
  if (!media) return {};
  if (media.kind === "color") return { background: media.gradient };
  if ((media.kind === "video" || media.kind === "image") && media.thumb) {
    return { backgroundImage: "url(" + media.thumb + ")", backgroundSize: "cover", backgroundPosition: "center" };
  }
  return {};
}

function MediaLayer({ clip, media, time, playing, muted }: {
  clip: Clip;
  media: Media;
  time: number;
  playing: boolean;
  muted: boolean;
}) {
  const element = useRef<HTMLMediaElement | null>(null);
  const setElement = useCallback((node: HTMLMediaElement | null) => {
    element.current = node;
  }, []);
  const local = clip.inPoint + (time - clip.start);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    el.volume = clamp(clip.volume, 0, 1);
    el.muted = muted;
    if (!playing) {
      el.pause();
      if (Math.abs(el.currentTime - local) > 0.04) el.currentTime = local;
    } else {
      if (Math.abs(el.currentTime - local) > 0.35) el.currentTime = local;
      if (el.paused) void el.play().catch(() => undefined);
    }
  }, [local, playing, muted, clip.volume]);

  const style: CSSProperties = { opacity: clip.opacity, filter: "brightness(" + (clip.brightness ?? 100) + "%) contrast(" + (clip.contrast ?? 100) + "%) saturate(" + (clip.saturation ?? 100) + "%)", transform: "scale(" + ((clip.scale ?? 100) / 100) + ") rotate(" + (clip.rotation ?? 0) + "deg)" };
  if (media.kind === "video") {
    return <video ref={setElement} className="vs-layer" style={style} src={media.url} playsInline preload="auto" />;
  }
  if (media.kind === "audio") {
    return <audio ref={setElement} src={media.url} preload="auto" />;
  }
  if (media.kind === "image") {
    return <img className="vs-layer" style={style} src={media.url} alt="" />;
  }
  return <div className="vs-layer" style={{ ...style, background: media.gradient }} />;
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */


type ExportOptions = { width: number; height: number; fps: number; quality: "standard" | "high" };
type ExportProgress = (value: number, message: string) => void;

/** Render the timeline to a canvas stream and mix audio clips with Web Audio. */
async function renderTimeline(project: Project, media: Media[], options: ExportOptions, onProgress: ExportProgress): Promise<Blob> {
  if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) throw new Error("This browser does not support canvas video recording. Use the latest Chrome or Edge.");
  const canvas = document.createElement("canvas");
  canvas.width = options.width; canvas.height = options.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the video render canvas.");
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const duration = Math.max(0.1, ...project.clips.map((clip) => clip.start + clip.duration));
  const visuals = project.clips.filter((clip) => {
    const track = project.tracks.find((item) => item.id === clip.trackId);
    const item = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
    return track && !track.hidden && track.kind === "video" && item && item.kind !== "audio";
  });
  const titles = project.clips.filter((clip) => project.tracks.some((track) => track.id === clip.trackId && track.kind === "title" && !track.hidden));
  const imageCache = new Map<string, HTMLImageElement>();
  const videoCache = new Map<string, HTMLVideoElement>();
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();
  const scheduled: AudioBufferSourceNode[] = [];
  try {
    for (const clip of visuals) {
      const item = mediaById.get(clip.mediaId!)!;
      if (item.kind === "image" && item.url) {
        const image = new Image(); image.src = item.url; await image.decode(); imageCache.set(item.id, image);
      } else if (item.kind === "video" && item.url) {
        const video = document.createElement("video"); video.src = item.url; video.muted = true; video.playsInline = true; video.preload = "auto";
        await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("Could not decode " + item.name)); video.load(); });
        videoCache.set(item.id, video);
      }
    }
    const audioClips = project.clips.filter((clip) => {
      const track = project.tracks.find((item) => item.id === clip.trackId);
      const asset = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
      return track && !track.hidden && !track.muted && track.kind === "audio" && asset?.url;
    });
    const buffers = await Promise.all(audioClips.map(async (clip) => {
      const asset = mediaById.get(clip.mediaId!)!;
      const response = await fetch(asset.url!);
      return { clip, buffer: await audioContext.decodeAudioData(await response.arrayBuffer()) };
    }));
    const canvasStream = canvas.captureStream(options.fps);
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.quality === "high" ? 8000000 : 4000000, audioBitsPerSecond: 192000 });
    const chunks: BlobPart[] = [];
    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("The browser stopped recording unexpectedly."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    const audioStart = audioContext.currentTime + 0.15;
    buffers.forEach(({ clip, buffer }) => {
      const source = audioContext.createBufferSource(); const gain = audioContext.createGain();
      source.buffer = buffer; gain.gain.value = Math.max(0, Math.min(1, clip.volume)); source.connect(gain).connect(audioDestination);
      const offset = Math.max(0, clip.inPoint); const length = Math.min(clip.duration, buffer.duration - offset);
      if (length > 0) source.start(audioStart + clip.start, offset, length);
      scheduled.push(source);
    });
    const draw = (time: number) => {
      ctx.fillStyle = "#07150d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      visuals.filter((clip) => time >= clip.start && time < clip.start + clip.duration).forEach((clip) => {
        const asset = mediaById.get(clip.mediaId!)!;
        const track = project.tracks.find((entry) => entry.id === clip.trackId)!;
        const local = clip.inPoint + time - clip.start;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, clip.opacity));
        ctx.filter = "brightness(" + (clip.brightness ?? 100) + "%) contrast(" + (clip.contrast ?? 100) + "%) saturate(" + (clip.saturation ?? 100) + "%)";
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(((clip.rotation ?? 0) * Math.PI) / 180);
        const clipScale = (clip.scale ?? 100) / 100;
        ctx.scale(clipScale, clipScale);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        const source = asset.kind === "image" ? imageCache.get(asset.id) : videoCache.get(asset.id);
        if (source) {
          if (source instanceof HTMLVideoElement && Math.abs(source.currentTime - local) > 0.12) {
            try { source.currentTime = Math.min(Math.max(0, local), Math.max(0, source.duration - 0.04)); } catch { /* wait for video metadata */ }
          }
          const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
          const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
          if (sw && sh) { const scale = Math.max(canvas.width / sw, canvas.height / sh); const w = sw * scale, h = sh * scale; ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); }
        } else { ctx.fillStyle = track.name.toLowerCase().includes("overlay") ? "#24563a" : "#183d2b"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.filter = "none"; ctx.restore();
      });
      titles.filter((clip) => time >= clip.start && time < clip.start + clip.duration).forEach((clip) => {
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, clip.opacity)); ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 18;
        const size = Math.round(canvas.height * (clip.titleStyle === "subtitle" ? 0.045 : 0.075));
        ctx.font = "800 " + size + "px Arial, sans-serif"; ctx.textAlign = clip.titleStyle === "lower" ? "left" : "center";
        const x = clip.titleStyle === "lower" ? canvas.width * 0.08 : canvas.width / 2;
        const y = clip.titleStyle === "lower" ? canvas.height * 0.86 : clip.titleStyle === "subtitle" ? canvas.height * 0.9 : canvas.height / 2;
        if (clip.titleStyle === "subtitle") { const width = Math.min(canvas.width * 0.88, ctx.measureText(clip.text ?? "").width + 40); ctx.fillStyle = "rgba(0,0,0,.68)"; ctx.fillRect((canvas.width - width) / 2, y - size, width, size * 1.6); ctx.fillStyle = "#fff"; }
        ctx.fillText(clip.text ?? "", x, y, canvas.width * 0.86); ctx.restore();
      });
    };
    draw(0); recorder.start(250);
    const started = performance.now(); const frameMs = 1000 / options.fps;
    await new Promise<void>((resolve) => {
      const tick = () => { const elapsed = (performance.now() - started) / 1000; const time = Math.min(duration, elapsed); draw(time); onProgress(Math.min(96, Math.round(time / duration * 96)), "Rendering " + Math.round(time / duration * 100) + "%"); if (time >= duration) { recorder.stop(); resolve(); } else window.setTimeout(tick, frameMs); };
      tick();
    });
    onProgress(98, "Finishing video…"); return await completed;
  } finally {
    scheduled.forEach((source) => { try { source.stop(); } catch { /* already ended */ } });
    await audioContext.close().catch(() => undefined);
    videoCache.forEach((video) => { video.pause(); video.removeAttribute("src"); video.load(); });
  }
}

/** Load FFmpeg WebAssembly only when the user chooses MP4. */
async function convertWebMToMp4(input: Blob, onProgress: ExportProgress): Promise<Blob> {
  const w = window as Window & { FFmpeg?: any };
  if (!w.FFmpeg) await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
    script.onload = () => resolve(); script.onerror = () => reject(new Error("Could not load FFmpeg. Check your connection or export as WebM."));
    document.head.appendChild(script);
  });
  const api = w.FFmpeg; if (!api?.createFFmpeg) throw new Error("FFmpeg WebAssembly could not be initialized.");
  const ffmpeg = api.createFFmpeg({ log: false, corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js" });
  if (!ffmpeg.isLoaded()) await ffmpeg.load();
  ffmpeg.FS("writeFile", "input.webm", new Uint8Array(await input.arrayBuffer()));
  ffmpeg.setProgress(({ ratio }: { ratio: number }) => onProgress(98 + Math.round(Math.max(0, Math.min(1, ratio)) * 2), "Converting to MP4…"));
  await ffmpeg.run("-i", "input.webm", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "output.mp4");
  const output = ffmpeg.FS("readFile", "output.mp4"); ffmpeg.FS("unlink", "input.webm"); ffmpeg.FS("unlink", "output.mp4");
  return new Blob([output.buffer], { type: "video/mp4" });
}

export default function VideoStudio({ onExport }: { onExport: () => void }) {
  const [media, setMedia] = useState<Media[]>(initialMedia);
  const [project, setProject] = useState<Project>(initialProject);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(56);
  const [snapOn, setSnapOn] = useState(true);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [panelTab, setPanelTab] = useState<"media" | "titles">("media");
  const [projectName, setProjectName] = useState("Kigali at dawn");
  const [status, setStatus] = useState("Ready. Click a clip in the media panel to add it.");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [exportFormat, setExportFormat] = useState<"webm" | "mp4">("webm");
  const [exportSize, setExportSize] = useState<"720p" | "1080p">("1080p");
  const [exportFps, setExportFps] = useState<30 | 60>(30);
  const [exportQuality, setExportQuality] = useState<"standard" | "high">("high");
  const [, setHistoryVersion] = useState(0);

  const projectRef = useRef(project);
  projectRef.current = project;
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
  const actions = useRef<Actions | null>(null);

  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const selected = project.clips.find((c) => c.id === selectedId) ?? null;
  const selectedMedia = selected?.mediaId ? mediaMap.get(selected.mediaId) : undefined;
  const contentEnd = project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
  const total = Math.max(contentEnd, 1);
  const totalRef = useRef(total);
  totalRef.current = total;
  const timelineSeconds = Math.max(total + 10, 24);
  const trackById = useMemo(() => new Map(project.tracks.map((t) => [t.id, t])), [project.tracks]);

  /* ---- status + history ---- */

  const flash = (message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus("Ready"), 4200);
  };

  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  const snapshot = () => {
    pastRef.current = [...pastRef.current.slice(-99), projectRef.current];
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  };

  const change = (fn: (p: Project) => Project) => {
    snapshot();
    setProject(fn);
  };

  const liveEdit = (fn: (p: Project) => Project) => {
    if (!editGuard.current) {
      snapshot();
      editGuard.current = true;
    }
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
    if (live) liveEdit(apply);
    else change(apply);
  };

  const updateTrack = (id: string, patch: Partial<Track>) => change((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  /* ---- transport ---- */

  const seek = (time: number) => {
    const value = Math.max(0, time);
    playheadRef.current = value;
    setPlayhead(value);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (playheadRef.current >= totalRef.current - 0.01) seek(0);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = playheadRef.current + (now - last) / 1000;
      last = now;
      if (next >= totalRef.current) {
        playheadRef.current = totalRef.current;
        setPlayhead(totalRef.current);
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
    if (x > scroller.scrollLeft + scroller.clientWidth - 30 || x < scroller.scrollLeft + LABEL_W) {
      scroller.scrollLeft = Math.max(0, x - LABEL_W - 60);
    }
  }, [playhead, playing, pps]);

  /* ---- editing actions ---- */

  const trackLocked = (clip: Clip) => trackById.get(clip.trackId)?.locked ?? false;

  const addMedia = (item: Media) => {
    const kind: TrackKind = item.kind === "audio" ? "audio" : "video";
    const preferred = kind === "audio" ? "t-a1" : "t-v1";
    const track =
      project.tracks.find((t) => t.id === preferred && !t.locked) ??
      project.tracks.find((t) => t.kind === kind && !t.locked);
    if (!track) {
      flash("Unlock a " + kind + " track to add this clip.");
      return;
    }
    const duration = item.kind === "image" ? 4 : item.duration;
    const start = freeStart(project.clips, track.id, playheadRef.current, duration);
    const clip: Clip = { id: uid("c"), trackId: track.id, mediaId: item.id, label: item.name, start, inPoint: 0, duration, volume: 1, opacity: 1 };
    change((p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
    flash("Added " + item.name + " to " + track.name + ".");
  };

  const addTitle = (preset: (typeof titlePresets)[number]) => {
    const track = project.tracks.find((t) => t.kind === "title");
    if (!track || track.locked) {
      flash("Unlock the Titles track to add a title.");
      return;
    }
    const start = freeStart(project.clips, track.id, playheadRef.current, 3);
    const clip: Clip = { id: uid("c"), trackId: track.id, label: preset.name, start, inPoint: 0, duration: 3, volume: 1, opacity: 1, text: preset.text, titleStyle: preset.style };
    change((p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
    flash("Added a " + preset.name.toLowerCase() + ". Edit its text in the inspector.");
  };

  const split = () => {
    const t = playheadRef.current;
    const inside = (c: Clip) => !trackLocked(c) && t > c.start + 0.05 && t < c.start + c.duration - 0.05;
    const targets = selected ? (inside(selected) ? [selected] : []) : project.clips.filter(inside);
    if (targets.length === 0) {
      flash(selected ? "Move the playhead over the selected clip to split it." : "Move the playhead over a clip to split it.");
      return;
    }
    const ids = new Set(targets.map((c) => c.id));
    let nextSelection: string | null = null;
    const clips = project.clips.flatMap((c) => {
      if (!ids.has(c.id)) return [c];
      const firstLength = t - c.start;
      const second: Clip = { ...c, id: uid("c"), start: t, inPoint: c.inPoint + firstLength, duration: c.duration - firstLength };
      if (targets.length === 1) nextSelection = second.id;
      return [{ ...c, duration: firstLength }, second];
    });
    change((p) => ({ ...p, clips }));
    setSelectedId(nextSelection);
    flash("Split at " + timecode(t) + ".");
  };

  const duplicate = () => {
    if (!selected) {
      flash("Select a clip to duplicate it.");
      return;
    }
    const start = freeStart(project.clips, selected.trackId, selected.start + selected.duration, selected.duration);
    const copy: Clip = { ...selected, id: uid("c"), start };
    change((p) => ({ ...p, clips: [...p.clips, copy] }));
    setSelectedId(copy.id);
    flash("Duplicated " + selected.label + ".");
  };

  const remove = () => {
    if (!selected) {
      flash("Select a clip to delete it.");
      return;
    }
    if (trackLocked(selected)) {
      flash("Unlock the track to delete this clip.");
      return;
    }
    change((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selected.id) }));
    setSelectedId(null);
    flash("Deleted " + selected.label + ".");
  };

  const resetAll = () => {
    if (project.clips.length === 0) return;
    change(() => ({ tracks: defaultTracks(), clips: [] }));
    setSelectedId(null);
    seek(0);
    setPlaying(false);
    flash("Timeline cleared. Undo brings it back.");
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    flash("Reading " + files.length + (files.length === 1 ? " file…" : " files…"));
    const added: Media[] = [];
    for (const file of files) {
      const item = await readMedia(file);
      if (item) added.push(item);
    }
    if (added.length === 0) {
      flash("Those files can't be used. Choose a video, audio or image file.");
      return;
    }
    setMedia((previous) => [...previous, ...added]);
    setPanelTab("media");
    flash("Imported " + added.length + (added.length === 1 ? " file." : " files.") + " Click one to add it.");
  };

  actions.current = {
    togglePlay, split, duplicate, remove, undo, redo,
    step: (delta) => { setPlaying(false); seek(clamp(playheadRef.current + delta, 0, timelineSeconds)); },
    seek,
    seekEnd: () => { setPlaying(false); seek(totalRef.current); },
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") !== null)) return;
      const api = actions.current;
      if (!api) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) api.redo(); else api.undo(); return; }
      if (mod && key === "y") { event.preventDefault(); api.redo(); return; }
      if (mod && key === "d") { event.preventDefault(); api.duplicate(); return; }
      if (mod || event.altKey) return;
      if (event.key === " " && target?.closest("button, a") === null) { event.preventDefault(); api.togglePlay(); }
      else if (key === "s") { api.split(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); api.remove(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); api.step(event.shiftKey ? -1 : -1 / FPS); }
      else if (event.key === "ArrowRight") { event.preventDefault(); api.step(event.shiftKey ? 1 : 1 / FPS); }
      else if (event.key === "Home") { event.preventDefault(); api.seek(0); }
      else if (event.key === "End") { event.preventDefault(); api.seekEnd(); }
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
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  };

  const scrubTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    const x = event.clientX - ruler.getBoundingClientRect().left;
    seek(clamp(x / ppsRef.current, 0, timelineSeconds));
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
      const minStart = Math.max(low, limited ? orig.start - orig.inPoint : 0);
      let next = orig.start + dt;
      next = snapEdge(next, points) ?? next;
      next = clamp(next, minStart, orig.start + orig.duration - MIN_CLIP);
      const delta = next - orig.start;
      patch = { start: next, duration: orig.duration - delta, inPoint: limited ? orig.inPoint + delta : orig.inPoint };
    } else {
      const high = onTrack.reduce((value, c) => (c.start >= orig.start + orig.duration - 1e-6 ? Math.min(value, c.start) : value), Infinity);
      const mediaLimit = limited && originMedia ? orig.start + (originMedia.duration - orig.inPoint) : Infinity;
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
    // A drag that ended where it began should not leave an empty undo step.
    const last = pastRef.current[pastRef.current.length - 1];
    if (last && JSON.stringify(last.clips) === JSON.stringify(projectRef.current.clips)) {
      pastRef.current.pop();
      setHistoryVersion((v) => v + 1);
    }
  };


  const startExport = async () => {
    if (exporting) return;
    if (project.clips.length === 0) { flash("Add clips to the timeline before exporting."); return; }
    setExporting(true); setExportProgress(0); setExportMessage("Preparing your timeline…"); setPlaying(false);
    try {
      const width = exportSize === "1080p" ? (aspect === "9:16" ? 1080 : 1920) : (aspect === "9:16" ? 720 : 1280);
      const height = exportSize === "1080p" ? (aspect === "9:16" ? 1920 : 1080) : (aspect === "9:16" ? 1280 : 720);
      const webm = await renderTimeline(project, media, { width, height, fps: exportFps, quality: exportQuality }, (value, message) => { setExportProgress(value); setExportMessage(message); });
      const result = exportFormat === "mp4" ? await convertWebMToMp4(webm, (value, message) => { setExportProgress(value); setExportMessage(message); }) : webm;
      const url = URL.createObjectURL(result); const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = (projectName.trim() || "mediapark-video").replace(/[^a-z0-9-_]+/gi, "-") + (exportFormat === "mp4" ? ".mp4" : ".webm");
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setExportProgress(100); setExportMessage("Export complete — your video has been downloaded."); flash("Video exported successfully.");
    } catch (error) { const message = error instanceof Error ? error.message : "Video export failed."; setExportMessage(message); flash(message); }
    finally { setExporting(false); }
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
  const videoMuted = (clip: Clip) => trackById.get(clip.trackId)?.muted ?? false;

  /* ---- timeline geometry ---- */

  const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 72) ?? 120;
  const ticks = Array.from({ length: Math.floor(timelineSeconds / step) + 1 }, (_, i) => i * step);
  const lanesWidth = timelineSeconds * pps;
  const innerStyle: CSSProperties = { width: LABEL_W + lanesWidth };
  const scrollHeight = RULER_H + project.tracks.length * TRACK_H + 16;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return (
    <section
      className="vs"
      aria-label="Video studio"
      onClick={(event) => {
        // After a mouse click, release focus from buttons so Space always plays or pauses.
        // Keyboard activation (detail 0) keeps its focus.
        const button = (event.target as HTMLElement).closest("button");
        if (event.detail > 0 && button) button.blur();
      }}
    >
      <header className="vs-head">
        <div className="vs-head-title">
          <span className="vs-head-icon"><Clapperboard size={18} /></span>
          <div>
            <input className="vs-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
            <div className="vs-status" role="status" aria-live="polite">{status}</div>
          </div>
        </div>
        <div className="vs-head-meta">
          <span>1080p</span><span>{FPS} fps</span><span>{aspect}</span>
        </div>
        <button className="vs-export" onClick={() => { onExport(); setExportOpen(true); }}><Download size={16} /> Export video</button>
      </header>

      <div className="vs-main">
        {/* Media panel */}
        <aside className="vs-panel vs-media" aria-label="Media panel">
          <div className="vs-panel-head">
            <div className="vs-tabs" role="tablist">
              <button role="tab" aria-selected={panelTab === "media"} className={panelTab === "media" ? "active" : ""} onClick={() => setPanelTab("media")}><Film size={14} /> Media</button>
              <button role="tab" aria-selected={panelTab === "titles"} className={panelTab === "titles" ? "active" : ""} onClick={() => setPanelTab("titles")}><Type size={14} /> Titles</button>
            </div>
            <button className="vs-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Import media" title="Import video, audio or images"><Upload size={16} /></button>
            <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={importFiles} />
          </div>
          {panelTab === "media" ? (
            <>
              <div className="vs-bin">
                {media.map((item) => (
                  <button className="vs-tile" key={item.id} onClick={() => addMedia(item)} title={"Add " + item.name + " at the playhead"}>
                    <span className="vs-tile-thumb" style={thumbStyle(item)}>
                      {item.kind === "audio" && <><Waveform seed={item.id} /><Music2 size={18} className="vs-tile-glyph" /></>}
                      {item.kind === "video" && !item.thumb && <Film size={20} className="vs-tile-glyph" />}
                      {item.kind === "image" && !item.thumb && <ImageIcon size={20} className="vs-tile-glyph" />}
                      <span className="vs-tile-time">{item.kind === "image" ? "Image" : shortTime(item.duration)}</span>
                      <span className="vs-tile-add"><Plus size={16} /></span>
                    </span>
                    <span className="vs-tile-name">{item.name}</span>
                  </button>
                ))}
              </div>
              <p className="vs-panel-foot">{media.length} items. Import video, audio or images from your device. Files stay in this browser.</p>
            </>
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
                <MediaLayer key={clip.id} clip={clip} media={item} time={playhead} playing={playing} muted={videoMuted(clip)} />
              ))}
              {audioLayers.map(({ clip, media: item, muted }) => (
                <MediaLayer key={clip.id} clip={clip} media={item} time={playhead} playing={playing} muted={muted} />
              ))}
              {titleLayers.map((clip) => (
                <div className={"vs-title-overlay " + (clip.titleStyle ?? "center")} style={{ opacity: clip.opacity }} key={clip.id}>
                  <div className="vs-title-text">{clip.text}</div>
                </div>
              ))}
              {visualLayers.length === 0 && titleLayers.length === 0 && (
                <div className="vs-empty"><Clapperboard size={30} /><b>Nothing at this point</b><span>Move the playhead over a clip, or add one from the media panel.</span></div>
              )}
              {selected && <span className="vs-chip">Selected: {seconds1(selected.duration)}</span>}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside className="vs-panel vs-inspector" aria-label="Inspector">
          <div className="vs-panel-head"><b>{selected ? "Clip" : "Project"}</b></div>
          {selected ? (
            <div className="vs-fields">
              <div className="vs-clip-title">{selected.label}{selectedMedia ? <small>{selectedMedia.kind === "color" ? "Generated clip" : selectedMedia.kind}</small> : <small>title</small>}</div>
              <dl className="vs-readout">
                <div><dt>Start</dt><dd>{timecode(selected.start)}</dd></div>
                <div><dt>Length</dt><dd>{seconds1(selected.duration)}</dd></div>
              </dl>
              {selected.text !== undefined && (
                <>
                  <label className="vs-field">Text
                    <textarea rows={2} value={selected.text} onChange={(e) => updateClip(selected.id, { text: e.target.value }, true)} onBlur={() => { editGuard.current = false; }} />
                  </label>
                  <div className="vs-field">Style
                    <div className="vs-segment">
                      {(["center", "lower", "subtitle"] as TitleStyle[]).map((style) => (
                        <button key={style} className={selected.titleStyle === style ? "active" : ""} onClick={() => updateClip(selected.id, { titleStyle: style })}>
                          {style === "lower" ? "Lower third" : style === "center" ? "Center" : "Subtitle"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {(selectedMedia?.kind === "video" || selectedMedia?.kind === "audio") && (
                <label className="vs-field">Volume <output>{Math.round(selected.volume * 100)}%</output>
                  <input type="range" min={0} max={1} step={0.01} value={selected.volume} onChange={(e) => updateClip(selected.id, { volume: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} />
                </label>
              )}
              {selectedMedia?.kind !== "audio" && (
                <label className="vs-field">Opacity <output>{Math.round(selected.opacity * 100)}%</output>
                  <input type="range" min={0} max={1} step={0.01} value={selected.opacity} onChange={(e) => updateClip(selected.id, { opacity: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} />
                </label>
              )}
              {selectedMedia && selectedMedia.kind !== "audio" && selected.text === undefined && <>
                <label className="vs-field">Brightness <output>{selected.brightness ?? 100}%</output><input type="range" min={0} max={200} value={selected.brightness ?? 100} onChange={(e) => updateClip(selected.id, { brightness: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} /></label>
                <label className="vs-field">Contrast <output>{selected.contrast ?? 100}%</output><input type="range" min={0} max={200} value={selected.contrast ?? 100} onChange={(e) => updateClip(selected.id, { contrast: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} /></label>
                <label className="vs-field">Saturation <output>{selected.saturation ?? 100}%</output><input type="range" min={0} max={200} value={selected.saturation ?? 100} onChange={(e) => updateClip(selected.id, { saturation: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} /></label>
                <label className="vs-field">Scale <output>{selected.scale ?? 100}%</output><input type="range" min={25} max={200} value={selected.scale ?? 100} onChange={(e) => updateClip(selected.id, { scale: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} /></label>
                <label className="vs-field">Rotation <output>{selected.rotation ?? 0}°</output><input type="range" min={-180} max={180} value={selected.rotation ?? 0} onChange={(e) => updateClip(selected.id, { rotation: Number(e.target.value) }, true)} onPointerUp={() => { editGuard.current = false; }} onBlur={() => { editGuard.current = false; }} /></label>
              </>}
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
              <p className="vs-hint">Select a clip on the timeline to change its text, volume or opacity. Drag a clip to move it, drag its edges to trim.</p>
              <ul className="vs-keys">
                <li><kbd>Space</kbd> play or pause</li>
                <li><kbd>S</kbd> split at playhead</li>
                <li><kbd>←</kbd> <kbd>→</kbd> step one frame</li>
                <li><kbd>Delete</kbd> remove clip</li>
                <li><kbd>Ctrl</kbd> <kbd>Z</kbd> undo</li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* Transport + timeline + toolbar */}
      <div className="vs-panel vs-bottom">
        <div className="vs-transport">
          <div className="vs-timecode" aria-label="Current time">
            <b>{timecode(playhead)}</b><span>/ {timecode(contentEnd)}</span>
          </div>
          <div className="vs-controls">
            <button className="vs-icon-btn" aria-label="Go to start" onClick={() => { setPlaying(false); seek(0); }}><SkipBack size={17} /></button>
            <button className="vs-icon-btn" aria-label="Back one frame" onClick={() => actions.current?.step(-1 / FPS)}><StepBack size={17} /></button>
            <button className="vs-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button className="vs-icon-btn" aria-label="Forward one frame" onClick={() => actions.current?.step(1 / FPS)}><StepForward size={17} /></button>
            <button className="vs-icon-btn" aria-label="Go to end" onClick={() => actions.current?.seekEnd()}><SkipForward size={17} /></button>
          </div>
          <div className="vs-zoom">
            <ZoomOut size={15} />
            <input type="range" min={20} max={200} step={2} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" />
            <ZoomIn size={15} />
          </div>
        </div>

        <div className="vs-tl-scroll" ref={scrollRef} style={{ height: scrollHeight }}>
          <div className="vs-tl-inner" style={innerStyle}>
            <div className="vs-ruler-row" style={{ height: RULER_H }}>
              <div className="vs-ruler-spacer" style={{ width: LABEL_W }} />
              <div
                className="vs-ruler"
                ref={rulerRef}
                style={{ width: lanesWidth, backgroundSize: (step * pps) / 5 + "px 8px" }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubbing.current = true; setPlaying(false); scrubTo(e); }}
                onPointerMove={(e) => { if (scrubbing.current) scrubTo(e); }}
                onPointerUp={() => { scrubbing.current = false; }}
                onPointerCancel={() => { scrubbing.current = false; }}
              >
                {ticks.map((t) => <span className="vs-tick" key={t} style={{ left: t * pps }}>{shortTime(t)}</span>)}
              </div>
            </div>

            <div className="vs-body">
              <div className="vs-labels" style={{ width: LABEL_W }}>
                {project.tracks.map((track) => (
                  <div className={"vs-label" + (track.locked ? " locked" : "")} style={{ height: TRACK_H }} key={track.id}>
                    <span className="vs-label-name">{track.name}</span>
                    <span className="vs-label-actions">
                      {track.kind === "audio" ? (
                        <button aria-label={(track.muted ? "Unmute " : "Mute ") + track.name} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                      ) : (
                        <button aria-label={(track.hidden ? "Show " : "Hide ") + track.name} aria-pressed={track.hidden} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>{track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                      )}
                      <button aria-label={(track.locked ? "Unlock " : "Lock ") + track.name} aria-pressed={track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                    </span>
                  </div>
                ))}
              </div>

              <div
                className="vs-lanes"
                ref={lanesRef}
                style={{ width: lanesWidth, height: project.tracks.length * TRACK_H }}
                onPointerDown={() => setSelectedId(null)}
              >
                {project.tracks.map((track, row) => (
                  <div className={"vs-lane " + track.kind + (track.locked ? " locked" : "") + (track.hidden || track.muted ? " off" : "")} style={{ top: row * TRACK_H, height: TRACK_H }} key={track.id} />
                ))}
                {project.clips.map((clip) => {
                  const track = trackById.get(clip.trackId);
                  const item = clip.mediaId ? mediaMap.get(clip.mediaId) : undefined;
                  const isSelected = clip.id === selectedId;
                  const kindClass = track?.kind === "audio" ? (track.id === "t-a2" ? "music" : "audio") : (track?.kind ?? "video");
                  const style: CSSProperties = {
                    left: clip.start * pps,
                    width: Math.max(clip.duration * pps, 6),
                    top: (trackIndex.get(clip.trackId) ?? 0) * TRACK_H + 4,
                    height: TRACK_H - 8,
                  };
                  const body: CSSProperties = track?.kind === "video" && item ? thumbStyle(item) : {};
                  if (track?.kind === "video" && item?.kind === "video" && item.thumb) {
                    body.backgroundRepeat = "repeat-x";
                    body.backgroundSize = "auto 100%";
                  }
                  return (
                    <div
                      key={clip.id}
                      className={"vs-clip " + kindClass + (isSelected ? " selected" : "") + (track?.locked ? " locked" : "")}
                      style={style}
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
                      <span className="vs-clip-fill" style={body} />
                      {track?.kind === "audio" && <Waveform seed={clip.mediaId ?? clip.id} />}
                      <span className="vs-clip-label">
                        {track?.kind === "title" ? (clip.text || clip.label) : track?.kind === "audio" ? <><AudioLines size={11} /> {clip.label}</> : clip.label}
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
                {project.clips.length === 0 && <div className="vs-lanes-empty">Your timeline is empty. Click a clip in the media panel to start.</div>}
              </div>
            </div>

            <div className="vs-playhead" style={{ left: LABEL_W + playhead * pps }} aria-hidden="true" />
          </div>
        </div>

        <div className="vs-toolbar">
          <div className="vs-tool-group">
            <ToolButton icon={Undo2} label="Undo" onClick={undo} disabled={!canUndo} />
            <ToolButton icon={Redo2} label="Redo" onClick={redo} disabled={!canRedo} />
            <ToolButton icon={RotateCcw} label="Reset all" onClick={resetAll} disabled={project.clips.length === 0} />
          </div>
          <div className="vs-tool-group center">
            <ToolButton icon={Scissors} label="Split" onClick={split} />
            <ToolButton icon={Copy} label="Duplicate" onClick={duplicate} disabled={!selected} />
            <ToolButton icon={Trash2} label="Delete" onClick={remove} disabled={!selected} />
            <ToolButton icon={Magnet} label="Snap" onClick={() => setSnapOn((v) => !v)} active={snapOn} />
          </div>
          <div className="vs-tool-group right">
            <ToolButton icon={Type} label="Add title" onClick={() => addTitle(titlePresets[0])} />
            <ToolButton icon={Upload} label="Import" onClick={() => fileRef.current?.click()} />
          </div>
        </div>
      </div>
      {exportOpen && <div className="vs-export-scrim" role="presentation">
        <section className="vs-export-dialog" role="dialog" aria-modal="true" aria-labelledby="vs-export-title">
          <div className="vs-export-dialog-head"><div><span className="vs-export-kicker">RENDER YOUR PROJECT</span><h3 id="vs-export-title">Export video</h3></div><button type="button" className="vs-icon-btn" disabled={exporting} onClick={() => setExportOpen(false)} aria-label="Close export settings">×</button></div>
          <div className="vs-export-options">
            <label>Format<select value={exportFormat} disabled={exporting} onChange={(event) => setExportFormat(event.target.value as "webm" | "mp4")}><option value="webm">WebM (fastest)</option><option value="mp4">MP4 (FFmpeg WebAssembly)</option></select></label>
            <label>Resolution<select value={exportSize} disabled={exporting} onChange={(event) => setExportSize(event.target.value as "720p" | "1080p")}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
            <label>Frame rate<select value={exportFps} disabled={exporting} onChange={(event) => setExportFps(Number(event.target.value) as 30 | 60)}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
            <label>Quality<select value={exportQuality} disabled={exporting} onChange={(event) => setExportQuality(event.target.value as "standard" | "high")}><option value="standard">Standard</option><option value="high">High</option></select></label>
          </div>
          <p className="vs-export-note">Rendering runs in this browser. Keep this tab open until the download starts. Longer projects may take several minutes and use significant memory.</p>
          {(exporting || exportProgress > 0) && <div className="vs-export-progress"><div><b>{exportMessage}</b><span>{exportProgress}%</span></div><progress max="100" value={exportProgress} /></div>}
          <div className="vs-export-actions"><button type="button" className="vs-cancel-export" disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button><button type="button" className="vs-export-start" disabled={exporting || project.clips.length === 0} onClick={() => void startExport()}>{exporting ? "Rendering…" : exportProgress === 100 ? "Export again" : "Start export"} <Download size={15} /></button></div>
        </section>
      </div>}
    </section>
  );
}
