import { scaleOptions, placeholderUsers } from "./constants.js";
import { buildDefaultPatternSet } from "./patterns.js";

const initialPatterns = [
    buildDefaultPatternSet(),
    buildDefaultPatternSet(),
    buildDefaultPatternSet(),
    buildDefaultPatternSet()
];

export const refs = {
  drumBody: null,
  transportBody: null,
  synthBody: null,
  visualizerBody: null,
  introField: null,
  voiceField: null,
  menuField: null,
  helpBody: null,
  helpPanel: null,
  overlay: null,
  overlayList: null,
  stepButtons: {
    drums: {},
    synth: {}
  },
  knobs: {},
  knobValues: {}
};

export const focusGrid = {
  rows: []
};

export const state = {
  tempo: 120,
  swing: 0,
  scaleId: scaleOptions[0].id,
  currentUser: placeholderUsers[0],
  currentSlot: 0,
  synthWaveform: "sawtooth",
  trackName: "DEMO SONG",
  trackNameEdited: false,
  keyboardOctave: 3,
  activeKnob: null,
  focusedStep: null,
  pattern: initialPatterns[0],
  lastSaveLength: null,
  knobDrag: null,
  suppressKnobClick: false,
  lastFocus: null,
  activeTrack: null,
  copyMode: { active: false, sourceIdx: null },
  patterns: initialPatterns, // Will hold 4 patterns
  patternEnable: [true, false, false, false],
  editingPatternIdx: 0,
  visualizerMode: 5
};

export const audio = {
  ready: false,
  master: null,
  analyser: null,
  channelGains: {},
  drumVoices: {},
  synthVoices: {
    bass: null,
    lead: null
  },
  arpSynth: null,
  playingPatternIdx: 0,
  nextPatternIdx: null,
  stepLoop: null,
  arpLoop: null,
  currentStep: 0,
  playing: false,
  bootstrapPromise: null,
  arpState: {
    active: false,
    notes: [],
    index: 0,
    remainingBursts: 0,
    velocity: 0.8
  }
};
