import type { Clip, Media, Track } from "./types";

export const FPS = 30;
export const MIN_CLIP = 0.2;

let idCounter = 0;
export const uid = (prefix: string) => prefix + "-" + Date.now().toString(36) + "-" + ++idCounter + Math.random().toString(36).slice(2, 5);
export const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const pad = (value: number) => String(Math.floor(value)).padStart(2, "0");

export function timecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const frames = Math.floor((safe - whole) * FPS + 1e-6);
  return pad(whole / 3600) + ":" + pad((whole % 3600) / 60) + ":" + pad(whole % 60) + ":" + pad(frames);
}

export function shortTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return Math.floor(whole / 60) + ":" + pad(whole % 60);
}

export const seconds1 = (value: number) => value.toFixed(1) + "s";

export function defaultTracks(): Track[] {
  const base = { muted: false, hidden: false, locked: false };
  return [
    { id: "t-title", name: "Text", kind: "title", ...base },
    { id: "t-v1", name: "Video", kind: "video", ...base },
    { id: "t-a1", name: "Audio", kind: "audio", ...base },
  ];
}

export function newClip(partial: Pick<Clip, "trackId" | "label" | "start" | "duration"> & Partial<Clip>): Clip {
  return { id: uid("c"), inPoint: 0, speed: 1, volume: 1, opacity: 1, fadeIn: 0, fadeOut: 0, fit: "contain", zoom: 1, ...partial };
}

/** 0 to 1 multiplier for a clip's fade in and fade out at timeline time t. */
export function fadeFactor(clip: Clip, t: number): number {
  const fadeIn = clip.fadeIn > 0 ? clamp((t - clip.start) / clip.fadeIn, 0, 1) : 1;
  const fadeOut = clip.fadeOut > 0 ? clamp((clip.start + clip.duration - t) / clip.fadeOut, 0, 1) : 1;
  return Math.min(fadeIn, fadeOut);
}

/** First free start at or after `desired` where a clip of `length` fits on the track. */
export function freeStart(clips: Clip[], trackId: string, desired: number, length: number): number {
  const onTrack = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let start = Math.max(0, desired);
  for (const c of onTrack) {
    if (start < c.start + c.duration - 1e-6 && start + length > c.start + 1e-6) start = c.start + c.duration;
  }
  return start;
}

/** Clamp a clip between its neighbours. Returns null when it cannot fit on that track. */
export function placeClip(clips: Clip[], self: Clip, trackId: string, desired: number): number | null {
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

/** Does a span overlap any clip already on the track? */
export function isFree(clips: Clip[], trackId: string, start: number, length: number, ignoreId?: string): boolean {
  return !clips.some((c) => c.trackId === trackId && c.id !== ignoreId && start < c.start + c.duration - 1e-6 && start + length > c.start + 1e-6);
}

/* ---------------------------- Reading files ---------------------------- */

function detectKind(file: File): Media["kind"] | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  if (/\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i.test(file.name)) return "audio";
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(file.name)) return "image";
  return null;
}

function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function loadMetadata(element: HTMLMediaElement, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 15000);
    element.preload = "auto";
    element.muted = true;
    element.onerror = () => { window.clearTimeout(timer); resolve(false); };
    element.onloadeddata = () => { window.clearTimeout(timer); resolve(true); };
    element.src = url;
  });
}

function frameDataUrl(video: HTMLVideoElement, width: number, height: number): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

/** Reads a file into a media item quickly. Frames and waveform are added later by enrichMedia. */
export async function readMedia(file: File): Promise<Media | null> {
  const kind = detectKind(file);
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  const name = file.name.replace(/\.[^.]+$/, "") || "Untitled";
  const base = { id: uid("m"), name, kind, blob: file as Blob, url };

  if (kind === "image") {
    const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
    if (!size) { URL.revokeObjectURL(url); return null; }
    return { ...base, duration: 5, width: size.w, height: size.h };
  }

  const element = document.createElement(kind === "video" ? "video" : "audio");
  const ok = await loadMetadata(element, url);
  const duration = element.duration;
  if (!ok || !Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(url);
    return null;
  }
  if (element instanceof HTMLVideoElement) {
    const width = element.videoWidth || 1280;
    const height = element.videoHeight || 720;
    const tw = Math.round(64 * (width / height));
    await seekTo(element, Math.min(0.1, duration / 2));
    const strip = frameDataUrl(element, tw, 64);
    return { ...base, duration, width, height, strip, frames: strip ? 1 : undefined };
  }
  return { ...base, duration };
}

/** Builds a sprite of evenly spaced frames across a video so the timeline can show real thumbnails. */
export async function buildStrip(media: Media): Promise<{ strip: string; frames: number } | null> {
  if (media.kind !== "video") return null;
  const video = document.createElement("video");
  if (!(await loadMetadata(video, media.url))) return null;
  const frames = Math.round(clamp(media.duration / 1.5, 6, 30));
  const th = 64;
  const tw = Math.round(th * ((media.width ?? 16) / (media.height ?? 9)));
  const canvas = document.createElement("canvas");
  canvas.width = tw * frames;
  canvas.height = th;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    for (let i = 0; i < frames; i++) {
      await seekTo(video, clamp(((i + 0.5) / frames) * media.duration, 0, media.duration - 0.05));
      context.drawImage(video, i * tw, 0, tw, th);
    }
    return { strip: canvas.toDataURL("image/jpeg", 0.6), frames };
  } catch {
    return null;
  }
}

/** Decodes audio to a coarse loudness profile. Skipped for very large files. */
export async function computePeaks(blob: Blob, buckets = 480): Promise<number[] | null> {
  if (blob.size > 80 * 1024 * 1024) return null;
  try {
    const context = new OfflineAudioContext(1, 1, 44100);
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const data = decoded.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    let max = 0;
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      const from = b * size;
      const to = Math.min(data.length, from + size);
      for (let i = from; i < to; i += 8) peak = Math.max(peak, Math.abs(data[i]));
      peaks.push(peak);
      max = Math.max(max, peak);
    }
    return max > 0 ? peaks.map((p) => p / max) : peaks;
  } catch {
    return null;
  }
}
