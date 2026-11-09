import { ASPECTS, type Aspect, type Clip, type Media, type Project, type Track } from "./types";
import { clamp, fadeFactor } from "./utils";

export type ExportOptions = {
  project: Project;
  media: Map<string, Media>;
  aspect: Aspect;
  /** Length of the shorter side in pixels. */
  resolution: number;
  fps: number;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};

export type ExportResult = { blob: Blob; mime: string; extension: string };

type Runtime = {
  clip: Clip;
  track: Track;
  media: Media;
  element?: HTMLMediaElement;
  image?: HTMLImageElement;
  gain?: GainNode;
  playing: boolean;
};

const MIME_CANDIDATES: Array<{ mime: string; extension: string }> = [
  { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
  { mime: "video/webm;codecs=vp9,opus", extension: "webm" },
  { mime: "video/webm;codecs=vp8,opus", extension: "webm" },
  { mime: "video/webm", extension: "webm" },
];

export function exportSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

export function frameSize(aspect: Aspect, resolution: number): { width: number; height: number } {
  const ratio = ASPECTS[aspect];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1 ? { width: even(resolution * ratio), height: even(resolution) } : { width: even(resolution), height: even(resolution / ratio) };
}

function waitFor(element: HTMLMediaElement | HTMLImageElement, events: string[], ready: () => boolean, timeout = 10000): Promise<void> {
  return new Promise((resolve) => {
    if (ready()) return resolve();
    const done = () => {
      window.clearTimeout(timer);
      events.forEach((name) => element.removeEventListener(name, done));
      resolve();
    };
    const timer = window.setTimeout(done, timeout);
    events.forEach((name) => element.addEventListener(name, done, { once: true }));
  });
}

function drawFitted(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, cw: number, ch: number, clip: Clip, alpha: number) {
  if (!sw || !sh || alpha <= 0) return;
  const base = clip.fit === "cover" ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
  const scale = base * clip.zoom;
  const w = sw * scale;
  const h = sh * scale;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.drawImage(source, (cw - w) / 2, (ch - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? line + " " + word : word;
      if (line && ctx.measureText(attempt).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = attempt;
    }
    lines.push(line);
  }
  return lines;
}

function drawTitle(ctx: CanvasRenderingContext2D, clip: Clip, cw: number, ch: number, alpha: number) {
  const text = clip.text ?? "";
  if (!text.trim() || alpha <= 0) return;
  const style = clip.titleStyle ?? "center";
  const size = clip.size ?? 1;
  const px = cw * (style === "center" ? 0.064 : style === "lower" ? 0.04 : 0.028) * size;
  const weight = style === "subtitle" ? 600 : 800;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = weight + " " + px + 'px Manrope, "DM Sans", sans-serif';
  ctx.textBaseline = "top";
  const lineHeight = px * (style === "center" ? 1.1 : 1.15);
  const color = clip.color ?? "#ffffff";

  if (style === "center") {
    const lines = wrapLines(ctx, text, cw * 0.84);
    const top = (ch - lines.length * lineHeight) / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = cw * 0.02;
    lines.forEach((line, i) => ctx.fillText(line, cw / 2, top + i * lineHeight));
  } else if (style === "lower") {
    const barW = cw * 0.007;
    const gap = cw * 0.018;
    const x = cw * 0.06;
    const lines = wrapLines(ctx, text, cw * 0.8);
    const height = lines.length * lineHeight;
    const top = ch - cw * 0.09 - height;
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = cw * 0.02;
    ctx.fillStyle = "#b8e99b";
    ctx.fillRect(x, top, barW, height);
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    lines.forEach((line, i) => ctx.fillText(line, x + barW + gap, top + i * lineHeight));
  } else {
    const lines = wrapLines(ctx, text, cw * 0.8);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = cw * 0.018;
    const padY = cw * 0.007;
    const height = lines.length * lineHeight;
    const boxW = widest + padX * 2;
    const boxH = height + padY * 2;
    const left = (cw - boxW) / 2;
    const top = ch - cw * 0.05 - boxH;
    ctx.fillStyle = "rgba(0,0,0,.62)";
    ctx.beginPath();
    ctx.roundRect(left, top, boxW, boxH, cw * 0.008);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    lines.forEach((line, i) => ctx.fillText(line, cw / 2, top + padY + i * lineHeight));
  }
  ctx.restore();
}


/* ------------------------------------------------------------------ */
/* MediaRecorder writes WebM files with no length in the header, so players show an unknown duration. */
/* ------------------------------------------------------------------ */

type Vint = { value: number; length: number; unknown: boolean };

function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): Vint | null {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) { mask >>= 1; length++; }
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) {
    const next = bytes[pos + i];
    if (next === undefined) return null;
    value = value * 256 + next;
  }
  return { value, length, unknown: !keepMarker && value === Math.pow(2, 7 * length) - 1 };
}

export async function fixWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
  try {
    if (!blob.type.includes("webm") || seconds <= 0) return blob;
    const head = new Uint8Array(await blob.slice(0, 16384).arrayBuffer());
    let pos = 0;
    const ebml = readVint(head, pos, true);
    if (!ebml || ebml.value !== 0x1a45dfa3) return blob;
    pos += ebml.length;
    const ebmlSize = readVint(head, pos, false);
    if (!ebmlSize) return blob;
    pos += ebmlSize.length + ebmlSize.value;
    const segment = readVint(head, pos, true);
    if (!segment || segment.value !== 0x18538067) return blob;
    pos += segment.length;
    const segmentSize = readVint(head, pos, false);
    if (!segmentSize || !segmentSize.unknown) return blob;
    pos += segmentSize.length;

    while (pos < head.length) {
      const id = readVint(head, pos, true);
      const size = id ? readVint(head, pos + id.length, false) : null;
      if (!id || !size || size.unknown) return blob;
      const dataStart = pos + id.length + size.length;
      if (id.value === 0x114d9b74) return blob; // a SeekHead would point at shifted offsets
      if (id.value === 0x1549a966) {
        if (dataStart + size.value > head.length) return blob;
        const info = head.slice(dataStart, dataStart + size.value);
        let scale = 1000000;
        for (let i = 0; i < info.length; ) {
          const childId = readVint(info, i, true);
          const childSize = childId ? readVint(info, i + childId.length, false) : null;
          if (!childId || !childSize) return blob;
          const childStart = i + childId.length + childSize.length;
          if (childId.value === 0x4489) return blob; // already has a duration
          if (childId.value === 0x2ad7b1) {
            let v = 0;
            for (let k = 0; k < childSize.value; k++) v = v * 256 + info[childStart + k];
            scale = v;
          }
          i = childStart + childSize.value;
        }
        const duration = new Uint8Array(11);
        duration.set([0x44, 0x89, 0x88]);
        new DataView(duration.buffer).setFloat64(3, (seconds * 1e9) / scale, false);
        const newLength = info.length + duration.length;
        const header = new Uint8Array([0x15, 0x49, 0xa9, 0x66, 0x10 | ((newLength >>> 24) & 0x0f), (newLength >>> 16) & 0xff, (newLength >>> 8) & 0xff, newLength & 0xff]);
        return new Blob([head.slice(0, pos), header, info, duration, blob.slice(dataStart + size.value)], { type: blob.type });
      }
      pos = dataStart + size.value;
    }
    return blob;
  } catch {
    return blob;
  }
}

/** Renders the timeline to a video file in real time by recording a canvas and the mixed audio. */
export async function exportVideo(options: ExportOptions): Promise<ExportResult> {
  const { project, media, aspect, resolution, fps, signal, onProgress } = options;
  if (!exportSupported()) throw new Error("This browser cannot record video. Try Chrome, Edge, Firefox or Safari 14.1 or newer.");
  const total = project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
  if (total <= 0) throw new Error("The timeline is empty. Add a clip first.");

  const { width: cw, height: ch } = frameSize(aspect, resolution);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a drawing surface.");

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));
  const order = new Map(project.tracks.map((t, i) => [t.id, i]));
  const runtimes: Runtime[] = [];

  const cleanup = () => {
    for (const r of runtimes) {
      r.element?.pause();
      r.element?.removeAttribute("src");
      r.element?.load();
      r.gain?.disconnect();
    }
    void audioContext.close().catch(() => undefined);
  };

  try {
    for (const clip of project.clips) {
      const track = trackById.get(clip.trackId);
      if (!track || track.hidden) continue;
      if (track.kind === "title") continue;
      const item = clip.mediaId ? media.get(clip.mediaId) : undefined;
      if (!item) continue;
      const runtime: Runtime = { clip, track, media: item, playing: false };
      if (item.kind === "image") {
        const image = new Image();
        image.src = item.url;
        runtime.image = image;
      } else {
        const element = document.createElement(item.kind === "video" && track.kind === "video" ? "video" : "audio");
        element.preload = "auto";
        element.src = item.url;
        element.playbackRate = clip.speed;
        const source = audioContext.createMediaElementSource(element);
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(destination);
        runtime.element = element;
        runtime.gain = gain;
      }
      runtimes.push(runtime);
    }

    await audioContext.resume();
    await Promise.all(
      runtimes.map(async (r) => {
        if (r.image) await waitFor(r.image, ["load", "error"], () => r.image!.complete);
        if (r.element) {
          await waitFor(r.element, ["loadeddata", "error"], () => r.element!.readyState >= 2);
          r.element.currentTime = r.clip.inPoint;
          await waitFor(r.element, ["seeked", "error"], () => false, 1500);
        }
      }),
    );
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...destination.stream.getAudioTracks()]);
    const chosen = MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? { mime: "", extension: "webm" };
    const bitrate = Math.round(clamp(resolution, 360, 1080) * resolution * 4.2);
    const recorder = new MediaRecorder(stream, { ...(chosen.mime ? { mimeType: chosen.mime } : {}), videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const visuals = runtimes.filter((r) => r.track.kind === "video").sort((a, b) => (order.get(b.track.id) ?? 0) - (order.get(a.track.id) ?? 0));
    const titles = project.clips.filter((c) => {
      const t = trackById.get(c.trackId);
      return t?.kind === "title" && !t.hidden;
    });

    const render = (t: number) => {
      for (const r of runtimes) {
        const { clip, element } = r;
        const active = t >= clip.start && t < clip.start + clip.duration;
        if (!element) continue;
        if (active) {
          const local = clip.inPoint + (t - clip.start) * clip.speed;
          if (!r.playing) {
            element.currentTime = local;
            void element.play().catch(() => undefined);
            r.playing = true;
          } else if (Math.abs(element.currentTime - local) > 0.35) element.currentTime = local;
          if (r.gain) r.gain.gain.value = (r.track.muted ? 0 : 1) * clamp(clip.volume, 0, 1) * fadeFactor(clip, t);
        } else if (r.playing) {
          element.pause();
          r.playing = false;
          if (r.gain) r.gain.gain.value = 0;
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      for (const r of visuals) {
        const { clip } = r;
        if (t < clip.start || t >= clip.start + clip.duration) continue;
        const alpha = clip.opacity * fadeFactor(clip, t);
        if (r.image && r.image.naturalWidth) drawFitted(ctx, r.image, r.image.naturalWidth, r.image.naturalHeight, cw, ch, clip, alpha);
        else if (r.element instanceof HTMLVideoElement && r.element.readyState >= 2) drawFitted(ctx, r.element, r.element.videoWidth, r.element.videoHeight, cw, ch, clip, alpha);
      }
      for (const clip of titles) {
        if (t >= clip.start && t < clip.start + clip.duration) drawTitle(ctx, clip, cw, ch, clip.opacity * fadeFactor(clip, t));
      }
    };

    render(0);
    recorder.start(250);
    await new Promise<void>((resolve) => {
      const begin = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        const t = Math.min((now - begin) / 1000, total);
        render(t);
        onProgress(t / total);
        if (t >= total) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => window.setTimeout(r, 300));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    const recorded = new Blob(chunks, { type: chosen.mime.split(";")[0] || "video/webm" });
    return { blob: await fixWebmDuration(recorded, total), mime: chosen.mime, extension: chosen.extension };
  } finally {
    cleanup();
  }
}
