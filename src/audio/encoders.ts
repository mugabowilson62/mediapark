import type { Meta } from "./types";

export type AudioFormat = "wav" | "mp3" | "aac";
export type EncodeProgress = (fraction: number) => void;
export type EncodeResult = { blob: Blob; extension: string; note?: string };

const encoder = new TextEncoder();
const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

function toInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Typed-array generics differ across TypeScript versions; this keeps Blob construction portable. */
const part = (bytes: Uint8Array): BlobPart => bytes as unknown as BlobPart;

const hasMeta = (meta: Meta) => Object.values(meta).some((v) => v.trim() !== "");

/* ------------------------------ WAV ------------------------------ */

function infoChunk(id: string, text: string): Uint8Array | null {
  const value = text.trim();
  if (!value) return null;
  const body = encoder.encode(value + "\0");
  const padded = body.length % 2 ? body.length + 1 : body.length;
  const out = new Uint8Array(8 + padded);
  out.set(encoder.encode(id), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/** 16-bit PCM WAV. Title, artist and album are written into a RIFF LIST/INFO block before the audio data. */
export function encodeWav(buffer: AudioBuffer, meta: Meta): EncodeResult {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const dataSize = frames * channels * 2;
  const entries = [
    infoChunk("INAM", meta.title), infoChunk("IART", meta.artist), infoChunk("IPRD", meta.album),
    infoChunk("ICRD", meta.year), infoChunk("IGNR", meta.genre), infoChunk("ISFT", "Mediapark Audio Studio"),
  ].filter((c): c is Uint8Array => c !== null);
  const infoLength = 4 + entries.reduce((n, c) => n + c.length, 0);
  const listSize = 8 + infoLength;
  const out = new Uint8Array(12 + 24 + listSize + 8 + dataSize);
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string) => out.set(encoder.encode(value), offset);
  text(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  let pos = 36;
  text(pos, "LIST");
  view.setUint32(pos + 4, infoLength, true);
  text(pos + 8, "INFO");
  pos += 12;
  for (const chunk of entries) { out.set(chunk, pos); pos += chunk.length; }
  text(pos, "data");
  view.setUint32(pos + 4, dataSize, true);
  pos += 8;
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(pos, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      pos += 2;
    }
  }
  return { blob: new Blob([out], { type: "audio/wav" }), extension: "wav" };
}

/* ------------------------------ ID3 ------------------------------ */

function id3Frame(id: string, value: string): Uint8Array | null {
  const text = value.trim();
  if (!text) return null;
  const body = new Uint8Array(1 + 2 + text.length * 2);
  body[0] = 1; // UTF-16 with BOM
  body[1] = 0xff;
  body[2] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    body[3 + i * 2] = code & 0xff;
    body[4 + i * 2] = code >> 8;
  }
  const out = new Uint8Array(10 + body.length);
  out.set(encoder.encode(id), 0);
  new DataView(out.buffer).setUint32(4, body.length, false);
  out.set(body, 10);
  return out;
}

/** ID3v2.3 tag. Used at the start of MP3 and AAC (ADTS) files. */
export function buildId3(meta: Meta): Uint8Array {
  if (!hasMeta(meta)) return new Uint8Array(0);
  const frames = [id3Frame("TIT2", meta.title), id3Frame("TPE1", meta.artist), id3Frame("TALB", meta.album), id3Frame("TYER", meta.year), id3Frame("TCON", meta.genre), id3Frame("TSSE", "Mediapark Audio Studio")].filter((f): f is Uint8Array => f !== null);
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size);
  out.set(encoder.encode("ID3"), 0);
  out[3] = 3;
  out[4] = 0;
  out[5] = 0;
  out[6] = (size >> 21) & 0x7f;
  out[7] = (size >> 14) & 0x7f;
  out[8] = (size >> 7) & 0x7f;
  out[9] = size & 0x7f;
  let pos = 10;
  for (const f of frames) { out.set(f, pos); pos += f.length; }
  return out;
}

/* ------------------------------ MP3 ------------------------------ */

type Mp3Encoder = { encodeBuffer(left: Int16Array, right?: Int16Array): ArrayLike<number>; flush(): ArrayLike<number> };
type LameGlobal = { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3Encoder };

// The MP3 encoder (lamejs) is loaded only when someone exports an MP3, so the app starts without it
// and nothing needs installing. The version is pinned.
const LAME_URL = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
let lamePromise: Promise<LameGlobal> | null = null;

function loadLame(): Promise<LameGlobal> {
  const found = (window as unknown as { lamejs?: LameGlobal }).lamejs;
  if (found) return Promise.resolve(found);
  if (!lamePromise) {
    lamePromise = new Promise<LameGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LAME_URL;
      script.async = true;
      script.onload = () => {
        const lame = (window as unknown as { lamejs?: LameGlobal }).lamejs;
        if (lame) resolve(lame); else reject(new Error("The MP3 encoder loaded but did not start."));
      };
      script.onerror = () => reject(new Error("The MP3 encoder could not be downloaded."));
      document.head.appendChild(script);
    }).catch((error: Error) => {
      lamePromise = null;
      document.querySelectorAll('script[src="' + LAME_URL + '"]').forEach((node) => node.remove());
      throw error;
    });
  }
  return lamePromise;
}

export async function encodeMp3(buffer: AudioBuffer, kbps: number, meta: Meta, onProgress: EncodeProgress): Promise<EncodeResult> {
  let Ctor: LameGlobal["Mp3Encoder"];
  try {
    Ctor = (await loadLame()).Mp3Encoder;
  } catch {
    throw new Error("MP3 export needs to download a small encoder and couldn't reach it. Check your internet connection and try again, or export as WAV or AAC instead.");
  }
  const channels = Math.min(2, buffer.numberOfChannels);
  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : left;
  const mp3 = new Ctor(2, buffer.sampleRate, kbps);
  const parts: BlobPart[] = [];
  const id3 = buildId3(meta);
  if (id3.length) parts.push(part(id3));
  const block = 1152;
  let blocks = 0;
  for (let i = 0; i < left.length; i += block) {
    const chunk = mp3.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block));
    if (chunk.length) parts.push(part(Uint8Array.from(chunk as ArrayLike<number>, (v) => v & 0xff)));
    if (++blocks % 200 === 0) { onProgress(i / left.length); await pause(); }
  }
  const tail = mp3.flush();
  if (tail.length) parts.push(part(Uint8Array.from(tail as ArrayLike<number>, (v) => v & 0xff)));
  onProgress(1);
  return { blob: new Blob(parts, { type: "audio/mpeg" }), extension: "mp3" };
}

/* ------------------------------ AAC ------------------------------ */

const SAMPLE_RATE_INDEX: Record<number, number> = { 96000: 0, 88200: 1, 64000: 2, 48000: 3, 44100: 4, 32000: 5, 24000: 6, 22050: 7, 16000: 8 };

function adtsHeader(frameLength: number, sampleRate: number, channels: number): Uint8Array {
  const index = SAMPLE_RATE_INDEX[sampleRate] ?? 4;
  const length = frameLength + 7;
  return new Uint8Array([
    0xff, 0xf1,
    (1 << 6) | (index << 2) | (channels >> 2),
    ((channels & 3) << 6) | ((length >> 11) & 3),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
  ]);
}

/** Which AAC route this browser offers: raw .aac through WebCodecs, .m4a through MediaRecorder, or none. */
export async function detectAac(sampleRate = 44100): Promise<"adts" | "m4a" | null> {
  try {
    if (typeof AudioEncoder !== "undefined") {
      const support = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 128000 });
      if (support.supported) return "adts";
    }
  } catch { /* fall through */ }
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")) return "m4a";
  return null;
}

async function encodeAdts(buffer: AudioBuffer, kbps: number, meta: Meta, onProgress: EncodeProgress): Promise<EncodeResult> {
  const rate = buffer.sampleRate;
  const parts: BlobPart[] = [];
  const id3 = buildId3(meta);
  if (id3.length) parts.push(part(id3));
  let failure: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      parts.push(part(adtsHeader(data.length, rate, 2)), part(data));
    },
    error: (error) => { failure = error; },
  });
  audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: rate, numberOfChannels: 2, bitrate: kbps * 1000 });
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const block = 4096;
  for (let i = 0; i < left.length; i += block) {
    if (failure) throw failure;
    const frames = Math.min(block, left.length - i);
    const planar = new Float32Array(frames * 2);
    planar.set(left.subarray(i, i + frames), 0);
    planar.set(right.subarray(i, i + frames), frames);
    const data = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round((i / rate) * 1e6), data: planar });
    audioEncoder.encode(data);
    data.close();
    if ((i / block) % 40 === 0) {
      onProgress(i / left.length);
      while (audioEncoder.encodeQueueSize > 8) await pause();
    }
  }
  await audioEncoder.flush();
  audioEncoder.close();
  if (failure) throw failure;
  onProgress(1);
  return { blob: new Blob(parts, { type: "audio/aac" }), extension: "aac" };
}

/** Fallback: plays the mix through a MediaRecorder. Real time, and the file cannot carry tags. */
async function encodeM4a(buffer: AudioBuffer, onProgress: EncodeProgress): Promise<EncodeResult> {
  const context = new AudioContext({ sampleRate: buffer.sampleRate });
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(destination);
  const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/mp4;codecs=mp4a.40.2" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  await context.resume();
  recorder.start(250);
  source.start();
  const begin = performance.now();
  await new Promise<void>((resolve) => {
    source.onended = () => resolve();
    const timer = window.setInterval(() => {
      onProgress(Math.min(1, (performance.now() - begin) / 1000 / buffer.duration));
      if (recorder.state === "inactive") window.clearInterval(timer);
    }, 200);
  });
  recorder.stop();
  await finished;
  void context.close();
  return { blob: new Blob(chunks, { type: "audio/mp4" }), extension: "m4a", note: "This browser exports AAC as an .m4a file in real time. Title, artist and album tags can't be embedded this way." };
}

export async function encodeAac(buffer: AudioBuffer, kbps: number, meta: Meta, route: "adts" | "m4a" | null, onProgress: EncodeProgress): Promise<EncodeResult> {
  if (route === "adts") return encodeAdts(buffer, kbps, meta, onProgress);
  if (route === "m4a") return encodeM4a(buffer, onProgress);
  throw new Error("This browser can't encode AAC. Use a recent Chrome or Edge, or export as MP3 or WAV.");
}
