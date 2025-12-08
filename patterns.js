import {
  DRUM_STEPS, STEPS_PER_BAR, SYNTH_STEPS, DEFAULT_STEP_DECAY, DIRECTION_VALUES,
  defaultArpChord, drumLanes, synthTracks
} from "./constants.js";

import {
  getTrackDefaultNoteIndex, clampNoteIndex, clamp, velocityToLevel
} from "./utils.js";

export function createEmptyDrumPattern() {
  const pattern = {};
  drumLanes.forEach((lane) => {
    pattern[lane.key] = Array(DRUM_STEPS).fill(0);
  });
  return pattern;
}

export function createInitialDrumPattern() {
  const pattern = createEmptyDrumPattern();
  for (let i = 0; i < DRUM_STEPS; i += STEPS_PER_BAR) {
    pattern.kick[i] = 2;
    pattern.kick[(i + 4) % DRUM_STEPS] = 1;
  }
  for (let i = 4; i < DRUM_STEPS; i += STEPS_PER_BAR) {
    pattern.snare[i] = 2;
  }
  for (let i = 0; i < DRUM_STEPS; i += 1) {
    if (pattern.hat[i] === 0) {
      pattern.hat[i] = i % 2 === 0 ? 1 : 0;
    }
  }
  return pattern;
}

export function buildDefaultPatternSet() {
  const pattern = {
    drums: createInitialDrumPattern(),
    channelSettings: {
        drums: { muted: false, delayTime: "4n", delayFeedback: 0 },
        bass: { wave: "square", decay: 6 },
        lead: { wave: "sawtooth", decay: 8 },
        arp: { wave: "square", decay: 2 }
    }
  };
  synthTracks.forEach((track) => {
    pattern[track.key] = createPatternForTrack(track.key);
  });
  return pattern;
}

export function createPatternForTrack(channelKey) {
  return isArpChannel(channelKey) ? createArpPattern(channelKey) : createLinearSynthPattern(channelKey);
}

export function createLinearSynthPattern(channelKey) {
  const defaultNote = getTrackDefaultNoteIndex(channelKey);
  return Array(SYNTH_STEPS)
    .fill(null)
    .map(() => ({
      note: defaultNote,
      degree: defaultNote,
      velocity: 0,
      level: 0,
      direction: 0,
      decay: DEFAULT_STEP_DECAY
    }));
}

export function createArpPattern(channelKey) {
  const defaultNote = getTrackDefaultNoteIndex(channelKey);
  return Array(SYNTH_STEPS)
    .fill(null)
    .map(() => ({
      note: defaultNote,
      degree: defaultNote,
      velocity: 0,
      level: 0,
      chordId: defaultArpChord.id
    }));
}

export function cloneLinearPattern(trackArray, channelKey) {
  if (!Array.isArray(trackArray)) {
    return createLinearSynthPattern(channelKey);
  }
  return trackArray.map((step = {}) => {
    const note = clampNoteIndex(
      typeof step.note === "number"
        ? step.note
        : typeof step.degree === "number"
          ? step.degree
          : getTrackDefaultNoteIndex(channelKey)
    );
    const velocity = clamp(typeof step.velocity === "number" ? step.velocity : step.level || 0, 0, 9);
    const decay = clamp(typeof step.decay === "number" ? step.decay : DEFAULT_STEP_DECAY, 0, 9);
    const direction = DIRECTION_VALUES.includes(step.direction) ? step.direction : 0;
    return {
      note,
      degree: note,
      velocity,
      level: velocityToLevel(velocity),
      direction,
      decay
    };
  });
}

export function cloneArpPattern(trackArray, channelKey) {
  if (!Array.isArray(trackArray)) {
    return createArpPattern(channelKey);
  }
  return trackArray.map((step = {}) => {
    const note = clampNoteIndex(
      typeof step.note === "number"
        ? step.note
        : typeof step.degree === "number"
          ? step.degree
          : getTrackDefaultNoteIndex(channelKey)
    );
    const velocity = clamp(typeof step.velocity === "number" ? step.velocity : step.level || 0, 0, 9);
    return {
      note,
      degree: note,
      velocity,
      level: velocityToLevel(velocity),
      chordId: step.chordId || defaultArpChord.id
    };
  });
}

export function isArpChannel(channelKey) {
  return synthTracks.find((track) => track.key === channelKey)?.mode === "arp";
}

export function clonePattern(pattern) {
  const clone = {
    drums: cloneDrumPattern(pattern?.drums),
    channelSettings: pattern?.channelSettings ? JSON.parse(JSON.stringify(pattern.channelSettings)) : undefined
  };
  synthTracks.forEach((track) => {
    clone[track.key] = cloneTrackPattern(track.key, pattern?.[track.key]);
  });
  return clone;
}

export function cloneDrumPattern(drums) {
  const clone = {};
  drumLanes.forEach((lane) => {
    clone[lane.key] = Array.isArray(drums?.[lane.key]) ? [...drums[lane.key]] : Array(DRUM_STEPS).fill(0);
  });
  return clone;
}

export function cloneTrackPattern(channelKey, trackArray) {
  if (isArpChannel(channelKey)) {
    return cloneArpPattern(trackArray, channelKey);
  }
  return cloneLinearPattern(trackArray, channelKey);
}
