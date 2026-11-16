export type Fx = {
  eq: { bass: number; mid: number; treble: number };
  nr: { amount: number; hum: 0 | 50 | 60 };
  comp: { amount: number };
  reverb: { mix: number; size: number };
  delay: { mix: number; time: number; feedback: number };
};

export type ATrack = {
  id: string;
  name: string;
  color: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: Fx;
};

export type Source = {
  id: string;
  name: string;
  duration: number;
  buffer: AudioBuffer;
  peaks: number[];
  blob: Blob;
};

export type AClip = {
  id: string;
  trackId: string;
  sourceId: string;
  label: string;
  start: number;
  offset: number;
  duration: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
};

export type AProject = { tracks: ATrack[]; clips: AClip[] };

export type Meta = { title: string; artist: string; album: string; year: string; genre: string };

export type SavedAudio = { project: AProject; meta: Meta; name: string };

export const defaultFx = (): Fx => ({
  eq: { bass: 0, mid: 0, treble: 0 },
  nr: { amount: 0, hum: 0 },
  comp: { amount: 0 },
  reverb: { mix: 0, size: 1.6 },
  delay: { mix: 0, time: 0.35, feedback: 0.35 },
});

export const defaultMeta = (): Meta => ({ title: "", artist: "", album: "", year: "", genre: "" });

export function defaultTracks(): ATrack[] {
  const make = (id: string, name: string, color: string): ATrack => ({ id, name, color, volume: 0.85, pan: 0, mute: false, solo: false, fx: defaultFx() });
  return [make("a-voice", "Voiceover", "#6db7ff"), make("a-music", "Music", "#63d39a"), make("a-sfx", "SFX", "#e7b86a")];
}

export const TRACK_COLORS = ["#6db7ff", "#63d39a", "#e7b86a", "#ff9a7a", "#c59bff", "#7fe3e0", "#f2a6d6", "#b9d97a"];
