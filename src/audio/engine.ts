import type { AClip, AProject, ATrack, Source } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/* ------------------------------------------------------------------ */
/* Noise gate, as an AudioWorklet so it also runs in offline rendering */
/* ------------------------------------------------------------------ */

const GATE_CODE = `
class MpGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "threshold", defaultValue: -50, minValue: -90, maxValue: 0, automationRate: "k-rate" },
      { name: "reduction", defaultValue: 0, minValue: 0, maxValue: 60, automationRate: "k-rate" }
    ];
  }
  constructor() { super(); this.env = 0; this.gain = 1; }
  process(inputs, outputs, params) {
    const input = inputs[0]; const output = outputs[0];
    if (!input || input.length === 0) return true;
    const threshold = Math.pow(10, params.threshold[0] / 20);
    const floor = Math.pow(10, -params.reduction[0] / 20);
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]));
      this.env += (peak - this.env) * (peak > this.env ? 0.2 : 0.0009);
      const target = this.env > threshold ? 1 : floor;
      this.gain += (target - this.gain) * (target > this.gain ? 0.012 : 0.0018);
      for (let c = 0; c < output.length; c++) output[c][i] = (input[Math.min(c, input.length - 1)][i]) * this.gain;
    }
    return true;
  }
}
registerProcessor("mp-gate", MpGate);
`;

const gateReady = new WeakSet<BaseAudioContext>();

export async function ensureGate(ctx: BaseAudioContext): Promise<boolean> {
  if (gateReady.has(ctx)) return true;
  try {
    const url = URL.createObjectURL(new Blob([GATE_CODE], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    gateReady.add(ctx);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Per-track effects chain                                             */
/* ------------------------------------------------------------------ */

export type TrackNodes = {
  input: GainNode;
  hp: BiquadFilterNode;
  humA: BiquadFilterNode;
  humB: BiquadFilterNode;
  hiss: BiquadFilterNode;
  gate: AudioWorkletNode | null;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  convolver: ConvolverNode;
  revWet: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  delWet: GainNode;
  vol: GainNode;
  pan: StereoPannerNode;
  irSize: number;
};

function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / length); // -60 dB at the end of the room time
      energy += data[i] * data[i];
    }
    // Unit energy, so the wet level is predictable whatever the room size.
    const scale = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

export function createTrack(ctx: BaseAudioContext, destination: AudioNode, gate: boolean): TrackNodes {
  const filter = (type: BiquadFilterType, frequency: number, q = 0.707) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const input = ctx.createGain();
  const hp = filter("highpass", 10);
  const humA = filter("peaking", 60, 25);
  const humB = filter("peaking", 120, 25);
  const hiss = filter("highshelf", 7000);
  const gateNode = gate ? new AudioWorkletNode(ctx, "mp-gate", { channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2] }) : null;
  const low = filter("lowshelf", 120);
  const mid = filter("peaking", 1000, 0.9);
  const high = filter("highshelf", 6000);
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  const revWet = ctx.createGain();
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const delWet = ctx.createGain();
  const vol = ctx.createGain();
  const pan = ctx.createStereoPanner();

  const chain: AudioNode[] = [input, hp, humA, humB, hiss];
  if (gateNode) chain.push(gateNode);
  chain.push(low, mid, high, comp, makeup);
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  makeup.connect(vol);
  makeup.connect(convolver);
  convolver.connect(revWet);
  revWet.connect(vol);
  makeup.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delWet);
  delWet.connect(vol);
  vol.connect(pan);
  pan.connect(destination);
  return { input, hp, humA, humB, hiss, gate: gateNode, low, mid, high, comp, makeup, convolver, revWet, delay, feedback, delWet, vol, pan, irSize: 0 };
}

/** Pushes a track's settings into its nodes. `smooth` avoids clicks when adjusting during playback. */
export function applyTrack(ctx: BaseAudioContext, nodes: TrackNodes, track: ATrack, audible: boolean, smooth: boolean) {
  const now = ctx.currentTime;
  const set = (param: AudioParam, value: number) => {
    if (smooth) param.setTargetAtTime(value, now, 0.02);
    else param.value = value;
  };
  const { fx } = track;
  set(nodes.vol.gain, audible ? track.volume : 0);
  set(nodes.pan.pan, clamp(track.pan, -1, 1));
  set(nodes.low.gain, fx.eq.bass);
  set(nodes.mid.gain, fx.eq.mid);
  set(nodes.high.gain, fx.eq.treble);

  const nr = fx.nr.amount;
  set(nodes.hp.frequency, nr > 0 ? 20 + nr * 90 : 10);
  const hum = fx.nr.hum;
  set(nodes.humA.frequency, hum || 60);
  set(nodes.humB.frequency, (hum || 60) * 2);
  set(nodes.humA.gain, hum ? -34 : 0);
  set(nodes.humB.gain, hum ? -28 : 0);
  set(nodes.hiss.gain, -nr * 14);
  if (nodes.gate) {
    set(nodes.gate.parameters.get("threshold")!, -64 + nr * 26);
    set(nodes.gate.parameters.get("reduction")!, nr * 32);
  }

  const c = fx.comp.amount;
  set(nodes.comp.threshold, -c * 38);
  set(nodes.comp.ratio, 1 + c * 11);
  set(nodes.comp.knee, 10);
  set(nodes.comp.attack, 0.008);
  set(nodes.comp.release, 0.22);
  // DynamicsCompressorNode adds large automatic make-up gain; this offsets it so loudness stays steady as the amount changes.
  set(nodes.makeup.gain, Math.pow(10, -(c * 11) / 20));

  if (fx.reverb.mix > 0 && nodes.irSize !== fx.reverb.size) {
    nodes.convolver.buffer = makeImpulse(ctx, fx.reverb.size);
    nodes.irSize = fx.reverb.size;
  }
  set(nodes.revWet.gain, fx.reverb.mix * 1.2);
  set(nodes.delay.delayTime, clamp(fx.delay.time, 0.01, 1.9));
  set(nodes.feedback.gain, clamp(fx.delay.feedback, 0, 0.85));
  set(nodes.delWet.gain, fx.delay.mix * 0.8);
}

export const isAudible = (track: ATrack, tracks: ATrack[]) => !track.mute && (!tracks.some((t) => t.solo) || track.solo);

/* ------------------------------------------------------------------ */
/* Master bus                                                          */
/* ------------------------------------------------------------------ */

export function createMaster(ctx: BaseAudioContext): { input: GainNode; output: AudioNode } {
  const input = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  input.connect(limiter);
  limiter.connect(ctx.destination);
  return { input, output: limiter };
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

export function clipGainAt(clip: AClip, t: number): number {
  const fadeIn = clip.fadeIn > 0 ? clamp((t - clip.start) / clip.fadeIn, 0, 1) : 1;
  const fadeOut = clip.fadeOut > 0 ? clamp((clip.start + clip.duration - t) / clip.fadeOut, 0, 1) : 1;
  return clip.gain * Math.min(fadeIn, fadeOut);
}

/** Schedules every clip that is still audible after `from`. Returns the started sources so they can be stopped. */
export function scheduleClips(
  ctx: BaseAudioContext,
  nodes: Map<string, TrackNodes>,
  clips: AClip[],
  sources: Map<string, Source>,
  from: number,
  startAt: number,
): AudioBufferSourceNode[] {
  const started: AudioBufferSourceNode[] = [];
  for (const clip of clips) {
    const source = sources.get(clip.sourceId);
    const track = nodes.get(clip.trackId);
    const end = clip.start + clip.duration;
    if (!source || !track || end <= from + 0.001) continue;
    const skip = Math.max(0, from - clip.start);
    const duration = clip.duration - skip;
    if (duration <= 0.001) continue;
    const when = startAt + Math.max(0, clip.start - from);
    const node = ctx.createBufferSource();
    node.buffer = source.buffer;
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(track.input);
    const begin = Math.max(from, clip.start);
    gain.gain.setValueAtTime(clipGainAt(clip, begin), when);
    const points = [clip.start + clip.fadeIn, end - clip.fadeOut, end].filter((p) => p > begin + 1e-6 && p <= end + 1e-6).sort((a, b) => a - b);
    for (const p of points) gain.gain.linearRampToValueAtTime(clipGainAt(clip, p), startAt + (p - from));
    node.start(when, clip.offset + skip, duration);
    node.onended = () => { node.disconnect(); gain.disconnect(); };
    started.push(node);
  }
  return started;
}

/* ------------------------------------------------------------------ */
/* Offline rendering for export                                        */
/* ------------------------------------------------------------------ */

export const projectEnd = (project: AProject) => project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);

export async function renderMix(project: AProject, sources: Map<string, Source>, sampleRate: number, normalize: boolean): Promise<AudioBuffer> {
  const end = projectEnd(project);
  if (end <= 0) throw new Error("There is nothing to export yet. Add a clip to a track first.");
  const wet = project.tracks.some((t) => t.fx.reverb.mix > 0 || t.fx.delay.mix > 0);
  const length = Math.ceil((end + (wet ? 3 : 0.25)) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const gate = await ensureGate(ctx);
  const master = createMaster(ctx);
  const nodes = new Map<string, TrackNodes>();
  for (const track of project.tracks) {
    const chain = createTrack(ctx, master.input, gate);
    applyTrack(ctx, chain, track, isAudible(track, project.tracks), false);
    nodes.set(track.id, chain);
  }
  scheduleClips(ctx, nodes, project.clips, sources, 0, 0);
  const rendered = await ctx.startRendering();
  if (normalize) {
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    const target = Math.pow(10, -1 / 20);
    if (peak > 0.0001) {
      const scale = target / peak;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= scale;
      }
    }
  }
  return rendered;
}

/* ------------------------------------------------------------------ */
/* Decoding and waveform                                               */
/* ------------------------------------------------------------------ */

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, 1, 44100);
  return context.decodeAudioData(await blob.arrayBuffer());
}

export function computeSourcePeaks(buffer: AudioBuffer): number[] {
  const buckets = Math.round(clamp(buffer.duration * 40, 200, 6000));
  const size = Math.max(1, Math.floor(buffer.length / buckets));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const from = b * size;
    const to = Math.min(buffer.length, from + size);
    for (const data of channels) for (let i = from; i < to; i += 4) peak = Math.max(peak, Math.abs(data[i]));
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}
