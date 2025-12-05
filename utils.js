import { 
    FRAME_WIDTH,
    NOTE_NAMES, 
    TRACK_DEFAULT_OCTAVE, 
    DEFAULT_NOTE_INDEX, 
    MAX_NOTE_INDEX, 
    DEFAULT_STEP_DECAY 
} from "./constants.js";

export function buildBorderLine(width = FRAME_WIDTH - 6) {
  return "+" + "-".repeat(width) + "+";
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampNoteIndex(value) {
  return clamp(Number.isFinite(value) ? value : DEFAULT_NOTE_INDEX, 0, MAX_NOTE_INDEX);
}

export function noteIndexToLabel(noteIndex) {
  const safe = clampNoteIndex(noteIndex);
  const name = NOTE_NAMES[safe % NOTE_NAMES.length];
  const octave = Math.floor(safe / NOTE_NAMES.length);
  return `${name}${octave}`;
}

export function getStepSemitone(step, channelKey) {
  const base = typeof step?.note === "number" ? step.note : getTrackDefaultNoteIndex(channelKey);
  return base % NOTE_NAMES.length;
}

export function getStepOctave(step, channelKey) {
  const base = typeof step?.note === "number" ? step.note : getTrackDefaultNoteIndex(channelKey);
  return Math.floor(base / NOTE_NAMES.length);
}

export function getTrackDefaultOctave(channelKey) {
  return TRACK_DEFAULT_OCTAVE[channelKey] ?? 1;
}

export function getTrackDefaultNoteIndex(channelKey) {
  return getTrackDefaultOctave(channelKey) * NOTE_NAMES.length;
}

export function velocityToLevel(value) {
  if (value >= 6) return 2;
  if (value > 0) return 1;
  return 0;
}

export function velocityToGain(value) {
  if (value <= 0) return 0;
  return 0.25 + (value / 9) * 0.7;
}

export function decayToSeconds(value, maxSeconds = 6.0) {
  const ratio = clamp((value ?? DEFAULT_STEP_DECAY) / 10, 0, 1);
  // Short decay: very snappy (0.05s). Long decay: long fade (maxSeconds).
  // Using an exponential-like curve for better feel
  return 0.05 + Math.pow(ratio, 2) * maxSeconds;
}

export function shadowBlock(label, width) {
  const pad = Math.max(width - label.length - 4, 4);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `:${"".padEnd(left, "+")} ${label} ${"".padEnd(right, "+")}:`;
}

export function directionToCode(direction) {
  if (direction <= -1) return "0";
  if (direction >= 1) return "2";
  return "1";
}

export function codeToDirection(code) {
  if (code === "0") return -1;
  if (code === "2") return 1;
  return 0;
}

export function generatePetsciiArt(trackKey) {
    // Random "weird" symbols instead of letters
    const symbols = ["░", "▒", "▓", "█", "▄", "▀", "■", "▌", "▐", "▖", "▗", "▘", "▙", "▚", "▛", "▜", "▝", "▞", "▟"];
    let art = "";
    // Generate 5 random symbols
    for (let i = 0; i < 5; i++) {
        art += symbols[Math.floor(Math.random() * symbols.length)];
    }
    return art;
}
