export type MediaKind = "video" | "audio" | "image";
export type TrackKind = "title" | "video" | "audio";
export type TitleStyle = "center" | "lower" | "subtitle";
export type Aspect = "16:9" | "9:16" | "1:1";
export type Fit = "contain" | "cover";

export const ASPECTS: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

export type Media = {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  blob: Blob;
  /** Object URL for this session. Never stored. */
  url: string;
  width?: number;
  height?: number;
  /** Sprite of evenly spaced video frames, as a data URL. */
  strip?: string;
  frames?: number;
  /** Normalised audio peaks (0 to 1) across the whole file. */
  peaks?: number[];
};

export type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
};

export type Clip = {
  id: string;
  trackId: string;
  mediaId?: string;
  label: string;
  /** Timeline position in seconds. */
  start: number;
  /** Where in the source file the clip begins, in source seconds. */
  inPoint: number;
  /** Length on the timeline in seconds. Source length used = duration * speed. */
  duration: number;
  speed: number;
  volume: number;
  opacity: number;
  fadeIn: number;
  fadeOut: number;
  fit: Fit;
  zoom: number;
  text?: string;
  titleStyle?: TitleStyle;
  color?: string;
  size?: number;
};

export type Project = { tracks: Track[]; clips: Clip[] };

export type SavedProject = { project: Project; aspect: Aspect; name: string };
