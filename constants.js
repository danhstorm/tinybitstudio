export const FRAME_WIDTH = 106;
export const STEPS_PER_BAR = 8;
export const DRUM_BARS = 2;
export const SYNTH_BARS = 2;
export const DRUM_STEPS = DRUM_BARS * STEPS_PER_BAR;
export const SYNTH_STEPS = SYNTH_BARS * STEPS_PER_BAR;
export const STEP_DURATION = "8n";
export const ARP_DURATION = "64n";
export const SCALE_SPREAD = 2;
export const LEVEL_SYMBOLS = { 0: ".", 1: "~", 2: "#" };
export const DIRECTION_SYMBOLS = { "-1": "v", 0: "", 1: "^" };
export const DIRECTION_VALUES = [-1, 0, 1];
export const CHANNEL_DEFAULT_GAIN = {
  drums: 0.85,
  bass: 0.9,
  lead: 0.92,
  arp: 0.8
};
export const TRACK_DEFAULT_OCTAVE = {
  bass: 2,
  lead: 4,
  arp: 5
};
export const TRACK_MAX_DECAY = {
  bass: 6.0,
  lead: 8.0,
  arp: 2.0
};
export const DEFAULT_STEP_DECAY = 5;
export const DEFAULT_BASS_DECAY = 2;
export const DEFAULT_LEAD_DECAY = 5;
export const DEFAULT_ARP_DECAY = 4;
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_RANGE_OCTAVES = 6;
export const MAX_NOTE_INDEX = NOTE_NAMES.length * NOTE_RANGE_OCTAVES - 1;
export const DEFAULT_NOTE_INDEX = 36;
export const DEFAULT_STEP_VELOCITY = 8;
export const KNOB_DRAG_STEP_PX = 6;
export const VISUALIZER_WIDTH = 30;
export const VISUALIZER_HEIGHT = 24;
export const KEYBOARD_NOTE_MAP = {
  a: { semitone: 0, octave: 0 },
  w: { semitone: 1, octave: 0 },
  s: { semitone: 2, octave: 0 },
  e: { semitone: 3, octave: 0 },
  d: { semitone: 4, octave: 0 },
  f: { semitone: 5, octave: 0 },
  t: { semitone: 6, octave: 0 },
  g: { semitone: 7, octave: 0 },
  y: { semitone: 8, octave: 0 },
  h: { semitone: 9, octave: 0 },
  u: { semitone: 10, octave: 0 },
  j: { semitone: 11, octave: 0 },
  k: { semitone: 0, octave: 1 },
  o: { semitone: 1, octave: 1 },
  l: { semitone: 2, octave: 1 },
  p: { semitone: 3, octave: 1 }
};
export const WAVE_TYPES = [
  { id: "sawtooth", label: "SAW" },
  { id: "square", label: "SQR" },
  { id: "sine", label: "SIN" }
];
export const arpChords = [
  { id: "maj", label: "M", code: "M", intervals: [0, 4, 7] },
  { id: "min", label: "m", code: "m", intervals: [0, 3, 7] },
  { id: "dim", label: "o", code: "d", intervals: [0, 3, 6] },
  { id: "sus", label: "S", code: "s", intervals: [0, 5, 7] },
  { id: "pwr", label: "P", code: "p", intervals: [0, 7, 12] }
];
export const defaultArpChord = arpChords[0];
export const arpChordById = Object.fromEntries(arpChords.map((chord) => [chord.id, chord]));
export const arpChordByCode = Object.fromEntries(arpChords.map((chord) => [chord.code, chord]));

export const drumLanes = [
  { key: "kick", label: "KICK", token: "K" },
  { key: "snare", label: "SNARE", token: "S" },
  { key: "clap", label: "CLAP", token: "C" },
  { key: "hat", label: "HATS", token: "H" },
  { key: "perc", label: "TOM", token: "P" }
];

export const synthTracks = [
  { key: "bass", label: "BASS", octave: 2, mode: "linear" },
  { key: "lead", label: "LEAD", octave: 4, mode: "linear" },
  { key: "arp", label: "CHRD", octave: 5, mode: "arp" }
];

export const scaleOptions = [
  { id: "cmaj", name: "C MAJ", blurb: "IONIAN", notes: ["C", "D", "E", "F", "G", "A", "B"] },
  { id: "amin", name: "A MIN", blurb: "NAT.MIN", notes: ["A", "B", "C", "D", "E", "F", "G"] },
  { id: "cmin", name: "C MIN", blurb: "HARM.MIN", notes: ["C", "D", "D#", "F", "G", "G#", "A#"] },
  { id: "cblues", name: "C BLU", blurb: "BLUES", notes: ["C", "D#", "F", "F#", "G", "A#"] }
];

export const drumNoteMap = {
  K: { pitch: "C2", duration: "8n" },
  S: { duration: "16n" },
  H: { pitch: "C5", duration: "32n" },
  P: { pitch: "G1", duration: "8n" },
  C: { pitch: "E6", duration: "8n" }, // Using Bell sound (J) for Clap
  J: { pitch: "E6", duration: "8n" }
};

export const placeholderUsers = [
  "SIDHEAD",
  "PIXELFOX",
  "GLITCHGRL",
  "VCTRBOY",
  "BYTEQUEEN",
  "LOFIKING",
  "ARPMAGE",
  "DATAWAVE",
  "NEONFROG",
  "CLOUDRIDER"
];
