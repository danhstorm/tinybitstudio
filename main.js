import {
  FRAME_WIDTH, STEPS_PER_BAR, DRUM_BARS, SYNTH_BARS, DRUM_STEPS, SYNTH_STEPS,
  STEP_DURATION, ARP_DURATION, SCALE_SPREAD, LEVEL_SYMBOLS, DIRECTION_SYMBOLS,
  DIRECTION_VALUES, CHANNEL_DEFAULT_GAIN, TRACK_DEFAULT_OCTAVE, TRACK_MAX_DECAY,
  DEFAULT_STEP_DECAY, DEFAULT_BASS_DECAY, DEFAULT_LEAD_DECAY, DEFAULT_ARP_DECAY,
  NOTE_NAMES, NOTE_RANGE_OCTAVES, MAX_NOTE_INDEX, DEFAULT_NOTE_INDEX,
  DEFAULT_STEP_VELOCITY, KNOB_DRAG_STEP_PX, VISUALIZER_WIDTH, VISUALIZER_HEIGHT,
  KEYBOARD_NOTE_MAP, WAVE_TYPES, arpChords, defaultArpChord, arpChordById,
  arpChordByCode, drumLanes, synthTracks, scaleOptions, drumNoteMap, placeholderUsers
} from "./constants.js";

import {
  clamp, clampNoteIndex, noteIndexToLabel, getStepSemitone, getStepOctave,
  getTrackDefaultOctave, getTrackDefaultNoteIndex, velocityToLevel, velocityToGain,
  decayToSeconds, shadowBlock, directionToCode, codeToDirection, generatePetsciiArt,
  buildBorderLine
} from "./utils.js";

import { state, audio, refs, focusGrid } from "./state.js";
import { db } from "./db.js";
import { demoSongs } from "./demos.js";
import { 
  buildDefaultPatternSet, createPatternForTrack, createLinearSynthPattern, 
  createArpPattern, createInitialDrumPattern, createEmptyDrumPattern, 
  clonePattern, isArpChannel
} from "./patterns.js";

import { loadSceneData } from "./storage.js";

// SUPABASE CONFIG (Removed for local server)
// const SUPABASE_URL = "YOUR_SUPABASE_URL";
// const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY";
// --- History System ---
const history = {
  past: [],
  future: [],
  max: 50
};

function pushToHistory() {
  // Snapshot current state
  const snapshot = {
    patterns: JSON.parse(JSON.stringify(state.patterns)),
    patternEnable: [...state.patternEnable],
    tempo: state.tempo,
    swing: state.swing,
    trackName: state.trackName,
    currentUser: state.currentUser,
    editingPatternIdx: state.editingPatternIdx,
    channelSettings: JSON.parse(JSON.stringify(state.pattern.channelSettings || {})) // Ensure deep copy of settings
  };
  
  history.past.push(snapshot);
  if (history.past.length > history.max) {
    history.past.shift();
  }
  history.future = []; // Clear redo stack on new action
}

function undo() {
  if (history.past.length === 0) return;
  
  // Snapshot current state to future
  const currentSnapshot = {
    patterns: JSON.parse(JSON.stringify(state.patterns)),
    patternEnable: [...state.patternEnable],
    tempo: state.tempo,
    swing: state.swing,
    trackName: state.trackName,
    currentUser: state.currentUser,
    editingPatternIdx: state.editingPatternIdx,
    channelSettings: JSON.parse(JSON.stringify(state.pattern.channelSettings || {}))
  };
  history.future.push(currentSnapshot);
  
  const previous = history.past.pop();
  restoreState(previous);
}

function redo() {
  if (history.future.length === 0) return;
  
  // Snapshot current state to past
  const currentSnapshot = {
    patterns: JSON.parse(JSON.stringify(state.patterns)),
    patternEnable: [...state.patternEnable],
    tempo: state.tempo,
    swing: state.swing,
    trackName: state.trackName,
    currentUser: state.currentUser,
    editingPatternIdx: state.editingPatternIdx,
    channelSettings: JSON.parse(JSON.stringify(state.pattern.channelSettings || {}))
  };
  history.past.push(currentSnapshot);
  
  const next = history.future.pop();
  restoreState(next);
}

function restoreState(snapshot) {
  state.patterns = snapshot.patterns;
  state.patternEnable = snapshot.patternEnable;
  state.tempo = snapshot.tempo;
  state.swing = snapshot.swing;
  state.trackName = snapshot.trackName;
  state.currentUser = snapshot.currentUser;
  state.editingPatternIdx = snapshot.editingPatternIdx;
  
  // Update reference to current pattern
  state.pattern = state.patterns[state.editingPatternIdx];
  
  // Restore channel settings if needed (though they are inside patterns)
  // But we might have modified them in place?
  // state.patterns contains the settings.
  
  // Update Audio Engine
  Tone.Transport.bpm.value = state.tempo;
  Tone.Transport.swing = state.swing / 100;
  applyWaveformToVoices(state.pattern.channelSettings);
  
  // Update UI
  renderTransport();
  renderDrumBox();
  renderSynthStack();
  
  // Update Pattern Controls (Grid at bottom)
  const oldControls = document.getElementById("pattern-controls");
  if (oldControls) {
      const newControls = renderPatternControls();
      oldControls.replaceWith(newControls);
  }
  
  notifyStateChange();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    cacheElements();
    buildFrameLines();
    buildPanelBorders();
    renderIntro();
    renderTransport();
    renderVoiceField();
    renderDrumBox();
    renderSynthStack();
    renderArtistMenu();
    renderVisualizerControls();
    initVisualizerBody();
    initGlyphDivider();
    bindGlobalKeys();
    startVisualizerTicker();
    
    const hasSavedData = loadUserScene(state.currentUser, { silent: true });
    if (!hasSavedData) {
        loadDemoSong(1);
    }
    
    // Initialize focus on the first drum step
    if (!state.focusedStep) {
      setFocusedStep("drums", 0, "kick");
    }
    
    // Ensure focus is visually applied after rendering
    const firstBtn = refs.stepButtons.drums.kick?.[0];
    if (firstBtn) {
        firstBtn.classList.add("focused-step");
        firstBtn.focus();
    }
    
    setupGlobalFilters();
    initResponsiveViewport();
    
    // Global click listener for closing overlays
    document.addEventListener("click", (e) => {
        // Check if Load Overlay is open
        if (isOverlayVisible()) {
            // If click is outside load-panel and not on the load button
            if (!refs.loadPanel.contains(e.target) && e.target.id !== "transport-load-btn" && !e.target.closest("#transport-load-btn")) {
                closeSlotOverlay();
            }
        }
        
        // Check if Help Panel is open
        if (refs.helpPanel && refs.helpPanel.style.display !== "none") {
            // If click is outside help-panel and not on the help button
            if (!refs.helpPanel.contains(e.target) && e.target.id !== "transport-help-btn" && !e.target.closest("#transport-help-btn")) {
                toggleHelp();
            }
        }
    });
    
  } catch (e) {
    console.error("Fatal Initialization Error:", e);
    document.body.innerHTML += `<div style="position:fixed;top:0;left:0;background:red;color:white;z-index:9999;padding:1rem;">
        FATAL ERROR: ${e.message}<br>
        Check console for details.
    </div>`;
  }
});

function setupGlobalFilters() {
    // Inject SVG Filter for Global Ghosting
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.pointerEvents = "none";
    
    const filter = document.createElementNS(svgNS, "filter");
    filter.id = "ghost-filter";
    filter.setAttribute("x", "-20%");
    filter.setAttribute("y", "-20%");
    filter.setAttribute("width", "140%");
    filter.setAttribute("height", "140%");
    
    // 1. Blur the source slightly
    const blur = document.createElementNS(svgNS, "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "1.2"); // Increased blur
    blur.setAttribute("result", "blur");
    
    // 2. Offset the blurred copy
    const offset = document.createElementNS(svgNS, "feOffset");
    offset.setAttribute("in", "blur");
    offset.setAttribute("dx", "6"); // More to the right
    offset.setAttribute("dy", "-3"); // Moved upwards
    offset.setAttribute("result", "offset");
    
    // 3. Reduce opacity (faint)
    const colorMatrix = document.createElementNS(svgNS, "feColorMatrix");
    colorMatrix.setAttribute("in", "offset");
    colorMatrix.setAttribute("type", "matrix");
    // R G B A (Keep colors, reduce Alpha to 0.10)
    colorMatrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.10 0");
    colorMatrix.setAttribute("result", "faint");
    
    // 4. Blend with Screen (Lighten) to avoid dark doubles
    const blend = document.createElementNS(svgNS, "feBlend");
    blend.setAttribute("in", "SourceGraphic");
    blend.setAttribute("in2", "faint");
    blend.setAttribute("mode", "screen");
    
    filter.append(blur, offset, colorMatrix, blend);
    svg.append(filter);
    document.body.append(svg);
}

function cacheElements() {
  refs.drumBody = document.getElementById("drum-body");
  refs.transportBody = document.getElementById("transport-body");
  refs.synthBody = document.getElementById("synth-body");
  refs.visualizerBody = document.getElementById("visualizer-body");
  refs.introField = document.getElementById("intro-field");
  refs.voiceField = document.getElementById("voice-field");
  refs.menuField = document.getElementById("menu-field");
  refs.visualizerControls = document.getElementById("visualizer-controls");
  refs.helpBody = document.getElementById("help-body");
  refs.helpPanel = document.getElementById("help-panel");
  refs.loadPanel = document.getElementById("load-panel");
  refs.loadList = document.getElementById("load-list");
  const loadClose = document.getElementById("load-close");
  loadClose?.addEventListener("click", closeSlotOverlay);
}

function buildFrameLines() {
  // Removed as requested
  // const line = "+" + "=".repeat(FRAME_WIDTH) + "+";
  // document.getElementById("frame-top").textContent = line;
  // document.getElementById("frame-bottom").textContent = line;
}

function buildPanelBorders() {
  document.querySelectorAll(".panel-border").forEach((el) => {
    el.textContent = buildBorderLine();
  });
}


function renderIntro() {
  if (!refs.introField) return;
  refs.introField.textContent = "TINY BIT STUDIO";
  refs.introField.appendChild(createDivider());
}

function renderTransport() {
  if (!refs.transportBody) return;
  
  try {
    refs.transportBody.innerHTML = "";
  
    // Row 1: Title
    const titleRow = document.createElement("div");
    titleRow.className = "control-row title-row";
    titleRow.style.flexDirection = "column";
    titleRow.style.alignItems = "flex-start";
    titleRow.style.gap = "0.25rem";
    titleRow.style.marginBottom = "0.5rem";

    // Helper to create labeled input row
    const createInputRow = (label, value, onChange) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "0.5ch";
        row.style.fontSize = "0.8rem";
        row.style.width = "100%"; // Ensure row takes full width
        row.style.paddingRight = "0"; // Reset padding
        
        const labelSpan = document.createElement("span");
        // Use pre-wrap to preserve spaces for alignment
        labelSpan.style.whiteSpace = "pre";
        labelSpan.textContent = label;
        labelSpan.style.color = "var(--c64-cyan)"; 
        
        const bracketLeft = document.createElement("span");
        bracketLeft.textContent = "[";
        bracketLeft.style.color = "var(--c64-cyan)";
        
        const input = document.createElement("input");
        input.type = "text";
        input.value = value;
        input.maxLength = 24;
        input.className = "bare-input";
        input.style.flex = "1"; // Take available space
        input.style.minWidth = "0"; // Allow shrinking
        input.style.textAlign = "left";
        input.style.color = "var(--c64-orange)"; 
        input.addEventListener("input", (e) => {
            onChange(e.target.value.toUpperCase());
        });
        
        const bracketRight = document.createElement("span");
        bracketRight.textContent = "]";
        bracketRight.style.color = "var(--c64-cyan)";
        
        row.append(labelSpan, bracketLeft, input, bracketRight);
        return row;
        
        row.append(labelSpan, bracketLeft, input, bracketRight);
        return row;
    };

    // Artist Input
    const artistRow = createInputRow("ARTIST:", state.currentUser || "UNKNOWN", (val) => {
        state.currentUser = val;
    });
    
    // Song Input (Aligned)
    const songRow = createInputRow("TITLE: ", state.trackName, (val) => {
        state.trackName = val;
    });

    titleRow.append(artistRow, songRow);

    // Row 2: Save/Load/Help/Reset
    const fileRow = document.createElement("div");
    fileRow.className = "control-row";
    fileRow.style.flexWrap = "wrap"; // Allow wrapping for export button
    
    const saveBtn = createButton("[SAVE]", "transport-btn", (e) => handleSave(e.target));
    saveBtn.style.color = "var(--c64-purple)";
    
    const loadBtn = createButton("[LOAD]", "transport-btn", () => openSlotOverlay());
    loadBtn.id = "transport-load-btn";
    loadBtn.style.color = "var(--c64-purple)";
    
    const helpBtn = createButton("[HELP]", "transport-btn", () => toggleHelp());
    helpBtn.id = "transport-help-btn";
    helpBtn.style.color = "var(--c64-purple)";
    
    const resetBtn = createButton("[CLEAR]", "transport-btn", (e) => {
      const btn = e.target;
      e.stopPropagation(); // Prevent bubbling
      
      if (btn.textContent === "[SURE?]") {
          resetScene();
          btn.textContent = "[CLEAR]";
          btn.style.color = "var(--c64-purple)";
          // Remove global listener if it exists
          if (btn._cancelListener) {
              window.removeEventListener("click", btn._cancelListener);
              btn._cancelListener = null;
          }
      } else {
          const originalText = btn.textContent;
          btn.textContent = "[SURE?]";
          btn.style.color = "var(--c64-green)";
          
          // Add global click listener to cancel
          const cancelListener = (clickEvent) => {
              if (clickEvent.target !== btn) {
                  btn.textContent = originalText;
                  btn.style.color = "var(--c64-purple)";
                  window.removeEventListener("click", cancelListener);
                  btn._cancelListener = null;
              }
          };
          
          // Delay adding listener slightly to avoid immediate trigger
          setTimeout(() => {
              window.addEventListener("click", cancelListener);
              btn._cancelListener = cancelListener;
          }, 0);
      }
    });
    resetBtn.style.color = "var(--c64-purple)";
    
    const exportBtn = createButton("[EXPORT WAV]", "transport-btn", () => handleExportMp3());
    exportBtn.style.color = "var(--c64-purple)"; 
    
    fileRow.append(saveBtn, loadBtn, helpBtn, resetBtn, exportBtn);
    refs.transportBody.append(fileRow);

    // Row 3: Demo Buttons
    const demoRow = document.createElement("div");
    demoRow.className = "demo-btn-row";
    demoRow.style.alignItems = "center";

    const demoLabel = document.createElement("span");
    demoLabel.textContent = "DEMOS:";
    demoLabel.style.color = "var(--c64-cyan)";
    demoLabel.style.fontSize = "0.8rem";
    demoLabel.style.marginRight = "0.5rem";
    demoRow.append(demoLabel);
    
    ["1", "2", "3", "4"].forEach((label, idx) => {
        const btn = document.createElement("button");
        btn.className = "demo-btn-box";
        btn.textContent = label;
        btn.addEventListener("click", () => loadDemoSong(idx + 1));
        demoRow.append(btn);
    });
    
    // refs.transportBody.append(demoHeader, demoRow); // Removed separate header append

    // Row 3: Transport Controls
    const transportRow = document.createElement("div");
    transportRow.className = "control-row transport-row";
    
    const playAllBtn = createButton("[PLAY SONG]", "transport-btn boxed-btn", () => {
      handleStop();
      handlePlay('song');
    });
    playAllBtn.id = "transport-play-all-btn";

    const playBtn = createButton("[PLAY]", "transport-btn boxed-btn", () => {
      handleStop();
      handlePlay('pattern');
    });
    playBtn.id = "transport-play-btn"; 
    
    const stopBtn = createButton("STOP", "transport-btn boxed-btn", () => handleStop());
    stopBtn.id = "transport-stop-btn";
    transportRow.append(playAllBtn, playBtn, stopBtn);

    // Row 4: Tempo
    const tempoRow = document.createElement("div");
    tempoRow.className = "control-row transport-row";
    const tempoLabel = document.createElement("span");
    tempoLabel.textContent = "TEMPO";
    tempoLabel.style.fontSize = "0.7rem";
    tempoRow.append(tempoLabel);
  
    const tempoVal = document.createElement("span");
    tempoVal.id = "tempo-readout";
    tempoVal.textContent = ` [${state.tempo}] `;
    tempoVal.style.color = "var(--c64-orange)";
  
    const decTempo = createButton("[-]", "transport-btn", () => adjustTempo(-5));
    decTempo.style.color = "var(--c64-purple)";
    const incTempo = createButton("[+]", "transport-btn", () => adjustTempo(5));
    incTempo.style.color = "var(--c64-purple)";
  
    tempoRow.append(decTempo, tempoVal, incTempo);

    // Row 5: Swing
    const swingRow = document.createElement("div");
    swingRow.className = "control-row transport-row";
    const swingLabel = document.createElement("span");
    swingLabel.textContent = "SWING";
    swingLabel.style.fontSize = "0.7rem";
    swingRow.append(swingLabel);
  
    const swingVal = document.createElement("span");
    swingVal.id = "swing-readout";
    swingVal.textContent = state.swing < 10 ? ` [0${state.swing}%] ` : ` [${state.swing}%] `;
    swingVal.style.color = "var(--c64-orange)";
  
    const decSwing = createButton("[-]", "transport-btn", () => {
      adjustSwing(-5);
    });
    decSwing.style.color = "var(--c64-purple)";
    
    const incSwing = createButton("[+]", "transport-btn", () => {
      adjustSwing(5);
    });
    incSwing.style.color = "var(--c64-purple)";
  
    swingRow.append(decSwing, swingVal, incSwing);

    // No divider between Tempo and Swing to save space
    // Removed divider before demoRow to save space
    refs.transportBody.append(titleRow, createDivider(), fileRow, createDivider(), transportRow, createDivider(), tempoRow, swingRow, createDivider(), demoRow, createDivider());
  } catch (e) {
    console.error("Render Transport Error:", e);
    refs.transportBody.innerHTML += `<div style="color:red">Transport Error: ${e.message}</div>`;
  }
}

function loadDemoSong(index) {
    const songData = demoSongs[index];
    if (!songData) {
        console.log(`Demo ${index} not implemented yet.`);
        alert(`Demo ${index} coming soon!`);
        return;
    }

    resetScene();
    
    // Apply data
    if (songData.patterns && Array.isArray(songData.patterns)) {
        songData.patterns.forEach((pat, i) => {
            if (i < 4) {
                state.patterns[i] = JSON.parse(JSON.stringify(pat));
            }
        });
    }

    if (songData.channelSettings) {
        state.channelSettings = JSON.parse(JSON.stringify(songData.channelSettings));
    }

    state.tempo = songData.tempo || 120;
    state.swing = songData.swing || 0;
    state.trackName = songData.trackName || `DEMO SONG ${index}`;
    state.currentUser = songData.currentUser || "SYSTEM";
    state.scaleId = songData.scaleId || "cmaj";
    state.visualizerMode = songData.visualizerMode || 5;
    
    if (songData.patternEnable) {
        state.patternEnable = [...songData.patternEnable];
    }

    state.pattern = state.patterns[state.editingPatternIdx];

    // Update Audio Engine
    Tone.Transport.bpm.value = state.tempo;
    Tone.Transport.swing = state.swing / 100;

    renderTransport();
    renderDrumBox();
    renderSynthStack();
    renderVisualizerControls();
    if (refs.visualizerBody) {
        refs.visualizerBody.className = `viz-mode-${state.visualizerMode}`;
    }
    
    const oldControls = document.getElementById("pattern-controls");
    if (oldControls) {
        const newControls = renderPatternControls();
        oldControls.replaceWith(newControls);
    }
    applyWaveformToVoices(state.patterns[0].channelSettings);
}

function renderVoiceField() {
  if (!refs.voiceField) return;
  refs.voiceField.innerHTML = "";
}

function setSynthWaveform(waveId) {
  if (!WAVE_TYPES.some((wave) => wave.id === waveId) || state.synthWaveform === waveId) return;
  pushToHistory();
  state.synthWaveform = waveId;
  renderVoiceField();
  applyWaveformToVoices();
  updateKnobDisplays();
}

function cycleWaveform(delta) {
  const currentIndex = WAVE_TYPES.findIndex((wave) => wave.id === state.synthWaveform);
  const nextIndex = (currentIndex + delta + WAVE_TYPES.length) % WAVE_TYPES.length;
  setSynthWaveform(WAVE_TYPES[nextIndex].id);
}

function setActiveTrack(trackKey) {
  if (state.activeTrack === trackKey) return;
  state.activeTrack = trackKey;
  
  // Update Drum Body
  if (refs.drumBody) {
      if (trackKey === "drums") refs.drumBody.classList.add("active-section");
      else refs.drumBody.classList.remove("active-section");
      
      // Update Header Title
      const header = refs.drumBody.querySelector(".drum-header-row span");
      if (header) {
          if (trackKey === "drums") header.classList.add("active-track-title");
          else header.classList.remove("active-track-title");
      }
  }
  
  // Update Synth Tracks
  if (refs.synthBody) {
      const tracks = ["bass", "lead", "arp"];
      tracks.forEach(key => {
          const wrapper = refs.synthBody.querySelector(`.track-box-${key}`);
          if (wrapper) {
              if (trackKey === key) wrapper.classList.add("active-section");
              else wrapper.classList.remove("active-section");
              
              const label = wrapper.querySelector(".track-label");
              if (label) {
                  if (trackKey === key) label.classList.add("active-track-title");
                  else label.classList.remove("active-track-title");
              }
          }
      });
      
      // Update Synth Controls (Top Module)
      const controls = document.getElementById("synth-controls");
      if (controls) {
          if (tracks.includes(trackKey)) {
              controls.classList.add("active-section");
          } else {
              controls.classList.remove("active-section");
          }
      }
  }
  
  updateKnobDisplays();
}

function renderDrumBox() {
  if (!refs.drumBody) return;
  
  try {
    // Ensure drum pattern exists
    if (!state.pattern.drums) {
        state.pattern.drums = createInitialDrumPattern();
    }
    
    // Ensure drum settings exist
    if (!state.pattern.channelSettings) state.pattern.channelSettings = {};
    if (!state.pattern.channelSettings.drums) state.pattern.channelSettings.drums = { muted: false };

    refs.drumBody.innerHTML = "";
    
    // Clear stored buttons
    refs.stepButtons.drums = {};
    
    const fragment = document.createDocumentFragment();
  
    // Make the drum body clickable to activate
    refs.drumBody.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      setActiveTrack("drums");
    });
  
    if (state.activeTrack === "drums") {
      refs.drumBody.classList.add("active-section");
    } else {
      refs.drumBody.classList.remove("active-section");
    }
  
    const headerRow = document.createElement("div");
    headerRow.className = "drum-header-row";
    const headerLabel = document.createElement("span");
    headerLabel.textContent = "DRUMMER BOY";
    if (state.activeTrack === "drums") {
      headerLabel.classList.add("active-track-title");
    }
    headerLabel.style.cursor = "pointer";
    headerLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveTrack("drums");
      // audio.currentStep = 0; // Removed to prevent playhead reset
      // updatePlayheadUI();
      setFocusedStep("drums", 0, "kick");
      const firstBtn = refs.stepButtons.drums.kick?.[0];
      if (firstBtn) {
          firstBtn.focus();
      }
    });
  
    headerRow.append(headerLabel);
    
    // Drum Mute Button
    const muteBtn = document.createElement("button");
    muteBtn.className = "transport-btn";
    muteBtn.style.marginLeft = "0.5rem";
    muteBtn.style.fontSize = "0.7rem";
    
    const isMuted = state.pattern.channelSettings.drums.muted;
    muteBtn.textContent = "[MUTE]";
    muteBtn.style.color = isMuted ? "var(--c64-green)" : "var(--c64-purple)";
    
    muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextMute = !state.pattern.channelSettings.drums.muted;
        state.pattern.channelSettings.drums.muted = nextMute;
        muteBtn.style.color = nextMute ? "var(--c64-green)" : "var(--c64-purple)";
    });
    
    headerRow.append(muteBtn);

    // Drum Delay Controls
    const delayContainer = document.createElement("div");
    delayContainer.style.display = "flex";
    delayContainer.style.gap = "0.5rem";
    delayContainer.style.alignItems = "center";
    delayContainer.style.marginLeft = "auto"; // Push to right
    delayContainer.style.marginRight = "0.5rem";

    // Delay Time Selector (Cycler)
    const delayTimeBtn = document.createElement("button");
    delayTimeBtn.className = "transport-btn";
    delayTimeBtn.style.fontSize = "0.7rem";
    delayTimeBtn.style.color = "var(--c64-purple)";
    
    const delayOptions = [
        { label: "1/4", value: "4n" },
        { label: "1/3", value: "2t" },
        { label: "3/8", value: "4n." },
        { label: "1/2", value: "2n" }
    ];

    // Ensure default is valid
    if (!state.pattern.channelSettings.drums.delayTime) {
        state.pattern.channelSettings.drums.delayTime = "2t"; // Default to 1/3
    }

    const updateDelayBtn = () => {
        const currentVal = state.pattern.channelSettings.drums.delayTime;
        const opt = delayOptions.find(o => o.value === currentVal) || delayOptions[1];
        delayTimeBtn.textContent = `[${opt.label}]`;
    };
    updateDelayBtn();

    delayTimeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentVal = state.pattern.channelSettings.drums.delayTime;
        const currentIdx = delayOptions.findIndex(o => o.value === currentVal);
        const nextIdx = (currentIdx + 1) % delayOptions.length;
        const nextVal = delayOptions[nextIdx].value;
        
        state.pattern.channelSettings.drums.delayTime = nextVal;
        if (audio.drumDelay) {
            audio.drumDelay.delayTime.value = nextVal;
        }
        updateDelayBtn();
    });

    // Delay Feedback Slider (labeled as DELAY)
    const delaySliderContainer = document.createElement("div");
    delaySliderContainer.style.display = "flex";
    delaySliderContainer.style.alignItems = "center";
    delaySliderContainer.style.gap = "0.25rem";

    const delayLabel = document.createElement("span");
    delayLabel.textContent = "DELAY:";
    delayLabel.style.fontSize = "0.7rem";
    delayLabel.style.color = "var(--c64-cyan)";

    const delaySlider = document.createElement("input");
    delaySlider.type = "range";
    delaySlider.min = "0";
    delaySlider.max = "0.2"; // Limit feedback
    delaySlider.step = "0.01";
    delaySlider.className = "track-slider"; // Use track-slider class
    delaySlider.value = state.pattern.channelSettings.drums.delayFeedback || 0;
    // Remove inline styles that conflict with class
    // delaySlider.style.width = "50px"; 
    // delaySlider.style.height = "4px";
    // delaySlider.style.accentColor = "var(--c64-purple)";

    delaySlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        state.pattern.channelSettings.drums.delayFeedback = val;
        if (audio.drumDelay) {
            audio.drumDelay.feedback.value = val;
            // Also control wet level to mix it in
            audio.drumDelay.wet.value = val > 0 ? 0.5 : 0; 
        }
    });

    // Prevent focus stealing
    delaySlider.addEventListener("change", () => {
        delaySlider.blur();
        focusStoredStepButton();
    });
    delaySlider.addEventListener("mouseup", () => {
        delaySlider.blur();
        focusStoredStepButton();
    });

    delaySliderContainer.append(delayLabel, delaySlider);
    delayContainer.append(delayTimeBtn, delaySliderContainer);
    headerRow.append(delayContainer);
    
    fragment.append(headerRow);

    drumLanes.forEach((lane) => {
      const row = document.createElement("div");
      row.className = "drum-row mono-line";
      const label = document.createElement("span");
      label.className = "drum-label";
      label.textContent = lane.label;
      label.style.cursor = "pointer";
      label.addEventListener("click", (e) => {
          e.stopPropagation();
          previewDrumLane(lane.key);
      });
      row.append(label);

      const grid = document.createElement("div");
      grid.className = "drum-grid";
      refs.stepButtons.drums[lane.key] = [];

      // Ensure lane exists
      if (!state.pattern.drums[lane.key]) {
          state.pattern.drums[lane.key] = Array(DRUM_STEPS).fill(0);
      }

      state.pattern.drums[lane.key].forEach((level, index) => {
        const btn = document.createElement("button");
        btn.className = "step-btn";
        if (state.focusedStep?.channel === "drums" && state.focusedStep?.lane === lane.key && state.focusedStep?.index === index) {
          btn.classList.add("focused-step");
        }
        btn.dataset.type = "drum";
        btn.dataset.lane = lane.key;
        btn.dataset.index = index.toString();
        btn.dataset.level = level.toString();
        btn.innerHTML = `<span class="btn-level">${LEVEL_SYMBOLS[level]}</span>`;
        btn.addEventListener("click", () => {
          setFocusedStep("drums", index, lane.key);
          cycleDrumLevel(lane.key, index);
        });
        // Remove focus listener to prevent browser focus from interfering with our custom focus
        btn.addEventListener("focus", () => rememberGridFocus(btn));
        refs.stepButtons.drums[lane.key].push(btn);
        grid.append(btn);

        if ((index + 1) % STEPS_PER_BAR === 0 && index !== DRUM_STEPS - 1) {
          const divider = document.createElement("span");
          divider.textContent = "|";
          grid.append(divider);
        }
      });

      row.append(grid);
      fragment.append(row);
    });
  
    refs.drumBody.append(fragment);
  
    // Rebuild focus grid after drums are rendered
    buildFocusGrid();
  } catch (e) {
    console.error("Render Drum Error:", e);
    refs.drumBody.innerHTML += `<div style="color:red">Drum Render Error: ${e.message}</div>`;
  }
}

function renderSynthStack() {
  if (!refs.synthBody) return;

  // Ensure channelSettings exists to prevent crashes with old state
  if (!state.pattern.channelSettings) {
    state.pattern.channelSettings = {
        bass: { muted: false, wave: "square", decay: DEFAULT_BASS_DECAY },
        lead: { muted: false, wave: "sawtooth", decay: DEFAULT_LEAD_DECAY },
        arp: { muted: false, decay: DEFAULT_ARP_DECAY }
    };
  }

  refs.synthBody.innerHTML = "";
  
  // Clear stored buttons to prevent memory leaks and ghost updates
  refs.stepButtons.synth = {
      bass: [],
      lead: [],
      arp: []
  };

  const fragment = document.createDocumentFragment();
  
  try {
    synthTracks.forEach((track) => {
    const wrapper = document.createElement("div");
    wrapper.className = `track-row track-box-${track.key}`;
    if (state.activeTrack === track.key) {
      wrapper.classList.add("active-section");
    }
    
    // Allow clicking the box to activate track
    wrapper.addEventListener("click", (e) => {
      // If clicking a button or slider, don't hijack
      if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
      setActiveTrack(track.key);
    });

    const header = document.createElement("div");
    header.className = "track-header";
    
    const labelSpan = document.createElement("span");
    labelSpan.className = "track-label";
    if (state.activeTrack === track.key) {
      labelSpan.classList.add("active-track-title");
    }
    labelSpan.textContent = track.label;
    labelSpan.style.cursor = "pointer";
    labelSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveTrack(track.key);
      audio.currentStep = 0;
      updatePlayheadUI();
      setFocusedStep(track.key, 0, null, track.mode === "arp" ? "note" : null);
      const firstBtn = refs.stepButtons.synth[track.key]?.[0];
      if (firstBtn) {
          firstBtn.focus();
      }
    });
    
    // Mute Button
    const muteBtn = document.createElement("button");
    muteBtn.className = "transport-btn";
    muteBtn.style.marginLeft = "0"; // Removed margin
    muteBtn.style.fontSize = "0.7rem";
    
    const isMuted = state.pattern.channelSettings[track.key]?.muted;
    muteBtn.textContent = "[MUTE]";
    muteBtn.style.color = isMuted ? "var(--c64-green)" : "var(--c64-purple)";
    
    muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!state.pattern.channelSettings[track.key]) state.pattern.channelSettings[track.key] = {};
        const nextMute = !state.pattern.channelSettings[track.key].muted;
        state.pattern.channelSettings[track.key].muted = nextMute;
        
        muteBtn.style.color = nextMute ? "var(--c64-green)" : "var(--c64-purple)";
        notifyStateChange();
    });
    
    const headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.append(labelSpan, muteBtn);

    // Waveform Selector (For all tracks including Arp)
    const waveGroup = document.createElement("div");
    waveGroup.className = "track-control-group";
    
    // Wave Label
    const waveLabel = document.createElement("span");
    waveLabel.textContent = "WAVE:";
    waveLabel.style.color = "var(--c64-cyan)";
    waveGroup.append(waveLabel);

    WAVE_TYPES.forEach(w => {
        const isSelected = state.pattern.channelSettings[track.key]?.wave === w.id;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "transport-btn";
        btn.style.color = "var(--c64-purple)";
        
        const waveColor = isSelected ? "var(--c64-green)" : "var(--c64-purple)";
        // Removed brackets and added fixed width for monospace alignment
        btn.innerHTML = `<span class="wave-symbol" style="color: ${waveColor};">${w.label}</span>`;

        btn.addEventListener("click", () => {
            if (!state.pattern.channelSettings[track.key]) state.pattern.channelSettings[track.key] = {};
            state.pattern.channelSettings[track.key].wave = w.id;
            
            if (state.editingPatternIdx === audio.playingPatternIdx) {
            applyWaveformToVoices(state.pattern.channelSettings);
            }
            
            // Update art
            const artEl = wrapper.querySelector(".track-art");
            if (artEl) artEl.textContent = generatePetsciiArt(track.key, state.pattern.channelSettings[track.key]);
            
            // Update button states manually
            const buttons = waveGroup.querySelectorAll("button");
            buttons.forEach((b, idx) => {
                const waveId = WAVE_TYPES[idx].id;
                const isNowSelected = waveId === w.id;
                const color = isNowSelected ? "var(--c64-green)" : "var(--c64-purple)";
                // Removed brackets and added fixed width for monospace alignment
                b.innerHTML = `<span class="wave-symbol" style="color: ${color};">${WAVE_TYPES[idx].label}</span>`;
            });
        });
        waveGroup.append(btn);
    });

    const decayGroup = document.createElement("div");
    decayGroup.className = "track-control-group";
    decayGroup.style.paddingRight = "1rem";
    
    const decayLabel = document.createElement("span");
    decayLabel.textContent = "DECAY:";
    
    const decaySlider = document.createElement("input");
    decaySlider.type = "range";
    decaySlider.min = "1";
    decaySlider.max = "10";
    decaySlider.step = "1";
    decaySlider.className = "track-slider";
    
    let defaultDecay = DEFAULT_STEP_DECAY;
    if (track.key === "bass") defaultDecay = DEFAULT_BASS_DECAY;
    else if (track.key === "lead") defaultDecay = DEFAULT_LEAD_DECAY;
    else if (track.key === "arp") defaultDecay = DEFAULT_ARP_DECAY;

    decaySlider.value = state.pattern.channelSettings[track.key]?.decay ?? defaultDecay;
    decaySlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        if (!state.pattern.channelSettings[track.key]) state.pattern.channelSettings[track.key] = {};
        state.pattern.channelSettings[track.key].decay = val;
        
        // Update art
        const artEl = wrapper.querySelector(".track-art");
        if (artEl) artEl.textContent = generatePetsciiArt(track.key, state.pattern.channelSettings[track.key]);
    });

    // Prevent focus stealing
    decaySlider.addEventListener("change", () => {
        decaySlider.blur();
        focusStoredStepButton();
    });
    decaySlider.addEventListener("mouseup", () => {
        decaySlider.blur();
        focusStoredStepButton();
    });
    
    decayGroup.append(decayLabel, decaySlider);

    header.append(headerLeft, waveGroup, decayGroup);
    
    // Art Row - Under the title/controls
    const bodyRow = document.createElement("div");
    bodyRow.className = "track-body-row";
    
    const artRow = document.createElement("div");
    artRow.className = "track-art";
    artRow.textContent = generatePetsciiArt(track.key, state.pattern.channelSettings[track.key]);

    const grid = document.createElement("div");
    grid.className = "step-grid";
    refs.stepButtons.synth[track.key] = [];

    if (track.key === "arp") {
        // Render Arp as two rows of buttons in the same grid column?
        // No, the grid is flex/grid layout.
        // We can make each "step" a container with two buttons.
        // But the grid layout expects buttons.
        // Let's change the grid to contain "step-col" divs, each containing two buttons.
        
        state.pattern[track.key].forEach((step, index) => {
            const col = document.createElement("div");
            col.style.display = "flex";
            col.style.flexDirection = "column";
            col.style.gap = "0"; // No gap between note and type
            
            // Note Button (Top)
            const btnNote = document.createElement("button");
            btnNote.className = "step-btn";
            btnNote.style.minHeight = "1.5rem"; // Standard height
            btnNote.dataset.type = "synth";
            btnNote.dataset.subtype = "note";
            btnNote.dataset.channel = track.key;
            btnNote.dataset.index = index.toString();
            
            if (state.focusedStep?.channel === track.key && state.focusedStep?.index === index && state.focusedStep?.subtype === "note") {
                btnNote.classList.add("focused-step");
            }
            
            // Type Button (Bottom)
            const btnType = document.createElement("button");
            btnType.className = "step-btn";
            btnType.style.minHeight = "1.5rem"; // Standard height
            btnType.dataset.type = "synth";
            btnType.dataset.subtype = "type";
            btnType.dataset.channel = track.key;
            btnType.dataset.index = index.toString();
            
            if (state.focusedStep?.channel === track.key && state.focusedStep?.index === index && state.focusedStep?.subtype === "type") {
                btnType.classList.add("focused-step");
            }
            
            renderArpButtons(btnNote, btnType, index);
            
            // Event Listeners
            btnNote.addEventListener("click", () => {
                const wasFocused = state.focusedStep?.channel === track.key && state.focusedStep?.index === index && state.focusedStep?.subtype === "note";
                setFocusedStep(track.key, index, null, "note");
                if (wasFocused) {
                    toggleSynthStep(track.key, index);
                }
            });
            btnNote.addEventListener("focus", () => rememberGridFocus(btnNote));
            
            btnType.addEventListener("click", () => {
                setFocusedStep(track.key, index, null, "type");
                toggleArpChordType(index);
            });
            btnType.addEventListener("focus", () => rememberGridFocus(btnType));
            
            // Store buttons. We need a way to access them by index.
            // refs.stepButtons.synth[track.key] is an array.
            // We can store an object { note: btn, type: btn } or just push both?
            // Existing code expects an array of buttons for playhead update.
            // Let's push an object with a custom interface or just push both and handle it?
            // updatePlayheadUI iterates and sets dataset.playhead.
            // If we push both, both get playhead. That's fine.
            refs.stepButtons.synth[track.key].push(btnNote, btnType);
            
            col.append(btnNote, btnType);
            grid.append(col);

            if ((index + 1) % STEPS_PER_BAR === 0 && index !== SYNTH_STEPS - 1) {
                const divider = document.createElement("div");
                divider.style.width = "1ch";
                divider.style.display = "flex";
                divider.style.flexDirection = "column";
                divider.style.alignItems = "center";
                divider.style.justifyContent = "center";
                divider.style.height = "100%";
                
                const line1 = document.createElement("span");
                line1.textContent = "|";
                const line2 = document.createElement("span");
                line2.textContent = "|";
                
                divider.append(line1, line2);
                grid.append(divider);
            }
        });
    } else {
        state.pattern[track.key].forEach((step, index) => {
          const btn = document.createElement("button");
          btn.className = "step-btn";
          if (state.focusedStep?.channel === track.key && state.focusedStep?.index === index) {
            btn.classList.add("focused-step");
          }
          btn.dataset.type = "synth";
          btn.dataset.channel = track.key;
          btn.dataset.index = index.toString();
          renderSynthButtonContent(btn, track.key, index);
          
          // Click handler with "Focus then Toggle" logic
          btn.addEventListener("click", (event) => {
              // Check focus state BEFORE updating it
              const wasFocused = state.focusedStep?.channel === track.key && state.focusedStep?.index === index;
              
              setFocusedStep(track.key, index);
              
              if (wasFocused) {
                  const pitchModifier = event.metaKey || event.ctrlKey;
                  const chordModifier = event.altKey;

                  if (pitchModifier) {
                    event.preventDefault();
                    const delta = event.shiftKey ? -1 : 1;
                    shiftStepNote(track.key, index, delta);
                  } else if (event.shiftKey) {
                    event.preventDefault();
                    const delta = chordModifier ? -1 : 1;
                    adjustSynthDirection(track.key, index, delta);
                  } else {
                    toggleSynthStep(track.key, index);
                  }
              }
              // We allow the event to bubble so the wrapper can handle setActiveTrack
          });
          btn.addEventListener("focus", () => rememberGridFocus(btn));
          refs.stepButtons.synth[track.key].push(btn);
          grid.append(btn);

          if ((index + 1) % STEPS_PER_BAR === 0 && index !== SYNTH_STEPS - 1) {
            const divider = document.createElement("span");
            divider.textContent = "|";
            grid.append(divider);
          }
        });
    }

    bodyRow.append(artRow, grid);
    wrapper.append(header, bodyRow);
    fragment.append(wrapper);
  });

  // Render Controls at the bottom
  const bottomRow = document.createElement("div");
  bottomRow.className = "top-row-container"; // Keep class for styling
  
  const synthControls = renderSynthControls();
  const patternControls = renderPatternControls();
  
  bottomRow.append(synthControls, patternControls);
  fragment.append(bottomRow);
  
  // Render Theme Controls (Play/Stop/Color)
  const themeControls = renderThemeControls();
  fragment.append(themeControls);

  refs.synthBody.append(fragment);
  
  // Rebuild focus grid after synths are rendered
  buildFocusGrid();
  } catch (e) {
    console.error("Render error:", e);
    refs.synthBody.innerHTML += `<div style="color:red">Error: ${e.message}</div>`;
  }
}

function renderThemeControls() {
    const container = document.createElement("div");
    container.id = "theme-controls-fixed";
    
    const playSongBtn = document.createElement("button");
    playSongBtn.id = "global-play-song-btn";
    playSongBtn.className = "theme-transport-btn";
    playSongBtn.title = "Play Song";
    playSongBtn.innerHTML = "▶<span style='font-size: 0.9em; margin-left: -3px; font-weight: bold;'>→</span>"; // Thinner arrow, connected
    playSongBtn.addEventListener("click", () => {
        handleStop();
        handlePlay('song');
    });

    const playBtn = document.createElement("button");
    playBtn.id = "global-play-pattern-btn";
    playBtn.className = "theme-transport-btn";
    playBtn.title = "Play Pattern";
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", () => {
        handleStop();
        handlePlay('pattern');
    });
    
    const stopBtn = document.createElement("button");
    stopBtn.id = "global-stop-btn";
    stopBtn.className = "theme-transport-btn";
    stopBtn.title = "Stop";
    stopBtn.textContent = "■";
    stopBtn.addEventListener("click", () => {
        handleStop();
    });
    
    const label = document.createElement("span");
    label.className = "theme-label";
    label.textContent = "color:";
    
    const stdBtn = document.createElement("div");
    stdBtn.className = "theme-btn-graphic";
    stdBtn.id = "theme-std-graphic";
    stdBtn.title = "Standard Theme";
    stdBtn.addEventListener("click", () => {
        document.body.classList.remove("theme-bw");
    });
    
    const bwBtn = document.createElement("div");
    bwBtn.className = "theme-btn-graphic";
    bwBtn.id = "theme-bw-graphic";
    bwBtn.title = "B&W Theme";
    bwBtn.addEventListener("click", () => {
        document.body.classList.add("theme-bw");
    });
    
    container.append(playSongBtn, playBtn, stopBtn, label, stdBtn, bwBtn);
    return container;
}

function renderSynthControls() {
  const controls = document.createElement("div");
  controls.id = "synth-controls";
  
  // Apply active outline if a synth track is active
  if (["bass", "lead", "arp"].includes(state.activeTrack)) {
      controls.classList.add("active-section");
  }
  
  const header = document.createElement("div");
  header.className = "synth-header";
  header.textContent = "EXPERT KNOB TWIDDLING";
  header.style.cursor = "pointer";
  header.addEventListener("click", (e) => {
      e.stopPropagation();
      // audio.currentStep = 0; // Removed to prevent playhead reset
      // updatePlayheadUI();
      // Focus the active track's first step if possible
      if (state.activeTrack) {
          if (state.activeTrack === "drums") {
              setFocusedStep("drums", 0, "kick");
              const firstBtn = refs.stepButtons.drums.kick?.[0];
              if (firstBtn) firstBtn.focus();
          } else {
              const isArp = state.activeTrack === "arp";
              setFocusedStep(state.activeTrack, 0, null, isArp ? "note" : null);
              const firstBtn = refs.stepButtons.synth[state.activeTrack]?.[0];
              if (firstBtn) firstBtn.focus();
          }
      }
  });
  controls.append(header);

  const knobRow = document.createElement("div");
  knobRow.className = "knob-row";
  const knobSpecs = [
    { key: "note", label: "note" },
    { key: "octave", label: "oct" },
    { key: "volume", label: "vol" },
    { key: "mod", label: "mod" }
  ];
  knobSpecs.forEach((spec) => {
    const wrap = document.createElement("div");
    wrap.className = "knob";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.knob = spec.key;
    btn.addEventListener("click", (event) => handleKnobClick(spec.key, event));
    btn.addEventListener("focus", () => setActiveKnob(spec.key));
    btn.addEventListener("blur", () => setActiveKnob(null));
    btn.addEventListener("pointerdown", (event) => startKnobDrag(spec.key, event));
    const valueSpan = document.createElement("span");
    valueSpan.className = "knob-value";
    valueSpan.textContent = "--";
    btn.append(valueSpan);
    refs.knobs[spec.key] = btn;
    refs.knobValues[spec.key] = valueSpan;
    const label = document.createElement("span");
    label.className = "knob-label";
    label.textContent = spec.label;
    wrap.append(btn, label);
    knobRow.append(wrap);
  });
  controls.append(knobRow);
  updateKnobDisplays();
  return controls;
}

function renderPatternControls() {
    const container = document.createElement("div");
    container.id = "pattern-controls";
    
    const header = document.createElement("div");
    header.className = "module-title"; // Changed from pattern-header
    header.textContent = "PATTERN";
    container.append(header);
    
    const grid = document.createElement("div");
    grid.className = "pattern-grid";
    
    for (let i = 0; i < 4; i++) {
        const col = document.createElement("div");
        col.className = "pattern-column";
        
        const slot = document.createElement("div");
        slot.className = "pattern-slot";
        slot.dataset.index = i;

        const playInd = document.createElement("div");
        playInd.className = "pattern-play-ind";
        playInd.textContent = "▶";
        
        const num = document.createElement("div");
        num.className = "pattern-num";
        num.textContent = (i + 1).toString();
        
        slot.append(playInd, num);
        
        if (i === state.editingPatternIdx) {
            slot.classList.add("editing");
        }
        if (i === audio.playingPatternIdx) {
            slot.classList.add("playing");
        }
        if (i === audio.nextPatternIdx) {
            slot.classList.add("queued");
        }
        
        slot.addEventListener("click", () => {
            if (state.editingPatternIdx === i) return;

            if (Tone.Transport.state === "started") {
                audio.nextPatternIdx = i;
            }

            // Switch editing pattern
            state.editingPatternIdx = i;
            state.pattern = state.patterns[i];
            renderSynthStack();
            renderDrumBox();
            // Re-render pattern controls to update editing highlight
            const newControls = renderPatternControls();
            document.getElementById("pattern-controls").replaceWith(newControls);
        });

        // Copy/Paste Button
        const copyBtn = document.createElement("div");
        copyBtn.className = "pattern-copy-btn";
        
        if (state.copyMode.active) {
            if (state.copyMode.sourceIdx === i) {
                copyBtn.textContent = "CANCEL";
                copyBtn.classList.add("active-copy");
            } else {
                copyBtn.textContent = "PASTE";
                copyBtn.classList.add("paste-mode");
            }
        } else {
            copyBtn.textContent = "COPY";
        }

        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!state.copyMode.active) {
                // Start Copy
                state.copyMode = { active: true, sourceIdx: i };
            } else {
                if (state.copyMode.sourceIdx === i) {
                    // Cancel
                    state.copyMode = { active: false, sourceIdx: null };
                } else {
                    // Paste
                    pushToHistory();
                    const sourcePattern = state.patterns[state.copyMode.sourceIdx];
                    // Deep copy
                    state.patterns[i] = JSON.parse(JSON.stringify(sourcePattern));
                    
                    // If we pasted into the currently editing pattern, update reference
                    if (state.editingPatternIdx === i) {
                        state.pattern = state.patterns[i];
                        renderSynthStack();
                        renderDrumBox();
                    }
                    // If we pasted into the currently playing pattern, update audio
                    if (audio.playingPatternIdx === i) {
                        applyWaveformToVoices(state.patterns[i].channelSettings);
                    }
                    
                    state.copyMode = { active: false, sourceIdx: null };
                }
            }
            // Re-render pattern controls
            const newControls = renderPatternControls();
            document.getElementById("pattern-controls").replaceWith(newControls);
        });
        
        const toggle = document.createElement("div");
        toggle.className = "pattern-toggle";
        toggle.textContent = state.patternEnable[i] ? "ON" : "OFF";
        if (state.patternEnable[i]) toggle.classList.add("enabled");
        
        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            state.patternEnable[i] = !state.patternEnable[i];
            // Ensure at least one pattern is enabled
            if (!state.patternEnable.some(Boolean)) {
                state.patternEnable[i] = true;
            }
            // Re-render pattern controls to update toggle UI
            const newControls = renderPatternControls();
            document.getElementById("pattern-controls").replaceWith(newControls);
        });
        
        col.append(slot, copyBtn, toggle);
        grid.append(col);
    }
    
    container.append(grid);
    return container;
}

function updatePatternUI() {
    // Just re-render the stack to update the "playing" indicator
    // This is a bit heavy but safe. Optimization: update classes directly.
    const slots = document.querySelectorAll(".pattern-slot");
    slots.forEach(slot => {
        const idx = parseInt(slot.dataset.index);
        if (idx === audio.playingPatternIdx) slot.classList.add("playing");
        else slot.classList.remove("playing");
    });
}

function renderArpButtons(btnNote, btnType, index) {
    const step = state.pattern.arp[index] || {};
    const velocity = clamp(typeof step.velocity === "number" ? step.velocity : 0, 0, 9);
    const active = velocity > 0;
    
    let noteLabel = active ? formatNoteForTrack("arp", step.note) : "..";
    let typeLabel = "";
    
    if (active) {
        const isMinor = step.chordId === "min";
        typeLabel = isMinor ? "m" : "-";
    }
    
    btnNote.innerHTML = `<span class="btn-note">${noteLabel}</span>`;
    btnType.innerHTML = `<span class="btn-level">${typeLabel}</span>`;
    
    const level = velocityToLevel(velocity).toString();
    btnNote.dataset.level = level;
    btnType.dataset.level = level;
}

function renderSynthButtonContent(btn, channelKey, index) {
  const step = state.pattern[channelKey][index] || {};
  const velocity = clamp(typeof step.velocity === "number" ? step.velocity : 0, 0, 9);
  const active = velocity > 0;
  let noteLabel = active ? formatNoteForTrack(channelKey, step.note) : "..";
  let detailLabel = "";
  
  if (channelKey === "arp") {
      // Fallback if called for Arp (shouldn't be with new split logic, but safe to keep)
      renderArpButtons(btn, btn, index); // Won't work well, but prevents crash
      return;
  } else {
    detailLabel = DIRECTION_SYMBOLS[step.direction] || "";
  }
  btn.innerHTML = `<span class="btn-note">${noteLabel}</span><span class="btn-level">${detailLabel}</span>`;
  btn.dataset.level = velocityToLevel(velocity).toString();
}

function renderArtistMenu() {
  if (!refs.menuField) return;
  refs.menuField.innerHTML = ""; // Clear info
}

function toggleHelp() {
  if (!refs.helpPanel) return;
  const isHidden = refs.helpPanel.style.display === "none";
  const btn = document.getElementById("transport-help-btn");
  
  if (isHidden) {
      // Show Help, Hide others
      refs.helpPanel.style.display = "flex";
      if (refs.drumBody) refs.drumBody.closest("section").style.display = "none";
      if (refs.synthBody) refs.synthBody.closest("section").style.display = "none";
      if (refs.loadPanel) refs.loadPanel.style.display = "none";
      renderHelp();
      if (btn) btn.style.color = "var(--c64-green)";
  } else {
      // Hide Help, Show others
      refs.helpPanel.style.display = "none";
      if (refs.drumBody) refs.drumBody.closest("section").style.display = "flex";
      if (refs.synthBody) refs.synthBody.closest("section").style.display = "flex";
      if (btn) btn.style.color = "var(--c64-purple)";
  }
}

function renderHelp() {
  if (!refs.helpBody) return;
  refs.helpBody.innerHTML = "";

  // Header with Close Button
  const header = document.createElement("div");
  header.className = "overlay-header";
  
  const title = document.createElement("span");
  title.textContent = "HELP & COMMANDS";
  
  const closeBtn = createButton("[close]", "transport-btn", () => toggleHelp());
  
  header.append(title, closeBtn);
  refs.helpBody.append(header);

  const content = [
    "COMMANDS & SHORTCUTS",
    "--------------------",
    "ARROWS      :: Move cursor",
    "SPACE       :: Toggle step / Cycle levels",
    "ENTER       :: Play / Stop",
    "",
    "SYNTH EDITING",
    "-------------",
    "CMD+UP/DN   :: Pitch +/- 1 semitone",
    "CMD+SH+UP/DN:: Pitch +/- 1 octave",
    "ALT+UP/DN   :: Pitch +/- 1 semitone",
    "ALT+CLICK   :: Cycle Arp Chord",
    "",
    "KEYBOARD",
    "--------",
    "A...L, W...P:: Play notes",
    "[ / ]       :: Change Octave",
    "0-9         :: Set volume of selected note",
    "",
    "SAVING & EXPORTING",
    "------------------",
    "SAVE stores your song locally in the browser so you",
    "can load it later to continue working.",
    "EXPORT saves your song as a .wav file that you can",
    "share with friends."
  ];

  const pre = document.createElement("pre");
  pre.style.margin = "0";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = content.join("\n");
  refs.helpBody.append(pre);

  // Expert Mode JSON Export
  const expertDiv = document.createElement("div");
  expertDiv.style.marginTop = "1rem";
  expertDiv.style.borderTop = "1px dashed var(--c64-purple)";
  expertDiv.style.paddingTop = "0.5rem";
  
  const expertLabel = document.createElement("span");
  expertLabel.textContent = "Expert mode: ";
  
  const jsonBtn = createButton("[export as json]", "transport-btn", () => {
      const snapshot = {
          patterns: state.patterns,
          patternEnable: state.patternEnable,
          tempo: state.tempo,
          swing: state.swing,
          trackName: state.trackName,
          currentUser: state.currentUser,
          scaleId: state.scaleId,
          visualizerMode: state.visualizerMode
      };
      const jsonStr = JSON.stringify(snapshot);
      console.log(jsonStr);
      
      if (navigator.clipboard) {
          navigator.clipboard.writeText(jsonStr).then(() => {
              alert("Song data copied to clipboard!");
          }).catch(err => {
              console.error("Clipboard failed", err);
              alert("Could not copy to clipboard. Check console.");
          });
      } else {
          alert("Clipboard API not available. Check console.");
      }
  });
  jsonBtn.style.color = "var(--c64-cyan)";
  
  expertDiv.append(expertLabel, jsonBtn);
  refs.helpBody.append(expertDiv);
}

function openSlotOverlay() {
  if (!refs.loadPanel) return;
  renderSlotOverlay();
  
  // Show Load, Hide others
  refs.loadPanel.style.display = "flex";
  if (refs.drumBody) refs.drumBody.closest("section").style.display = "none";
  if (refs.synthBody) refs.synthBody.closest("section").style.display = "none";
  if (refs.helpPanel) refs.helpPanel.style.display = "none";
  
  refs.loadPanel.dataset.visible = "true";
  refs.loadPanel.setAttribute("aria-hidden", "false");
  
  const btn = document.getElementById("transport-load-btn");
  if (btn) btn.style.color = "var(--c64-green)";
}

function closeSlotOverlay() {
  if (!refs.loadPanel) return;
  
  // Hide Load, Show others
  refs.loadPanel.style.display = "none";
  if (refs.drumBody) refs.drumBody.closest("section").style.display = "flex";
  if (refs.synthBody) refs.synthBody.closest("section").style.display = "flex";
  
  refs.loadPanel.dataset.visible = "false";
  refs.loadPanel.setAttribute("aria-hidden", "true");
  
  const btn = document.getElementById("transport-load-btn");
  if (btn) btn.style.color = "var(--c64-purple)";
}

function isOverlayVisible() {
  return refs.loadPanel?.dataset.visible === "true";
}

async function renderSlotOverlay() {
  if (!refs.loadList) return;
  refs.loadList.innerHTML = "LOADING SONGS...";
  
  try {
      const songs = await db.getAllSongs();
      refs.loadList.innerHTML = "";
      
      if (songs.length === 0) {
          refs.loadList.textContent = "NO SAVED SONGS FOUND.";
          return;
      }

      // Create a grid for slots
      refs.loadList.style.display = "grid";
      refs.loadList.style.gridTemplateColumns = "1fr 1fr";
      refs.loadList.style.gap = "1rem";

      songs.forEach((song) => {
        const card = document.createElement("div");
        card.className = "overlay-card";
        
        // Editable Song Title
        const titleInput = document.createElement("input");
        titleInput.className = "slot-input";
        titleInput.value = song.trackName || "UNTITLED";
        titleInput.placeholder = "SONG TITLE";
        titleInput.addEventListener("change", (e) => {
            const newVal = e.target.value;
            db.saveSong({ ...song, trackName: newVal }).then(() => {
                // Update local object so subsequent edits work
                song.trackName = newVal;
            });
        });
        card.append(titleInput);

        const body = document.createElement("div");
        
        // Editable Artist Name
        const artistInput = document.createElement("input");
        artistInput.className = "slot-input";
        artistInput.value = song.currentUser || "UNKNOWN";
        artistInput.placeholder = "ARTIST";
        artistInput.addEventListener("change", (e) => {
            const newVal = e.target.value;
            db.saveSong({ ...song, currentUser: newVal }).then(() => {
                song.currentUser = newVal;
            });
        });
        body.append(artistInput);
        
        // Meta info (Tempo, Date)
        const metaDiv = document.createElement("div");
        metaDiv.className = "slot-meta";
        const dateStr = new Date(song.updatedAt).toLocaleDateString("en-GB").replace(/\//g, "-");
        metaDiv.textContent = `TEMPO: ${song.tempo} | ${dateStr}`;
        body.append(metaDiv);
        
        card.append(body);
        
        const footer = document.createElement("footer");
        footer.style.display = "flex";
        footer.style.justifyContent = "space-between";
        footer.style.marginTop = "0.5rem";
        
        const loadBtn = createButton("[LOAD]", "transport-btn", () => {
          applySnapshot(song);
          closeSlotOverlay();
        });
        
        const delBtn = createButton("[DEL]", "transport-btn", (e) => {
            e.stopPropagation();
            const btn = e.target;
            
            if (btn.textContent === "[SURE?]") {
                db.deleteSong(song.id).then(() => renderSlotOverlay());
            } else {
                btn.textContent = "[SURE?]";
                btn.style.color = "var(--c64-green)";
                
                const cancelListener = (clickEvent) => {
                    if (clickEvent.target !== btn) {
                        btn.textContent = "[DEL]";
                        btn.style.color = "var(--c64-purple)";
                        window.removeEventListener("click", cancelListener);
                    }
                };
                
                setTimeout(() => {
                    window.addEventListener("click", cancelListener);
                }, 0);
            }
        });
        delBtn.style.color = "var(--c64-purple)";

        footer.append(loadBtn, delBtn);
        card.append(footer);
        refs.loadList.append(card);
      });
  } catch (e) {
      refs.loadList.textContent = "ERROR LOADING SONGS: " + e;
  }
}

function cycleDrumLevel(laneKey, index) {
  pushToHistory();
  const current = state.pattern.drums[laneKey][index];
  const next = nextLevel(current);
  state.pattern.drums[laneKey][index] = next;
  updateDrumButton(laneKey, index);
  if (next > 0) {
    previewDrumLane(laneKey, next);
  }
}

function updateDrumButton(laneKey, index) {
  const btn = refs.stepButtons.drums[laneKey]?.[index];
  if (!btn) return;
  const level = state.pattern.drums[laneKey][index];
  btn.dataset.level = level.toString();
  btn.innerHTML = `<span class="btn-level">${LEVEL_SYMBOLS[level]}</span>`;
}

function toggleArpChordType(index) {
    pushToHistory();
    const step = state.pattern.arp[index];
    if (!step || (step.velocity || 0) <= 0) return; // Only if active
    
    // Toggle between maj and min
    const current = step.chordId || "maj";
    const next = current === "maj" ? "min" : "maj";
    step.chordId = next;
    
    // Re-render both buttons for this step
    // We need to find them.
    // refs.stepButtons.synth.arp is [Note0, Type0, Note1, Type1...]
    const btnNote = refs.stepButtons.synth.arp[index * 2];
    const btnType = refs.stepButtons.synth.arp[index * 2 + 1];
    if (btnNote && btnType) {
        renderArpButtons(btnNote, btnType, index);
    }
}

function toggleSynthStep(channelKey, index) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const current = typeof step.velocity === "number" ? step.velocity : 0;
  let next;
  if (current <= 0) {
    next = DEFAULT_STEP_VELOCITY;
  } else {
    next = 0;
    // Clear step data when toggling off
    step.note = null;
    step.degree = null;
    step.direction = 0;
    step.decay = DEFAULT_STEP_DECAY;
    step.mod = 0;
    if (channelKey === "arp") {
        step.chordId = null;
    }
  }
  setStepVelocity(channelKey, index, next);
  if (next > 0) {
    previewSynthStep(channelKey, index);
  }
}

function shiftStepNote(channelKey, index, delta) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const base = typeof step.note === "number" ? step.note : getTrackDefaultNoteIndex(channelKey);
  const next = clampNoteIndex(base + delta);
  setStepNoteValue(channelKey, index, next);
}

function setStepSemitone(channelKey, index, semitone) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const safeSemitone = clamp(Math.round(semitone), 0, NOTE_NAMES.length - 1);
  const octave = getStepOctave(step, channelKey);
  const next = clampNoteIndex(octave * NOTE_NAMES.length + safeSemitone);
  setStepNoteValue(channelKey, index, next);
}

function shiftStepOctave(channelKey, index, delta) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const octave = getStepOctave(step, channelKey);
  setStepOctave(channelKey, index, octave + delta);
}

function setStepOctave(channelKey, index, octave) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const semitone = getStepSemitone(step, channelKey);
  const safeOct = clamp(Math.round(octave), 0, NOTE_RANGE_OCTAVES - 1);
  const next = clampNoteIndex(safeOct * NOTE_NAMES.length + semitone);
  setStepNoteValue(channelKey, index, next);
}

function setStepNoteValue(channelKey, index, noteIndex) {
  pushToHistory();
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const safe = clampNoteIndex(noteIndex);
  step.note = safe;
  step.degree = safe;
  
  if (channelKey === "arp") {
      const btnNote = refs.stepButtons.synth.arp[index * 2];
      const btnType = refs.stepButtons.synth.arp[index * 2 + 1];
      if (btnNote && btnType) {
          renderArpButtons(btnNote, btnType, index);
      }
  } else {
      renderSynthButtonContent(refs.stepButtons.synth[channelKey][index], channelKey, index);
  }
  
  updateKnobDisplays();
  notifyStateChange();
}

function adjustSynthDirection(channelKey, index, delta) {
  pushToHistory();
  if (channelKey === "arp") return;
  const step = getSynthStep(channelKey, index);
  if (typeof step.direction !== "number") {
    step.direction = 0;
  }
  const currentIndex = DIRECTION_VALUES.indexOf(step.direction);
  const startIndex = currentIndex === -1 ? 1 : currentIndex;
  const nextIndex = (startIndex + delta + DIRECTION_VALUES.length) % DIRECTION_VALUES.length;
  step.direction = DIRECTION_VALUES[nextIndex];
  renderSynthButtonContent(refs.stepButtons.synth[channelKey][index], channelKey, index);
  updateKnobDisplays();
}

function cycleArpChord(index, delta = 1) {
  pushToHistory();
  const step = state.pattern.arp[index];
  const chords = arpChords;
  const currentIdx = chords.findIndex((chord) => chord.id === step.chordId);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;
  const nextIdx = (safeIdx + delta + chords.length) % chords.length;
  step.chordId = chords[nextIdx].id;
  
  const btnNote = refs.stepButtons.synth.arp[index * 2];
  const btnType = refs.stepButtons.synth.arp[index * 2 + 1];
  if (btnNote && btnType) {
      renderArpButtons(btnNote, btnType, index);
  }
  
  if (state.focusedStep?.channel === "arp" && state.focusedStep.index === index) {
    updateKnobDisplays();
  }
}

function handleSynthButtonInteraction(event, channelKey, index, explicitWasFocused) {
  // Check if the button was ALREADY focused before this click interaction started
  // We use the dataset.wasFocused flag set in mousedown, OR the explicit argument
  const btn = refs.stepButtons.synth[channelKey]?.[index];
  const wasFocused = explicitWasFocused ?? (btn?.dataset.wasFocused === "true");
  
  // Always set focus first (if not already)
  setFocusedStep(channelKey, index);
  if (btn) btn.focus();

  // If Arp, check if click was on the bottom half (Chord Type)
  if (channelKey === "arp") {
      const rect = btn.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const height = rect.height;
      
      // If click is in bottom 40% of the button, toggle chord type
      if (y > height * 0.6) {
          toggleArpChordType(index);
          return;
      }
  }

  const pitchModifier = event.metaKey || event.ctrlKey;
  const chordModifier = event.altKey;

  if (channelKey === "arp") {
    if (pitchModifier) {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      shiftStepNote(channelKey, index, delta);
      return;
    }
    if (chordModifier) {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      cycleArpChord(index, delta);
      return;
    }
    // Only toggle if it was already focused
    if (wasFocused) {
      toggleSynthStep(channelKey, index);
    }
    return;
  }

  if (pitchModifier) {
    event.preventDefault();
    const delta = event.shiftKey ? -1 : 1;
    shiftStepNote(channelKey, index, delta);
    return;
  }

  if (event.shiftKey) {
    event.preventDefault();
    const delta = chordModifier ? -1 : 1;
    adjustSynthDirection(channelKey, index, delta);
    return;
  }

  // Only toggle if it was already focused
  if (wasFocused) {
    toggleSynthStep(channelKey, index);
  }
}
    
    // Current code:
    // if (wasFocused) toggleSynthStep(channelKey, index);
    
    // This seems to match the request exactly.
    // "This is how I want it to be for BASS and LEAD as well."
    
    // So the issue might be that BASS and LEAD are NOT behaving this way?
    // Let's check handleSynthButtonInteraction again.
    // It is used for BASS and LEAD.
    // It checks wasFocused.
    
    // Maybe the issue is that for CHRD (Arp), the event listener is different?
    // Arp uses:
    // btnNote.addEventListener("click", () => {
    //     const wasFocused = ...
    //     setFocusedStep(...)
    //     if (wasFocused) {
    //         toggleSynthStep(track.key, index);
    //     }
    // });
    
    // Bass/Lead uses:
    // btn.addEventListener("click", (event) => {
    //     setFocusedStep(...)
    //     handleSynthButtonInteraction(event, track.key, index);
    // });
    
    // And handleSynthButtonInteraction does:
    // const btn = refs.stepButtons.synth[channelKey]?.[index];
    // const wasFocused = btn?.dataset.wasFocused === "true";
    // ...
    // if (wasFocused) { toggleSynthStep(...) }
    
    // This relies on mousedown setting dataset.wasFocused.
    // Maybe mousedown is not firing or timing is off?
    // Or maybe the user wants the FIRST click to NOT toggle, but currently it DOES?
    // If I click a button, it gets focus.
    // If I click it again, it toggles.
    
    // If the user says "This is how I want it to be for BASS and LEAD as well", implies it is NOT currently like that.
    // Maybe currently Bass/Lead toggles on FIRST click?
    // If wasFocused is true on first click? No, it shouldn't be.
    
    // Let's look at mousedown.
    // btn.addEventListener("mousedown", () => {
    //   const isFocused = state.focusedStep?.channel === track.key && state.focusedStep?.index === index;
    //   btn.dataset.wasFocused = isFocused.toString();
    // });
    
    // If I click an unfocused button:
    // mousedown: isFocused is false. wasFocused = "false".
    // click: setFocusedStep (now it is focused). handleSynthButtonInteraction.
    // handleSynthButtonInteraction: reads wasFocused ("false").
    // if (wasFocused) -> false. Does NOT toggle.
    
    // So first click: Focuses.
    // Second click:
    // mousedown: isFocused is true. wasFocused = "true".
    // click: ...
    // handleSynthButtonInteraction: reads wasFocused ("true").
    // if (wasFocused) -> true. Toggles.
    
    // This seems to be exactly what the user wants.
    // Why does the user think it's not working?
    // "Then I press a spot in the sequencer for CHRD now, it marks it. If I press it again it will put in a note. This is how I want it to be for BASS and LEAD as well."
    
    // Maybe for CHRD it works differently?
    // Arp listener:
    // btnNote.addEventListener("click", () => {
    //     const wasFocused = state.focusedStep?.channel === track.key && state.focusedStep?.index === index && state.focusedStep?.subtype === "note";
    //     setFocusedStep(track.key, index, null, "note");
    //     if (wasFocused) {
    //         toggleSynthStep(track.key, index);
    //     }
    // });
    
    // Arp does NOT use mousedown/wasFocused logic. It checks state directly inside the click handler.
    // But wait, inside the click handler, `state.focusedStep` is the OLD focus (before setFocusedStep is called in the next line).
    // const wasFocused = state.focusedStep...
    // setFocusedStep(...)
    // if (wasFocused) ...
    
    // So for Arp:
    // Click 1 (unfocused): wasFocused is false. setFocusedStep runs. if (wasFocused) false. -> Just Focus.
    // Click 2 (focused): wasFocused is true. setFocusedStep runs (no change). if (wasFocused) true. -> Toggle.
    
    // This logic is robust for Arp.
    
    // For Bass/Lead:
    // It uses mousedown to set a flag on the DOM element.
    // Maybe that is flaky?
    // Or maybe `setFocusedStep` is called somewhere else before `handleSynthButtonInteraction`?
    // In the click handler:
    // btn.addEventListener("click", (event) => {
    //     setFocusedStep(track.key, index);
    //     setActiveTrack(track.key);
    //     handleSynthButtonInteraction(event, track.key, index);
    // });
    
    // Ah! `setFocusedStep` is called BEFORE `handleSynthButtonInteraction`.
    // But `handleSynthButtonInteraction` reads `dataset.wasFocused` which was set on `mousedown`.
    // So `mousedown` happens before `click`.
    // So `wasFocused` should be correct (state before click).
    
    // However, `handleSynthButtonInteraction` ALSO calls `setFocusedStep(channelKey, index)`.
    // So it is called twice.
    
    // Let's try to make Bass/Lead logic identical to Arp logic to be safe.
    // Remove mousedown listener.
    // Update click listener to check focus BEFORE setting it.
    
  

function nextLevel(current) {
  if (current === 0) return 2;
  if (current === 2) return 1;
  return 0;
}

function formatNoteForTrack(channelKey, noteIndex) {
  return noteIndexToLabel(noteIndex);
}

function getMaxNoteIndex() {
  return MAX_NOTE_INDEX;
}

function getCurrentScale() {
  return scaleOptions.find((scale) => scale.id === state.scaleId) || scaleOptions[0];
}

function adjustTempo(delta) {
  pushToHistory();
  state.tempo = clamp(state.tempo + delta, 60, 200);
  const tempoEl = document.getElementById("tempo-readout");
  if (tempoEl) tempoEl.textContent = ` [${state.tempo}] `;
  if (audio.ready) {
    Tone.Transport.bpm.rampTo(state.tempo, 0.1);
  }
}

function adjustSwing(delta) {
  pushToHistory();
  state.swing = clamp(state.swing + delta, 0, 60);
  const swingEl = document.getElementById("swing-readout");
  if (swingEl) swingEl.textContent = state.swing < 10 ? ` [0${state.swing}%] ` : ` [${state.swing}%] `;
  if (audio.ready) {
    Tone.Transport.swing = state.swing / 100;
  }
}

function setScale(scaleId) {
  if (state.scaleId === scaleId) return;
  state.scaleId = scaleId;
  clampPatternToScale();
  renderScaleField();
  renderSynthStack();
}

function clampPatternToScale() {
  synthTracks.forEach((track) => {
    state.pattern[track.key] = state.pattern[track.key].map((step = {}) => {
      const note = clampNoteIndex(typeof step.note === "number" ? step.note : DEFAULT_NOTE_INDEX);
      const velocity = clamp(typeof step.velocity === "number" ? step.velocity : 0, 0, 9);
      const decay = clamp(typeof step.decay === "number" ? step.decay : DEFAULT_STEP_DECAY, 0, 9);
      if (isArpChannel(track.key)) {
        return {
          note,
          velocity,
          level: velocityToLevel(velocity),
          chordId: step.chordId || defaultArpChord.id
        };
      }
      return {
        note,
        velocity,
        level: velocityToLevel(velocity),
        direction: DIRECTION_VALUES.includes(step.direction) ? step.direction : 0,
        decay
      };
    });
  });
}

function initVisualizerBody() {
  if (!refs.visualizerBody) return;
  // Mode 2 is Oscilloscope (needs line), others don't
  refs.visualizerBody.textContent = buildEmptyVisualizer(state.visualizerMode === 2);
  // Class will be updated by updateVisualizer loop
}

function buildEmptyVisualizer(showLine = true) {
  // Always return VISUALIZER_HEIGHT lines
  const body = Array.from({ length: VISUALIZER_HEIGHT }, (v, i) => {
    // Middle line for silence, only if requested
    if (showLine && i === Math.floor(VISUALIZER_HEIGHT / 2)) {
      return "-".repeat(VISUALIZER_WIDTH);
    }
    return " ".repeat(VISUALIZER_WIDTH);
  }).join("\n");
  return body;
}

function startVisualizerTicker() {
  const render = () => {
    try {
      updateVisualizer();
      updateGlyphDivider();
    } catch (e) {
      console.error("Visualizer error:", e);
    }
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}

let glyphState = [];
let glyphState2 = [];
const GLYPH_WIDTH = 80; 
const GLYPH_CHARS = ["█", "▓", "▒", "░", "■", "▀", "▄", "▌", "▐", "▖", "▗", "▘", "▙", "▚", "▛", "▜", "▝", "▞", "▟"];
let lastGlyphUpdate = 0;
let glyphPulsePos = -1;
let glyphPulseColor = "";

function initGlyphDivider() {
    const synthBody = document.getElementById("synth-body");
    if (!synthBody) return;
    
    // Check if already exists
    if (document.getElementById("glyph-divider")) return;

    const divider = document.createElement("div");
    divider.id = "glyph-divider";
    divider.className = "glyph-divider";
    // Insert before synthBody (which is inside synth-panel)
    // This places it at the top of the synth panel, effectively between drums and synth
    synthBody.parentNode.insertBefore(divider, synthBody);
    
    // Move to be a direct child of workspace to avoid clipping?
    // Or just ensure synth-panel doesn't clip.
    // The user asked to put it "over the drummer boy frame".
    // Let's try moving it to the drum panel instead, at the bottom.
    const drumPanel = document.getElementById("drum-panel");
    if (drumPanel) {
        drumPanel.appendChild(divider);
        // Reset margins since it's now at the bottom of the drum panel
        divider.style.marginTop = "0.5rem";
        divider.style.marginBottom = "-1rem"; // Pull it down slightly
        divider.style.zIndex = "100";
        divider.style.position = "relative";
    } else {
        synthBody.parentNode.insertBefore(divider, synthBody);
    }
    
    // Initialize state
    glyphState = Array(GLYPH_WIDTH).fill(" ");
    glyphState2 = Array(GLYPH_WIDTH).fill(" ");
    // Fill with random initial noise
    for (let i = 0; i < GLYPH_WIDTH; i++) {
        if (Math.random() > 0.7) {
            glyphState[i] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
        }
        if (Math.random() > 0.7) {
            glyphState2[i] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
        }
    }
}

function updateGlyphDivider() {
    const divider = document.getElementById("glyph-divider");
    if (!divider) return;

    // Check visibility of overlays
    const helpVisible = refs.helpPanel && refs.helpPanel.style.display !== "none";
    const loadVisible = isOverlayVisible();
    
    if (helpVisible || loadVisible) {
        divider.style.visibility = "hidden";
        return;
    } else {
        divider.style.visibility = "visible";
    }
    
    // Enforce fixed width state
    if (glyphState.length !== GLYPH_WIDTH) {
        glyphState = Array(GLYPH_WIDTH).fill(" ");
        for (let i = 0; i < GLYPH_WIDTH; i++) {
             if (Math.random() > 0.7) glyphState[i] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
        }
    }
    if (!glyphState2 || glyphState2.length !== GLYPH_WIDTH) {
        glyphState2 = Array(GLYPH_WIDTH).fill(" ");
        for (let i = 0; i < GLYPH_WIDTH; i++) {
             if (Math.random() > 0.7) glyphState2[i] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
        }
    }
    
    const now = Date.now();
    const isPlaying = Tone.Transport.state === "started";
    // Update faster when playing
    const interval = isPlaying ? 60 : 200; 
    
    if (now - lastGlyphUpdate < interval) return;
    lastGlyphUpdate = now;
    
    if (isPlaying) {
        // Spawn new pulse occasionally
        if (glyphPulsePos === -1 && Math.random() > 0.95) {
            glyphPulsePos = 0;
            const colors = ["var(--c64-cyan)", "var(--c64-green)", "var(--c64-orange)"];
            glyphPulseColor = colors[Math.floor(Math.random() * colors.length)];
        }

        // Move pulse
        if (glyphPulsePos !== -1) {
            glyphPulsePos += 2; // Move faster than 1 char per tick
            if (glyphPulsePos >= GLYPH_WIDTH) {
                glyphPulsePos = -1;
            }
        }

        // Mutate in place (no shifting)
        const mutate = (arr) => {
            for (let i = 0; i < GLYPH_WIDTH; i++) {
                // Higher mutation chance near pulse
                const dist = Math.abs(i - glyphPulsePos);
                const mutationChance = (glyphPulsePos !== -1 && dist < 4) ? 0.5 : 0.05;
                
                if (Math.random() < mutationChance) {
                    // Maintain density
                    if (arr[i] !== " " || Math.random() > 0.8) {
                        arr[i] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
                    } else {
                        arr[i] = " ";
                    }
                }
            }
        };
        mutate(glyphState);
        mutate(glyphState2);

    } else {
        // Slow breathing/glitch when stopped
        const slowMutate = (arr) => {
            if (Math.random() > 0.8) {
                 const idx = Math.floor(Math.random() * GLYPH_WIDTH);
                 if (arr[idx] !== " ") {
                     arr[idx] = Math.random() > 0.5 ? " " : GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
                 } else if (Math.random() > 0.9) {
                     arr[idx] = GLYPH_CHARS[Math.floor(Math.random() * GLYPH_CHARS.length)];
                 }
            }
        };
        slowMutate(glyphState);
        slowMutate(glyphState2);
        glyphPulsePos = -1;
    }
    
    // Render with spans for color
    const renderRow = (arr) => {
        let html = "";
        for (let i = 0; i < GLYPH_WIDTH; i++) {
            const char = arr[i];
            let style = "";
            
            if (glyphPulsePos !== -1) {
                 const dist = Math.abs(i - glyphPulsePos);
                 if (dist < 3 && char !== " ") {
                     style = `color:${glyphPulseColor}; text-shadow: 0 0 4px ${glyphPulseColor}`;
                 }
            }
            html += `<span class="glyph-cell" style="${style}">${char}</span>`;
        }
        return `<div class="glyph-row">${html}</div>`;
    };

    divider.innerHTML = renderRow(glyphState) + renderRow(glyphState2);
    
    // Reset base color (handled by CSS mostly, but ensure no override)
    divider.style.color = "";
    divider.style.textShadow = "";
}

function renderVisualizerControls() {
  if (!refs.visualizerControls) return;
  
  // If already rendered, just update classes
  const existingGrid = refs.visualizerControls.querySelector(".viz-grid");
  if (existingGrid) {
      const buttons = existingGrid.querySelectorAll(".viz-btn");
      buttons.forEach((btn, idx) => {
          const mode = idx + 1;
          if (state.visualizerMode === mode) {
              btn.classList.add("active");
          } else {
              btn.classList.remove("active");
          }
      });
      return;
  }

  refs.visualizerControls.innerHTML = "";
  
  // refs.visualizerControls.append(createDivider()); // Removed divider as requested

  const header = document.createElement("div");
  header.className = "viz-header";
  header.textContent = "VISUALIZER";
  header.style.marginTop = "1rem"; // Add blank space instead
  refs.visualizerControls.append(header);
  
  const grid = document.createElement("div");
  grid.className = "viz-grid";
  grid.style.marginTop = "0.5rem"; // Move down slightly
  
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement("button");
    btn.className = "viz-btn";
    if (state.visualizerMode === i) {
      btn.classList.add("active");
    }
    btn.textContent = i.toString();
    btn.addEventListener("click", () => {
      state.visualizerMode = i;
      renderVisualizerControls();
      // Update color based on mode
      if (refs.visualizerBody) {
          refs.visualizerBody.className = `viz-mode-${i}`;
      }
    });
    grid.append(btn);
  }
  
  refs.visualizerControls.append(grid);
}

function updateVisualizer() {
  if (!audio.analyser || !refs.visualizerBody) return;
  
  // Safety check for analyser data
  let data;
  try {
      data = audio.analyser.getValue();
  } catch (e) {
      return;
  }
  
  const width = VISUALIZER_WIDTH;
  const height = VISUALIZER_HEIGHT;
  
  // Calculate RMS (Volume)
  let sumSq = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < data.length; i++) {
      sumSq += data[i] * data[i];
      if (i > 0 && ((data[i] > 0 && data[i-1] <= 0) || (data[i] < 0 && data[i-1] >= 0))) {
          zeroCrossings++;
      }
  }
  const rms = Math.sqrt(sumSq / data.length);
  const zcr = zeroCrossings / data.length; // 0.0 to 0.5 (Nyquist)
  
  // Check for silence (approximate)
  const isSilent = rms < 0.01;
  
  let body = "";
  
  // Pass extra metrics to renderers
  const metrics = { rms, zcr, isSilent };

  // Update Visualizer Color based on Mode
  // Mode 1 (Bars) -> Purple
  // Mode 2 (Oscilloscope) -> Green
  // Others -> Default or keep existing logic
  refs.visualizerBody.classList.remove("viz-color-1", "viz-color-2", "viz-color-3", "viz-color-4", "viz-color-5", "viz-color-6");
  
  if (state.visualizerMode === 1) {
      refs.visualizerBody.classList.add("viz-color-3"); // Purple
  } else if (state.visualizerMode === 2) {
      refs.visualizerBody.classList.add("viz-color-2"); // Green
  } else {
      // Default colors for other modes if needed, or just inherit
      // Mode 3 is Cyan (viz-color-1) usually? Let's leave it to CSS default or set explicitly if needed.
      // The CSS sets #visualizer-body color to var(--c64-purple) by default.
      // Let's enforce the button colors for consistency if desired, but user only specified 1 and 2.
      if (state.visualizerMode === 3) refs.visualizerBody.classList.add("viz-color-1"); // Cyan
      if (state.visualizerMode === 4) refs.visualizerBody.classList.add("viz-color-4"); // Orange
      if (state.visualizerMode === 5) refs.visualizerBody.classList.add("viz-color-2"); // Green (or maybe white?)
      if (state.visualizerMode === 6) refs.visualizerBody.classList.add("viz-color-3"); // Purple
  }
  
  if (isSilent) {
      // Special handling for silence
      if (state.visualizerMode === 2) {
          // Mode 2 (Oscilloscope) gets the flat line
          body = buildEmptyVisualizer(true);
      } else if (state.visualizerMode === 3 || state.visualizerMode === 6) {
          // Mode 3 and 6 have their own silence/decay logic, so we let them render
          try {
              if (state.visualizerMode === 3) body = renderVizMode3(data, width, height, metrics);
              else body = renderVizMode6(data, width, height, metrics);
          } catch (err) {
              body = buildEmptyVisualizer(false);
          }
      } else {
          // All other modes (1, 4, 5) get empty space on silence
          body = buildEmptyVisualizer(false);
      }
  } else {
      try {
          switch (state.visualizerMode) {
              case 1: body = renderVizMode2(data, width, height); break;
              case 2: body = renderVizMode1(data, width, height); break;
              case 3: body = renderVizMode3(data, width, height, metrics); break;
              case 4: body = renderVizMode4(data, width, height, metrics); break;
              case 5: body = renderVizMode5(data, width, height); break;
              case 6: body = renderVizMode6(data, width, height, metrics); break;
              default: body = renderVizMode2(data, width, height); break;
          }
      } catch (err) {
          console.warn("Render error in mode", state.visualizerMode, err);
          body = buildEmptyVisualizer(false);
      }
  }
  
  refs.visualizerBody.innerHTML = body;
}

function renderVizMode1(data, width, height) {
    // Original Oscilloscope
    const lines = Array.from({ length: height }, () => Array(width).fill(" "));
    const chars = ["●", "○", "■", "□", "◆", "◇", "▲", "▼", "◀", "▶", "▄", "▀", "█", "░", "▒", "▓"];
    for (let x = 0; x < width; x += 1) {
      const idx = Math.floor((x / width) * data.length);
      const sample = (data[idx] || 0) * 0.4; // Reduce intensity by scaling down amplitude
      const norm = Math.max(Math.min(sample, 1), -1);
      const y = Math.floor(((norm + 1) / 2) * (height - 1));
      const row = height - 1 - y;
      
      if (row >= 0 && row < height) {
          const charIdx = Math.floor(Math.abs(sample * 100 + x + y)) % chars.length;
          lines[row][x] = chars[charIdx];
      }
    }
    return lines.map((cells) => cells.join("")).join("\n");
}

// Store previous bar heights for smoothing
const prevBarHeights = [];

function renderVizMode2(data, width, height) {
    // "Bars" / Spectrum-ish
    const lines = Array.from({ length: height }, () => Array(width).fill(" "));
    const barWidth = 2;
    const numBars = Math.floor(width / barWidth);
    
    // Initialize previous heights if needed
    if (prevBarHeights.length !== numBars) {
        prevBarHeights.length = numBars;
        prevBarHeights.fill(0);
    }
    
    for (let i = 0; i < numBars; i++) {
        const dataIdx = Math.floor((i / numBars) * data.length);
        // Scale down to prevent clipping and keep peaks lower
        const val = Math.abs(data[dataIdx]) * 0.5; // Reduced scale
        let targetHeight = Math.floor(val * height);
        
        // Smoothing / Decay logic
        // If new height is lower than previous, decay slowly
        // If new height is higher, jump up immediately (or smooth up too if desired, but usually attack is fast)
        if (targetHeight < prevBarHeights[i]) {
            // Decay factor (e.g., drop by 1 unit or 10% per frame)
            // Let's try dropping by 0.5 units (accumulated) or just keep it simple with integers
            // Since we render integers, we might need float storage for smoothness, but let's try simple integer decay
            // If we want it "slower", we can just decrement by 1 every X frames, or use a float array.
            // Let's use a float array for storage but render int.
            prevBarHeights[i] -= 0.5; // Decay speed
            if (prevBarHeights[i] < 0) prevBarHeights[i] = 0;
        } else {
            prevBarHeights[i] = targetHeight;
        }
        
        const renderHeight = Math.floor(prevBarHeights[i]);
        
        for (let h = 0; h < renderHeight; h++) {
            const row = height - 1 - h;
            if (row >= 0 && row < height) {
                const char = h === renderHeight - 1 ? "▀" : "█";
                for (let w = 0; w < barWidth; w++) {
                    if (i * barWidth + w < width) {
                        lines[row][i * barWidth + w] = char;
                    }
                }
            }
        }
    }
    return lines.map(l => l.join("")).join("\n");
}

function renderVizMode3(data, width, height, metrics) {
    // "Center Burst"
    const lines = Array.from({ length: height }, () => Array(width).fill(" "));
    // Use floating point center for perfect symmetry on even widths
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    
    // Use RMS for radius
    const radius = Math.floor(metrics.rms * Math.min(width, height) * 0.8);
    
    // Burst logic on silence
    if (!renderVizMode3.lastRms) renderVizMode3.lastRms = 0;
    if (!renderVizMode3.bursts) renderVizMode3.bursts = [];
    
    // If sound ends (volume drops significantly), trigger burst
    if (renderVizMode3.lastRms > 0.1 && metrics.rms < 0.05) {
        renderVizMode3.bursts.push({ r: 1, maxR: Math.min(width, height) / 2 });
    }
    renderVizMode3.lastRms = metrics.rms;
    
    // Update bursts
    for (let i = renderVizMode3.bursts.length - 1; i >= 0; i--) {
        renderVizMode3.bursts[i].r += 1;
        if (renderVizMode3.bursts[i].r > renderVizMode3.bursts[i].maxR) {
            renderVizMode3.bursts.splice(i, 1);
        }
    }
    
    const chars = ["*", "+", "x", "o", "O", "@", "#"];
    const char = chars[Math.floor(metrics.rms * 20) % chars.length];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Adjust aspect ratio for text (characters are usually taller than wide)
            // Standard terminal char is ~1:2 aspect ratio.
            // So dx should be scaled or dy scaled.
            // Let's try to make it circular.
            const dx = (x - cx);
            const dy = (y - cy) * 2.0; // Correct for line height vs char width
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Main ball
            if (dist < radius) {
                if (y >= 0 && y < height && x >= 0 && x < width) lines[y][x] = char;
            } 
            // Noise field around ball
            else if (dist < radius + 1 && Math.random() > 0.5) {
                if (y >= 0 && y < height && x >= 0 && x < width) lines[y][x] = ".";
            }
            
            // Render bursts
            renderVizMode3.bursts.forEach(b => {
                if (Math.abs(dist - b.r * 2) < 2) { // Scale burst radius too
                     if (y >= 0 && y < height && x >= 0 && x < width) lines[y][x] = "░";
                }
            });
        }
    }
    return lines.map(l => l.join("")).join("\n");
}

function renderVizMode4(data, width, height, metrics) {
    // "Signal Blocks" - Varied rectangles, highly reactive
    if (!renderVizMode4.particles) renderVizMode4.particles = [];
    const particles = renderVizMode4.particles;
    
    const maxVal = metrics.rms; 
    const zcr = metrics.zcr;

    // Increased sensitivity: spawn more easily
    let spawnCount = 0;
    if (maxVal > 0.4) spawnCount = 2;
    else if (maxVal > 0.2) spawnCount = 1;

    // Very rare background noise
    if (Math.random() > 0.99) spawnCount++;

    for(let k=0; k<spawnCount; k++) {
        const symbols = ["░", "▒", "▓", "█", "▄", "▀", "■", "▌", "▐", "▖", "▗", "▘", "▙", "▚", "▛", "▜", "▝", "▞", "▟"];
        const char = symbols[Math.floor(Math.random() * symbols.length)];
        
        // Shape logic based on ZCR (pitch)
        let w, h;
        const baseSize = 1 + Math.floor(maxVal * 4); // Volume affects overall scale

        if (zcr > 0.3) {
            // High pitch: Tall and thin
            w = Math.max(1, Math.floor(baseSize * 0.5));
            h = Math.max(1, Math.floor(baseSize * 1.5));
        } else if (zcr < 0.1) {
            // Low pitch: Wide and short
            w = Math.max(1, Math.floor(baseSize * 1.5));
            h = Math.max(1, Math.floor(baseSize * 0.5));
        } else {
            // Mid pitch: Boxy
            w = baseSize;
            h = baseSize;
        }

        // Randomize slightly
        w += Math.floor(Math.random() * 2);
        h += Math.floor(Math.random() * 2);

        const x = Math.floor(Math.random() * (width - w));
        const y = Math.floor(Math.random() * (height - h));
        
        // Color (1-6) - Exclude Purple (3) and Pink (6)
        const safeColors = [1, 2, 4, 5];
        const colorIdx = safeColors[Math.floor(Math.random() * safeColors.length)];
        
        // Opacity
        const opacity = Math.min(1, 0.3 + maxVal * 1.5);
        
        particles.push({
            x, y, w, h, char, life: 1.0, colorIdx, opacity
        });
    }
    
    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].life -= 0.08; // Faster decay
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        }
    }
    
    // Render
    const grid = [];
    for(let y=0; y<height; y++) {
        const row = [];
        for(let x=0; x<width; x++) {
            row.push({ char: " ", colorClass: "", style: "" });
        }
        grid.push(row);
    }
    
    particles.forEach(p => {
        for (let dy = 0; dy < p.h; dy++) {
            for (let dx = 0; dx < p.w; dx++) {
                const py = p.y + dy;
                const px = p.x + dx;
                
                if (py >= 0 && py < height && px >= 0 && px < width) {
                    // Flicker effect
                    if (p.life > 0.05) {
                        grid[py][px] = { 
                            char: p.char, 
                            colorClass: `viz-color-${p.colorIdx}`,
                            style: `opacity: ${p.opacity * p.life}`
                        };
                    }
                }
            }
        }
    });
    
    // Convert to HTML
    return grid.map(row => {
        const lineHtml = row.map(cell => {
            if (cell.char === " ") return " ";
            return `<span class="${cell.colorClass}" style="${cell.style}">${cell.char}</span>`;
        }).join("");
        return `<div class="viz-row">${lineHtml}</div>`;
    }).join("");
}

function renderVizMode5(data, width, height) {
    // "Symmetry" - Solid Blocky Version
    const lines = Array.from({ length: height }, () => Array(width).fill(" "));
    const mid = Math.floor(width / 2);
    const cy = Math.floor((height - 1) / 2); // Shift center up slightly to be visually centered
    
    for (let x = 0; x < mid; x++) {
        const idx = Math.floor((x / mid) * data.length);
        const val = Math.abs(data[idx]); // Use absolute value for size
        
        // Calculate height of the block based on amplitude
        const blockHeight = Math.floor(val * height * 0.8); // Increased scale
        
        if (blockHeight > 0) {
            // Center vertically
            const startY = Math.max(0, cy - Math.floor(blockHeight / 2));
            const endY = Math.min(height - 1, cy + Math.ceil(blockHeight / 2));
            
            for (let y = startY; y <= endY; y++) {
                const char = "█";
                if (mid + x < width) lines[y][mid + x] = char;
                if (mid - 1 - x >= 0) lines[y][mid - 1 - x] = char; // Mirror
            }
        }
    }
    return lines.map(l => l.join("")).join("\n");
}

function renderVizMode6(data, width, height, metrics) {
    // "Cosmic Runes" - Particle-based swirls with strange glyphs
    if (!renderVizMode6.particles) renderVizMode6.particles = [];
    if (!renderVizMode6.cooldown) renderVizMode6.cooldown = 0;
    
    const maxVal = metrics.rms;
    renderVizMode6.cooldown--;

    // Spawn burst on heavy volume
    if (maxVal > 0.15 && renderVizMode6.cooldown <= 0) {
        const safeColors = [1, 2, 4, 5];
        const colorIdx = safeColors[Math.floor(Math.random() * safeColors.length)];
        // Heavy boxy glyphs
        const glyphs = ["█", "▓", "▒", "░", "■", "▀", "▄", "▌", "▐", "▖", "▗", "▘", "▙", "▚", "▛", "▜", "▝", "▞", "▟"];
        const char = glyphs[Math.floor(Math.random() * glyphs.length)];
        
        // Spawn a ring of particles
        const count = 20 + Math.floor(maxVal * 40);
        const speed = 0.3 + maxVal * 1.2; // Slower movement
        const rotation = (Math.random() - 0.5) * 0.1; // Slower rotation
        
        for(let i=0; i<count; i++) {
            const angle = (i / count) * Math.PI * 2;
            renderVizMode6.particles.push({
                x: width/2,
                y: height/2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                rot: rotation,
                char: char,
                colorIdx: colorIdx,
                life: 1.0,
                decay: 0.005 + Math.random() * 0.015 // Slower decay
            });
        }
        renderVizMode6.cooldown = 5;
    }

    // Update particles
    for (let i = renderVizMode6.particles.length - 1; i >= 0; i--) {
        const p = renderVizMode6.particles[i];
        
        // Move
        p.x += p.vx;
        p.y += p.vy;
        
        // Rotate velocity vector (swirl effect)
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const nx = p.vx * cos - p.vy * sin;
        const ny = p.vx * sin + p.vy * cos;
        p.vx = nx;
        p.vy = ny;
        
        // Decay
        p.life -= p.decay;
        
        if (p.life <= 0 || p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) {
            renderVizMode6.particles.splice(i, 1);
        }
    }

    // Render Grid
    const grid = [];
    for(let y=0; y<height; y++) {
        const row = [];
        for(let x=0; x<width; x++) {
            row.push({ char: " ", colorClass: "", style: "" });
        }
        grid.push(row);
    }

    // Draw particles (Newest on top)
    renderVizMode6.particles.forEach(p => {
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        
        if (x >= 0 && x < width && y >= 0 && y < height) {
            grid[y][x] = {
                char: p.char,
                colorClass: `viz-color-${p.colorIdx}`,
                style: `opacity: ${p.life}`
            };
        }
    });

    // Convert to HTML
    return grid.map(row => {
        const lineHtml = row.map(cell => {
            if (cell.char === " ") return " ";
            return `<span class="${cell.colorClass}" style="${cell.style}">${cell.char}</span>`;
        }).join("");
        return `<div class="viz-row">${lineHtml}</div>`;
    }).join("");
}

async function handlePlay(mode = 'pattern') {
  if (!audio.ready) {
    await Tone.start();
    setupAudio();
  }
  
  audio.playMode = mode;

  // Store original pattern to restore on stop
  state.originalEditingPatternIdx = state.editingPatternIdx;

  if (mode === 'song') {
      // Find first enabled pattern
      let startIdx = 0;
      for (let i = 0; i < 4; i++) {
          if (state.patternEnable[i]) {
              startIdx = i;
              break;
          }
      }
      audio.playingPatternIdx = startIdx;
  } else {
      // Sync playing pattern to currently edited pattern
      audio.playingPatternIdx = state.editingPatternIdx;
  }

  // Apply settings for this pattern immediately
  applyWaveformToVoices(state.patterns[audio.playingPatternIdx].channelSettings);
  
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  audio.currentStep = 0;
  updatePlayheadUI(0);
  updatePatternUI(); // Update pattern indicators
  Tone.Transport.start();
  audio.playing = true;
  updateTransportUI();
}

function handleStop() {
  if (!audio.ready) return;
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  audio.currentStep = 0;
  audio.playing = false;
  
  // Restore original editing pattern
  if (typeof state.originalEditingPatternIdx === "number") {
      state.editingPatternIdx = state.originalEditingPatternIdx;
      state.pattern = state.patterns[state.editingPatternIdx];
      // Re-render UI to show original pattern
      renderSynthStack();
      renderDrumBox();
      const oldControls = document.getElementById("pattern-controls");
      if (oldControls) oldControls.replaceWith(renderPatternControls());
  }

  // Sync playing pattern to currently edited pattern so playhead appears there
  audio.playingPatternIdx = state.editingPatternIdx;
  // Apply settings for this pattern so voices are ready
  applyWaveformToVoices(state.patterns[audio.playingPatternIdx].channelSettings);
  
  // Explicitly release voices to ensure silence
  Object.values(audio.synthVoices).forEach(voice => voice?.triggerRelease?.());
  audio.arpSynth?.triggerRelease?.();
  
  updatePlayheadUI(0);
  updatePatternUI();
  updateTransportUI();
}

function updateTransportUI() {
    const playBtn = document.getElementById("transport-play-btn");
    const playAllBtn = document.getElementById("transport-play-all-btn");
    const globalPlaySongBtn = document.getElementById("global-play-song-btn");
    const globalPlayPatternBtn = document.getElementById("global-play-pattern-btn");
    
    if (playBtn) playBtn.classList.remove("playing");
    if (playAllBtn) playAllBtn.classList.remove("playing");
    if (globalPlaySongBtn) globalPlaySongBtn.classList.remove("playing");
    if (globalPlayPatternBtn) globalPlayPatternBtn.classList.remove("playing");

    if (audio.playing) {
        if (audio.playMode === 'song') {
            if (playAllBtn) playAllBtn.classList.add("playing");
            if (globalPlaySongBtn) globalPlaySongBtn.classList.add("playing");
        } else {
            if (playBtn) playBtn.classList.add("playing");
            if (globalPlayPatternBtn) globalPlayPatternBtn.classList.add("playing");
        }
    }
}

function withAudioReady(callback) {
  if (audio.ready) {
    callback();
    return;
  }
  if (!audio.bootstrapPromise) {
    audio.bootstrapPromise = Tone.start()
      .then(() => {
        setupAudio();
      })
      .finally(() => {
        audio.bootstrapPromise = null;
      });
  }
  audio.bootstrapPromise.then(() => {
    callback();
  });
}

function setupAudio() {
  // Create buses
  audio.cleanBus = new Tone.Gain(1);
  // Increased bit depth from 4 to 8 for clearer, less distorted sound while keeping retro feel
  audio.crushedBus = new Tone.BitCrusher(8);
  
  // Limiter and Master Output
  const limiter = new Tone.Limiter(-2);
  audio.master = limiter;
  
  // Connect buses to limiter
  audio.cleanBus.connect(limiter);
  audio.crushedBus.connect(limiter);
  
  // Connect limiter to destination
  limiter.toDestination();

  // Analyser connected to limiter output to see everything
  audio.analyser = new Tone.Waveform(256);
  limiter.connect(audio.analyser);

  // Initialize Channel Gains
  ["drums", "bass", "lead", "arp"].forEach((channel) => {
    const gain = CHANNEL_DEFAULT_GAIN[channel] ?? 0.85;
    audio.channelGains[channel] = new Tone.Gain(gain);
  });

  // Drum Delay Effect
  audio.drumDelay = new Tone.FeedbackDelay({
    delayTime: "4n",
    feedback: 0.2,
    wet: 0
  });
  
  // Connect Drum Delay to Crushed Bus (or Clean Bus? Retro style usually crushed)
  // We will route drums -> drumDelay -> crushedBus
  audio.drumDelay.connect(audio.crushedBus);

  audio.modEffects = {};

  // Default Routing: Drums and Arp to Crushed Bus
  // audio.channelGains.drums.connect(audio.crushedBus); // OLD
  audio.channelGains.drums.connect(audio.drumDelay); // NEW: Route through delay
  audio.channelGains.arp.connect(audio.crushedBus);
  // Ensure Bass and Lead are connected to something by default so they are audible on first play
  // applyWaveformToVoices will override this if successful, but this prevents silence on init
  if (audio.channelGains.bass) audio.channelGains.bass.connect(audio.crushedBus);
  if (audio.channelGains.lead) audio.channelGains.lead.connect(audio.crushedBus);

  audio.drumVoices = createDrumVoices(audio.channelGains.drums);

  audio.synthVoices.bass = createChipVoice("bass", audio.channelGains.bass);
  audio.synthVoices.lead = createChipVoice("lead", audio.channelGains.lead);
  
  // Apply waveforms and route bass/lead accordingly
  applyWaveformToVoices();

  // Arp Synth with Filter and LFO for "Flanger/Sweep" effect
  // LFO synced to 2 measures (Pattern Length)
  // Starts at -90deg (Min) -> Max -> Min
  audio.arpFilterLfo = new Tone.LFO({
    frequency: "2m",
    min: 200,
    max: 2000,
    type: "triangle",
    phase: 270 
  }).sync().start(0);

  audio.arpSynth = new Tone.MonoSynth({
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 },
    filter: { type: "lowpass", rolloff: -12, Q: 2 }
  }).connect(audio.channelGains.arp);

  audio.arpFilterLfo.connect(audio.arpSynth.filter.frequency);

  audio.stepLoop = new Tone.Loop((time) => advanceStep(time), STEP_DURATION);
  audio.stepLoop.start(0);

  audio.arpLoop = new Tone.Loop((time) => advanceArp(time), ARP_DURATION);
  audio.arpLoop.start(0);

  Tone.Transport.bpm.value = state.tempo;
  Tone.Transport.swing = state.swing / 100;
  Tone.Transport.loop = true;
  Tone.Transport.loopEnd = `${SYNTH_BARS}m`;
  
  // Improve timing lookahead
  Tone.context.lookAhead = 0.1;
  
  audio.ready = true;
}

function createChipVoice(key, outputBus) {
  // Create Vibrato effect for "Mod" knob
  const vibrato = new Tone.Vibrato({
    frequency: 5,
    depth: 0,
    wet: 1
  }).connect(outputBus);
  
  if (audio.modEffects) {
    audio.modEffects[key] = vibrato;
  }

  return new Tone.MonoSynth({
    oscillator: { type: "square" }, 
    envelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.1 }, 
    // Open up the filter significantly to let the waveform character through
    filter: { type: "lowpass", rolloff: -12, Q: 1 }, 
    filterEnvelope: {
      attack: 0.002,
      decay: 0.2,
      sustain: 1.0, // Full sustain on filter to hear the raw wave
      release: 0.2,
      baseFrequency: 200, 
      octaves: 7 // Sweep up to ~25kHz (full range)
    }
  }).connect(vibrato);
}

function applyWaveformToVoices(settings) {
  if (!audio.synthVoices) return;
  
  // Use provided settings or fallback to playing pattern
  const currentSettings = settings || state.patterns[audio.playingPatternIdx]?.channelSettings;
  if (!currentSettings) return;

  Object.entries(audio.synthVoices).forEach(([key, voice]) => {
    if (!voice) return;
    // Defaults: Bass=Square, Lead=Sawtooth
    const defaultWave = key === "bass" ? "square" : "sawtooth";
    const wave = currentSettings[key]?.wave || defaultWave;
    
    voice.set({ oscillator: { type: wave } });

    // Update routing based on waveform
    // Sine goes to clean bus, others to crushed bus
    if (audio.channelGains[key]) {
      audio.channelGains[key].disconnect();
      if (wave === "sine") {
        audio.channelGains[key].connect(audio.cleanBus);
      } else {
        // For Saw/Square, we want them distinct.
        // If bitcrusher is too heavy, they sound same.
        // But we increased bit depth to 8.
        // Let's ensure the oscillator type is set correctly.
        // Tone.js "square" and "sawtooth" are standard.
        // Maybe use "fmsquare" or "fmsawtooth" for more character?
        // Or "pwm" for square?
        // Let's stick to standard but maybe add a slight detune or chorus if needed?
        // For now, just route to crushed bus.
        audio.channelGains[key].connect(audio.crushedBus);
      }
    }
  });

  // Handle Arp Waveform
  if (audio.arpSynth) {
      const wave = currentSettings.arp?.wave || "square";
      // Use "fmsquare" / "fmsawtooth" for Arp to make it stand out? No, keep consistent.
      audio.arpSynth.set({ oscillator: { type: wave } });
      
      if (audio.channelGains.arp) {
          audio.channelGains.arp.disconnect();
          if (wave === "sine") {
              audio.channelGains.arp.connect(audio.cleanBus);
          } else {
              audio.channelGains.arp.connect(audio.crushedBus);
          }
      }
  }
}

function createDrumVoices(bus) {
  return {
    K: new Tone.MembraneSynth({
      pitchDecay: 0.01, // Reduced pitch decay for cleaner kick
      octaves: 4, // Reduced octaves for less "laser" sound
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 } // Longer decay
    }).connect(bus),
    S: new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 } // Slightly shorter decay
    }).connect(bus),
    C: new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 }
    }).connect(bus),
    H: new Tone.MetalSynth({
      frequency: 200,
      envelope: { attack: 0.0001, decay: 0.05, release: 0.02 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5
    }).connect(bus),
    P: new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 1.2, // Reduced from 4 to avoid laser sound
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 }
    }).connect(bus),
    B: new Tone.MetalSynth({
      frequency: 3200,
      envelope: { attack: 0.001, decay: 0.2, release: 1.5 }, // Short decay for "quick" hits, long release for ring
      harmonicity: 4.0, // Reduced for less brightness
      modulationIndex: 40, // Reduced for less brightness
      resonance: 3000,
      octaves: 1.5,
      volume: -5 // Lowered volume
    }).connect(bus)
  };
}

function getArpBurstCount() {
  try {
    const stepSeconds = Tone.Time(STEP_DURATION).toSeconds();
    const arpSeconds = Tone.Time(ARP_DURATION).toSeconds();
    return Math.max(1, Math.round(stepSeconds / arpSeconds));
  } catch (err) {
    return 4;
  }
}
function advanceStep(time) {
  // Safety check: If transport is stopped, do not trigger sounds.
  // This prevents "ghost" notes when stopping and resetting position.
  if (Tone.Transport.state !== "started") return;

  // Determine which pattern to play
  // If editing pattern is same as playing pattern, use state.pattern (live edits)
  // If editing pattern is same as playing pattern, use state.pattern (live edits)
  // Otherwise use stored pattern
  const currentPattern = (audio.playingPatternIdx === state.editingPatternIdx) 
      ? state.pattern 
      : state.patterns[audio.playingPatternIdx];

  const synthStep = audio.currentStep;
  const drumStep = synthStep % DRUM_STEPS;
  
  triggerDrums(currentPattern, drumStep, time);
  synthTracks.forEach((track) => triggerSynthTrack(currentPattern, track.key, synthStep, time));
  
  Tone.Draw.schedule(() => updatePlayheadUI(synthStep), time);
  
  const nextStep = (audio.currentStep + 1) % SYNTH_STEPS;
  
  // Check for pattern switch at end of bar
  if (nextStep === 0) {
      let nextPatternIdx = audio.playingPatternIdx;
      
      if (audio.nextPatternIdx !== null) {
          nextPatternIdx = audio.nextPatternIdx;
          audio.nextPatternIdx = null;
      } else if (audio.playMode === 'song') {
          // Find next enabled pattern
          for (let i = 1; i <= 4; i++) {
              const checkIdx = (audio.playingPatternIdx + i) % 4;
              if (state.patternEnable[checkIdx]) {
                  nextPatternIdx = checkIdx;
                  break;
              }
          }
      } else {
          // Loop current pattern
          nextPatternIdx = audio.playingPatternIdx;
      }

      audio.playingPatternIdx = nextPatternIdx;
      
      // Apply new pattern settings to audio engine
      applyWaveformToVoices(state.patterns[nextPatternIdx].channelSettings);

      // Update UI to show which pattern is playing AND follow playhead
      Tone.Draw.schedule(() => {
          // Follow Playhead: Switch view to the new playing pattern
          if (state.editingPatternIdx !== nextPatternIdx) {
              state.editingPatternIdx = nextPatternIdx;
              state.pattern = state.patterns[nextPatternIdx];
              renderSynthStack();
              renderDrumBox();
              const oldControls = document.getElementById("pattern-controls");
              if (oldControls) oldControls.replaceWith(renderPatternControls());
          }
          updatePatternUI();
      }, time);
  }
  
  audio.currentStep = nextStep;
}

function triggerDrums(pattern, stepIndex, time) {
  // Check Global Drum Mute
  if (state.pattern.channelSettings?.drums?.muted) return;

  for (const lane of drumLanes) {
    const level = pattern.drums[lane.key][stepIndex];
    if (level > 0) {
      const velocity = level === 2 ? 1 : 0.55;
      playDrum(lane.token, time, velocity);
    }
  }
}

function triggerSynthTrack(pattern, channelKey, stepIndex, time) {
  // Check Mute State
  if (pattern.channelSettings?.[channelKey]?.muted) return;

  const step = pattern[channelKey][stepIndex];
  if (!step || (step.velocity || step.level || 0) <= 0) return;
  if (channelKey === "arp") {
    const note = formatNoteForTrack(channelKey, typeof step.note === "number" ? step.note : step.degree);
    const chord = buildChord(note, step.chordId);
    if (chord.length) {
      // Calculate note duration based on decay (1-10)
      const decay = pattern.channelSettings?.[channelKey]?.decay ?? 4;
      let duration = "64n"; 
      
      // Map decay to duration for Arp
      if (decay >= 8) duration = "8n";
      else if (decay >= 5) duration = "16n";
      else if (decay >= 3) duration = "32n";
      
      const maxDecay = TRACK_MAX_DECAY[channelKey] ?? 6.0;
      const decayTime = decayToSeconds(decay, maxDecay);
      
      // Update Arp Envelope based on decay setting
      if (audio.arpSynth) {
          audio.arpSynth.envelope.decay = decayTime;
          audio.arpSynth.envelope.release = decayTime;
      }

      // Calculate bursts based on max(stepDuration, decayTime)
      const stepSeconds = Tone.Time(STEP_DURATION).toSeconds();
      const totalSeconds = Math.max(stepSeconds, decayTime);
      const arpNoteSeconds = Tone.Time(ARP_DURATION).toSeconds();
      const bursts = Math.ceil(totalSeconds / arpNoteSeconds);

      audio.arpState = {
        active: true,
        notes: chord,
        index: 0,
        remainingBursts: bursts,
        totalBursts: bursts,
        velocity: velocityToGain(step.velocity || step.level || DEFAULT_STEP_VELOCITY),
        noteDuration: duration
      };
    }
    return;
  }

  const voice = audio.synthVoices[channelKey];
  if (!voice) return;
  const directionOffset = clamp(step.direction || 0, -1, 1);
  const baseNote = typeof step.note === "number" ? step.note : step.degree;
  const directed = clampNoteIndex(baseNote + directionOffset);
  const note = noteIndexToLabel(directed);
  const velocity = velocityToGain(step.velocity || step.level || DEFAULT_STEP_VELOCITY);
  
  // Use track decay setting if available, otherwise fallback to step decay or default
  const trackDecay = state.pattern.channelSettings?.[channelKey]?.decay;
  const effectiveDecay = typeof trackDecay === 'number' ? trackDecay : (step.decay ?? DEFAULT_STEP_DECAY);
  const duration = decayToSeconds(effectiveDecay);
  
  // Apply Mod Effect (Vibrato)
  if (audio.modEffects && audio.modEffects[channelKey]) {
      const modVal = step.mod || 0; // 0-100
      // Map 0-100 to depth 0-1
      audio.modEffects[channelKey].depth.value = modVal / 100;
  }

  // Set envelope decay to match desired duration
  // Since sustain is 0, the note will fade out over 'decay' time.
  voice.envelope.decay = duration;
  voice.envelope.release = duration; // Ensure release matches decay for consistency if cut
  
  // Trigger attack with release. 
  // Even though sustain is 0, we use triggerAttackRelease to ensure the envelope resets properly
  // and to handle voice stealing correctly.
  // We add a small buffer to duration to ensure the full decay plays out if not interrupted.
  voice.triggerAttackRelease(note, duration + 0.1, time, velocity);
}

function playDrum(token, time, velocity) {
  const voice = audio.drumVoices[token];
  if (!voice) return;
  const spec = drumNoteMap[token] || {};
  const duration = spec.duration || "16n";
  const pitch = spec.pitch || "C4";
  const db = Tone.gainToDb(velocity || 1);
  voice.volume.value = db;
  
  if (token === "B") {
      // Quad trigger for "Jing-Jing... Jing-Jing" effect
      // First pair
      voice.triggerAttackRelease(pitch, duration, time);
      try {
        voice.triggerAttackRelease(pitch, duration, time + 0.05);
        // Second pair (approx 150ms later)
        voice.triggerAttackRelease(pitch, duration, time + 0.15);
        voice.triggerAttackRelease(pitch, duration, time + 0.20);
      } catch (e) {
        // Ignore overlap errors during rapid preview
      }
      return;
  }

  if (voice instanceof Tone.NoiseSynth) {
    voice.triggerAttackRelease(duration, time);
  } else {
    voice.triggerAttackRelease(pitch, duration, time, velocity);
  }
}

function previewDrumLane(laneKey, level = 2) {
  const lane = drumLanes.find((entry) => entry.key === laneKey);
  if (!lane) return;
  const velocity = level === 2 ? 1 : 0.55;
  withAudioReady(() => {
    playDrum(lane.token, Tone.now(), velocity);
  });
}

function previewSynthStep(channelKey, index) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const noteIndex = clampNoteIndex(
    typeof step.note === "number" ? step.note : getTrackDefaultNoteIndex(channelKey)
  );
  const note = noteIndexToLabel(noteIndex);
  let velocity = velocityToGain(step.velocity || DEFAULT_STEP_VELOCITY);
  
  if (channelKey === "arp") {
      // Boost Arp volume range (0.32-0.95 -> 0.32-1.5)
      // v' = (v - 0.32) * 1.87 + 0.32
      // Simplified: (v - 0.25) * 1.8 + 0.25
      velocity = (velocity - 0.25) * 1.8 + 0.25;
  }

  const trackDecay = state.pattern.channelSettings?.[channelKey]?.decay;
  const effectiveDecay = typeof trackDecay === 'number' ? trackDecay : (step.decay ?? DEFAULT_STEP_DECAY);
  const maxDecay = TRACK_MAX_DECAY[channelKey] ?? 6.0;
  const duration = channelKey === "arp" ? ARP_DURATION : decayToSeconds(effectiveDecay, maxDecay);

  withAudioReady(() => {
    const time = Tone.now();
    if (channelKey === "arp") {
      if (audio.arpSynth) {
          // Play a quick arpeggio burst to simulate the effect
          const rootMidi = Tone.Frequency(note).toMidi();
          const chordOffsets = [0, 4, 7]; // Major chord
          const arpSpeed = Tone.Time(ARP_DURATION).toSeconds();
          
          chordOffsets.forEach((offset, i) => {
              const noteName = Tone.Frequency(rootMidi + offset, "midi").toNote();
              const noteTime = time + (i * arpSpeed);
              audio.arpSynth.triggerAttackRelease(noteName, duration, noteTime, velocity);
          });
      }
      return;
    }
    const voice = audio.synthVoices[channelKey];
    if (!voice) return;
    
    // Update envelope for this hit
    const decayTime = decayToSeconds(effectiveDecay, maxDecay);
    voice.envelope.decay = decayTime;
    voice.envelope.release = decayTime;
    
    // Trigger with a very short duration so it relies on decay/release
    voice.triggerAttackRelease(note, "32n", time, velocity);
  });
}

function buildChord(rootNote, chordId) {
  const chord = arpChordById[chordId] || defaultArpChord;
  const rootMidi = Tone.Frequency(rootNote).toMidi();
  return chord.intervals.map((interval) => Tone.Frequency(rootMidi + interval, "midi").toNote());
}

function advanceArp(time) {
  // Update LFO intensity based on current step's mod value
  // We use the main sequencer step to determine the mod value
  const step = state.pattern.arp[audio.currentStep];
  // Only update LFO if the step is active (has velocity/level)
  if (step && (step.velocity || step.level || 0) > 0 && audio.arpFilterLfo) {
      const mod = step.mod || 0;
      const intensity = mod / 100;
      const base = 200;
      // Sweep range increases with mod value
      const range = 4000 * intensity; 
      
      // Update LFO min/max
      // We set them directly. Tone.LFO updates on next cycle or immediately?
      // It usually updates immediately for next calculation.
      audio.arpFilterLfo.min = base;
      audio.arpFilterLfo.max = base + range;
  }

  if (!audio.arpState.active || !audio.arpState.notes.length) return;
  const note = audio.arpState.notes[audio.arpState.index % audio.arpState.notes.length];
  audio.arpState.index += 1;
  
  const duration = audio.arpState.noteDuration || ARP_DURATION;
  
  let velocity = audio.arpState.velocity || 0.8;
  if (audio.arpState.totalBursts > 0) {
      // Fade out based on remaining bursts
      const progress = 1 - (audio.arpState.remainingBursts / audio.arpState.totalBursts);
      // Use a power curve for more natural decay
      velocity *= Math.pow(1 - progress, 2); 
  }

  audio.arpSynth.triggerAttackRelease(note, duration, time, velocity);
  
  audio.arpState.remainingBursts -= 1;
  if (audio.arpState.remainingBursts <= 0) {
    audio.arpState.active = false;
    audio.arpState.notes = [];
    audio.arpState.index = 0;
  }
}

function updatePlayheadUI(activeSynthStep = audio.currentStep) {
  // Show playhead on the currently viewed pattern, regardless of which pattern is playing audio.
  // This allows editing a pattern while another plays, with the playhead serving as a rhythmic guide.
  
  // Optimization: Use requestAnimationFrame to batch DOM updates if not already scheduled
  // But since this is called from the Tone.js loop, it might be better to keep it synchronous but minimal.
  // The current implementation already checks for value changes.
  
  const drumStep = activeSynthStep % DRUM_STEPS;
  
  // Cache references to avoid repeated lookups if possible, but refs is global.
  
  for (const lane of drumLanes) {
    const buttons = refs.stepButtons.drums[lane.key];
    if (!buttons) continue;
    
    // Optimization: Only touch the previous active step and the new active step
    // Instead of iterating all buttons.
    // But we don't track "previous active step" easily here without state.
    // Let's stick to the iteration but make it faster.
    
    for (let idx = 0; idx < buttons.length; idx++) {
        const btn = buttons[idx];
        const shouldBeActive = (idx === drumStep);
        // Direct DOM access is slow, but dataset access is also DOM access.
        // We check the current value first.
        if ((btn.dataset.playhead === "true") !== shouldBeActive) {
            btn.dataset.playhead = shouldBeActive ? "true" : "false";
        }
    }
  }

  for (const track of synthTracks) {
    const buttons = refs.stepButtons.synth[track.key];
    if (!buttons) continue;

    if (track.key === "arp") {
        for (let idx = 0; idx < buttons.length; idx++) {
            const btn = buttons[idx];
            const stepIndex = Math.floor(idx / 2);
            const shouldBeActive = (stepIndex === activeSynthStep);
            if ((btn.dataset.playhead === "true") !== shouldBeActive) {
                btn.dataset.playhead = shouldBeActive ? "true" : "false";
            }
        }
    } else {
        for (let idx = 0; idx < buttons.length; idx++) {
            const btn = buttons[idx];
            const shouldBeActive = (idx === activeSynthStep);
            if ((btn.dataset.playhead === "true") !== shouldBeActive) {
                btn.dataset.playhead = shouldBeActive ? "true" : "false";
            }
        }
    }
  }
}

async function handleSave(btn) {
  const snapshot = {
    tempo: state.tempo,
    swing: state.swing,
    scaleId: state.scaleId,
    trackName: state.trackName,
    currentUser: state.currentUser,
    patterns: JSON.parse(JSON.stringify(state.patterns)),
    patternEnable: [...state.patternEnable],
    visualizerMode: state.visualizerMode
  };
  
  try {
      await db.saveSong(snapshot);
      if (btn) {
          const originalText = btn.textContent;
          btn.textContent = "SAVED!";
          // Use a bright blue color for feedback
          btn.style.color = "var(--c64-cyan)"; 
          setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = "var(--c64-purple)";
          }, 3000);
      } else {
          alert("SONG SAVED TO DATABASE!");
      }
  } catch (e) {
      console.error(e);
      alert("SAVE FAILED: " + e);
  }
}

function loadUserScene(user, { slot = 0, silent = false } = {}) {
  state.currentUser = user;
  state.currentSlot = slot;
  const snapshot = loadSceneData(user, slot);
  
  if (snapshot) {
    applySnapshot(snapshot);
  } else if (!silent) {
    resetScene();
    state.lastSaveLength = null;
  }
  renderArtistMenu();
  renderIntro();
  renderVoiceField();
  
  return !!snapshot;
}

function applySnapshot(snapshot) {
  state.tempo = snapshot.tempo;
  state.swing = snapshot.swing;
  state.scaleId = snapshot.scaleId;
  state.trackName = snapshot.trackName || "UNTITLED";
  state.currentUser = snapshot.currentUser || "UNKNOWN";
  state.visualizerMode = snapshot.visualizerMode || 5;
  
  // Handle both new (Multi-Pattern) and old (Single-Pattern) formats
  if (snapshot.patterns) {
      state.patterns = snapshot.patterns;
      // Ensure 4 patterns
      while (state.patterns.length < 4) {
          state.patterns.push(buildDefaultPatternSet());
      }
      state.patternEnable = snapshot.patternEnable || [true, false, false, false];
  } else if (snapshot.pattern) {
      state.patterns = [
          clonePattern(snapshot.pattern),
          buildDefaultPatternSet(),
          buildDefaultPatternSet(),
          buildDefaultPatternSet()
      ];
      state.patternEnable = [true, false, false, false];
  } else {
      // Fallback
      state.patterns = [
          buildDefaultPatternSet(),
          buildDefaultPatternSet(),
          buildDefaultPatternSet(),
          buildDefaultPatternSet()
      ];
      state.patternEnable = [true, false, false, false];
  }
  
  // Reset to first pattern
  state.editingPatternIdx = 0;
  state.pattern = state.patterns[0];
  audio.playingPatternIdx = 0;
  
  // Ensure settings exist
  if (!state.pattern.channelSettings) {
      state.pattern.channelSettings = {
        bass: { wave: "square", decay: 6 },
        lead: { wave: "sawtooth", decay: 8 },
        arp: { wave: "square", decay: 2 }
      };
      // Legacy support
      if (snapshot.voice) {
          ["bass", "lead", "arp"].forEach(key => {
              state.pattern.channelSettings[key].wave = snapshot.voice;
          });
      }
  }
  
  initPatterns(); // Re-initialize pattern references if needed
  
  // Update Audio Engine
  Tone.Transport.bpm.value = state.tempo;
  Tone.Transport.swing = state.swing / 100;
  applyWaveformToVoices(state.pattern.channelSettings);
  
  // Apply Delay Settings
  if (state.pattern.channelSettings?.drums) {
      const settings = state.pattern.channelSettings.drums;
      if (audio.drumDelay) {
          if (settings.delayTime) audio.drumDelay.delayTime.value = settings.delayTime;
          if (settings.delayFeedback !== undefined) audio.drumDelay.feedback.value = settings.delayFeedback;
      }
  }
  
  // Update UI
  renderTransport();
  renderDrumBox();
  renderSynthStack();
  renderVisualizerControls();
  if (refs.visualizerBody) {
      refs.visualizerBody.className = `viz-mode-${state.visualizerMode}`;
  }
  
  // Update Pattern Controls
  const oldControls = document.getElementById("pattern-controls");
  if (oldControls) {
      const newControls = renderPatternControls();
      oldControls.replaceWith(newControls);
  }
  
  notifyStateChange();
}

function resetScene() {
  state.tempo = 120;
  state.swing = 0;
  Tone.Transport.swing = 0;
  state.scaleId = scaleOptions[0].id;
  
  // Force reset of all patterns
  state.patterns = [
      buildDefaultPatternSet(),
      buildDefaultPatternSet(),
      buildDefaultPatternSet(),
      buildDefaultPatternSet()
  ];
  
  state.patternEnable = [true, false, false, false];
  state.editingPatternIdx = 0;
  state.pattern = state.patterns[0];
  audio.playingPatternIdx = 0;
  
  renderTransport();
  renderVoiceField();
  renderDrumBox();
  renderSynthStack();
  
  // Update Pattern Controls
  const oldControls = document.getElementById("pattern-controls");
  if (oldControls) {
      const newControls = renderPatternControls();
      oldControls.replaceWith(newControls);
  }

  applyWaveformToVoices(state.pattern.channelSettings);
  updatePlayheadUI(0);
}

function initPatterns() {
    // Only initialize if empty
    if (!state.patterns || state.patterns.length === 0) {
        state.patterns = [
            buildDefaultPatternSet(),
            buildDefaultPatternSet(),
            buildDefaultPatternSet(),
            buildDefaultPatternSet()
        ];
    }
    state.pattern = state.patterns[state.editingPatternIdx || 0];
}

function bindGlobalKeys() {
  document.addEventListener("keydown", handleGlobalKeyDown);
}

function handleGlobalKeyDown(event) {
  // Ignore if typing in an input field, UNLESS it's Enter on a non-text input (like a slider)
  const isInput = event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA";
  if (isInput) {
      if (event.key === "Enter") {
          const isTextInput = event.target.type === "text" || event.target.tagName === "TEXTAREA";
          if (isTextInput) {
              // If in text input, Enter confirms and exits (blurs)
              event.preventDefault();
              event.target.blur();
              return;
          }
          // If in slider/button, let Enter pass through to trigger Play
      } else {
          // Block all other keys while in input
          return;
      }
  }

  // Undo / Redo
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
          redo();
      } else {
          undo();
      }
      return;
  }
  
  // Backspace / Delete to clear step
  if (event.key === "Backspace" || event.key === "Delete") {
      if (state.focusedStep) {
          event.preventDefault();
          const { channel, index, lane, subtype } = state.focusedStep;
          
          if (channel === "drums" && lane) {
              pushToHistory();
              state.pattern.drums[lane][index] = 0;
              // Update UI
              const btn = refs.stepButtons.drums[lane][index];
              if (btn) {
                  btn.dataset.level = "0";
                  btn.innerHTML = `<span class="btn-level">${LEVEL_SYMBOLS[0]}</span>`;
              }
              notifyStateChange();
          } else {
              // Synth / Arp
              let step;
              if (channel === "arp") step = state.pattern.arp[index];
              else step = state.pattern[channel][index];
              
              // Only toggle if it's active (velocity > 0)
              if (step && (step.velocity || 0) > 0) {
                  toggleSynthStep(channel, index);
              }
          }
      }
      return;
  }

  if (isOverlayVisible()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlotOverlay();
    }
    return;
  }

  // If Help is visible, close it on Escape
  if (refs.helpPanel && refs.helpPanel.style.display !== "none") {
      if (event.key === "Escape") {
          event.preventDefault();
          toggleHelp();
      }
      // Don't block other keys if help is open, but maybe we should?
      // For now, let's allow navigation even if help is open, or maybe not.
      // User said "everything we see on it is just pretty static and stationary".
      // If help replaces the grid, we probably can't navigate the grid.
      return; 
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (audio.playing) {
      const stopBtn = document.getElementById("transport-stop-btn");
      if (stopBtn) {
          stopBtn.classList.add("playing"); // Re-use playing class for green style
          setTimeout(() => stopBtn.classList.remove("playing"), 200);
      }
      handleStop();
    } else {
      if (event.shiftKey) {
          handlePlay('song');
      } else {
          handlePlay('pattern');
      }
    }
    return;
  }
  
  if (event.key === " ") {
    event.preventDefault();
    // If we have a focused step, use that. Otherwise fallback to active element if it's a button
    if (state.focusedStep) {
        const { channel, index, lane, subtype } = state.focusedStep;
        if (channel === "drums" && lane) {
            cycleDrumLevel(lane, index);
        } else if (channel === "arp") {
            if (subtype === "type") {
                toggleArpChordType(index);
            } else {
                toggleSynthStep(channel, index);
            }
        } else {
            toggleSynthStep(channel, index);
        }
    } else if (document.activeElement && document.activeElement.classList.contains("step-btn")) {
        handleStepActivation(document.activeElement);
    }
    return;
  }

  if (state.activeKnob && /^[0-9]$/.test(event.key)) {
    event.preventDefault();
    handleKnobNumberInput(state.activeKnob, Number(event.key));
    return;
  }

  // Direct volume editing for focused step
  if (state.focusedStep && /^[0-9]$/.test(event.key)) {
    event.preventDefault();
    setStepVelocity(state.focusedStep.channel, state.focusedStep.index, Number(event.key));
    return;
  }

  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    shiftKeyboardOctave(event.key === "]" ? 1 : -1);
    return;
  }

  let target = document.activeElement;
  if (!target || !target.classList.contains("step-btn")) {
    target = focusStoredStepButton();
    if (!target) return;
  }

  if (event.key === " ") {
    event.preventDefault();
    handleStepActivation(target);
    return;
  }

  if (target.dataset.type === "synth") {
    const keySpec = KEYBOARD_NOTE_MAP[event.key.toLowerCase()];
    if (keySpec) {
      event.preventDefault();
      handleNoteKeyInput(keySpec, target.dataset.channel, Number(target.dataset.index));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 1 : -1;
      if (event.shiftKey) {
        shiftStepOctave(target.dataset.channel, Number(target.dataset.index), delta);
      } else {
        shiftStepNote(target.dataset.channel, Number(target.dataset.index), delta);
      }
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 1 : -1;
      setStepSemitone(target.dataset.channel, Number(target.dataset.index), getStepSemitone(getSynthStep(target.dataset.channel, Number(target.dataset.index)), target.dataset.channel) + delta);
      return;
    }
  } else if (state.activeTrack) {
    // Allow playing notes on active track even if not focused on a step
    const keySpec = KEYBOARD_NOTE_MAP[event.key.toLowerCase()];
    if (keySpec) {
      event.preventDefault();
      playActiveTrackNote(keySpec);
      return;
    }
  }

  if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
    // Allow arrow keys in text inputs (like song name)
    if (document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement.type === "text") {
        return;
    }

    // Prevent default behavior (scrolling, slider change)
    event.preventDefault();
    
    let currentBtn = document.activeElement;

    // If focus is not on a step button (e.g. on a slider, body, or lost), force focus back to the grid
    if (!currentBtn || !currentBtn.classList.contains("step-btn")) {
        currentBtn = focusStoredStepButton();
        
        // If no stored focus, try to focus the first drum button
        if (!currentBtn) {
            currentBtn = refs.stepButtons.drums.kick?.[0];
            if (currentBtn) {
                currentBtn.focus();
                setFocusedStep("drums", 0, "kick");
            }
        }
        
        // If we still don't have a button, we can't move
        if (!currentBtn) return;
    }

    moveFocus(currentBtn, event.key);
  }
}

function playActiveTrackNote(spec) {
  const channelKey = state.activeTrack;
  if (!channelKey) return;
  
  const trackDefaultOctave = TRACK_DEFAULT_OCTAVE[channelKey] ?? 3;
  const baseOctave = clamp(trackDefaultOctave + (spec.octave || 0), 0, NOTE_RANGE_OCTAVES - 1);
  const noteIndex = clampNoteIndex(baseOctave * 12 + spec.semitone);
  const note = noteIndexToLabel(noteIndex);
  
  // Just play the note, don't record
  withAudioReady(() => {
    const time = Tone.now();
    const velocity = velocityToGain(DEFAULT_STEP_VELOCITY);
    
    if (channelKey === "arp") {
      // Use current decay setting for Arp
      const trackDecay = state.pattern.channelSettings?.arp?.decay ?? DEFAULT_ARP_DECAY;
      const maxDecay = TRACK_MAX_DECAY.arp ?? 2.0;
      const duration = decayToSeconds(trackDecay, maxDecay);
      
      // Play a quick arpeggio burst to simulate the effect
      // Chord: Root, +4 (Maj 3rd), +7 (5th)
      // We use the arpSynth
      if (audio.arpSynth) {
          const rootMidi = Tone.Frequency(note).toMidi();
          const chordOffsets = [0, 4, 7]; // Major chord
          const arpSpeed = Tone.Time(ARP_DURATION).toSeconds();
          
          // Calculate how many notes fit in the duration
          // Ensure at least one full chord cycle
          const totalNotes = Math.max(chordOffsets.length, Math.floor(duration / arpSpeed));
          
          for (let i = 0; i < totalNotes; i++) {
              const offset = chordOffsets[i % chordOffsets.length];
              const noteName = Tone.Frequency(rootMidi + offset, "midi").toNote();
              const noteTime = time + (i * arpSpeed);
              
              // Schedule the envelope and trigger
              audio.arpSynth.triggerAttackRelease(noteName, arpSpeed, noteTime, velocity);
          }
      }
      return;
    }
    
    const voice = audio.synthVoices[channelKey];
    if (!voice) return;
    
    const trackDecay = state.pattern.channelSettings?.[channelKey]?.decay ?? DEFAULT_STEP_DECAY;
    const maxDecay = TRACK_MAX_DECAY[channelKey] ?? 6.0;
    const duration = decayToSeconds(trackDecay, maxDecay);
    
    voice.envelope.release = duration;
    voice.triggerAttackRelease(note, duration, time, velocity);
  });
}
function handleStepActivation(button) {
  if (button.dataset.type === "drum") {
    cycleDrumLevel(button.dataset.lane, Number(button.dataset.index));
  } else if (button.dataset.type === "synth") {
    toggleSynthStep(button.dataset.channel, Number(button.dataset.index));
  }
}

function buildFocusGrid() {
  const rows = [];
  
  // Drums
  drumLanes.forEach((lane) => {
    const buttons = refs.stepButtons.drums[lane.key] || [];
    if (buttons.length > 0) {
        const rowIndex = rows.length;
        rows.push(buttons);
        buttons.forEach((btn, col) => {
          btn.dataset.focusRow = rowIndex.toString();
          btn.dataset.focusCol = col.toString();
        });
    }
  });

  // Synths
  synthTracks.forEach((track) => {
    if (track.key === "arp") {
        const allButtons = refs.stepButtons.synth[track.key] || [];
        const noteButtons = [];
        const typeButtons = [];
        
        for (let i = 0; i < allButtons.length; i += 2) {
            noteButtons.push(allButtons[i]);
            typeButtons.push(allButtons[i+1]);
        }
        
        if (noteButtons.length > 0) {
            const noteRowIndex = rows.length;
            rows.push(noteButtons);
            noteButtons.forEach((btn, col) => {
                btn.dataset.focusRow = noteRowIndex.toString();
                btn.dataset.focusCol = col.toString();
            });
        }
        
        if (typeButtons.length > 0) {
            const typeRowIndex = rows.length;
            rows.push(typeButtons);
            typeButtons.forEach((btn, col) => {
                btn.dataset.focusRow = typeRowIndex.toString();
                btn.dataset.focusCol = col.toString();
            });
        }
        
    } else {
        const buttons = refs.stepButtons.synth[track.key] || [];
        if (buttons.length > 0) {
            const rowIndex = rows.length;
            rows.push(buttons);
            buttons.forEach((btn, col) => {
              btn.dataset.focusRow = rowIndex.toString();
              btn.dataset.focusCol = col.toString();
            });
        }
    }
  });

  focusGrid.rows = rows;
}

function moveFocus(currentBtn, direction) {
  const rowIndex = Number(currentBtn.dataset.focusRow);
  const colIndex = Number(currentBtn.dataset.focusCol);
  if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return;

  const rows = focusGrid.rows;
  const currentRow = rows[rowIndex] || [];

  const clampColumn = (rowIdx, desiredCol) => {
    const row = rows[rowIdx] || [];
    if (!row.length) return null;
    const col = clamp(desiredCol, 0, row.length - 1);
    return row[col];
  };

  if (direction === "ArrowRight") {
    if (colIndex < currentRow.length - 1) {
      const next = currentRow[colIndex + 1];
      next.focus();
      updateFocusState(next);
    } else if (rowIndex < rows.length - 1) {
      const next = clampColumn(rowIndex + 1, 0);
      if (next) {
        next.focus();
        updateFocusState(next);
      }
    }
  } else if (direction === "ArrowLeft") {
    if (colIndex > 0) {
      const next = currentRow[colIndex - 1];
      next.focus();
      updateFocusState(next);
    } else if (rowIndex > 0) {
      const prevRow = rows[rowIndex - 1] || [];
      const next = clampColumn(rowIndex - 1, prevRow.length - 1);
      if (next) {
        next.focus();
        updateFocusState(next);
      }
    }
  } else if (direction === "ArrowDown") {
    if (rowIndex < rows.length - 1) {
      const next = clampColumn(rowIndex + 1, colIndex);
      if (next) {
        next.focus();
        updateFocusState(next);
      }
    }
  } else if (direction === "ArrowUp" && rowIndex > 0) {
    const next = clampColumn(rowIndex - 1, colIndex);
    if (next) {
      next.focus();
      updateFocusState(next);
    }
  }
}

function updateFocusState(btn) {
    if (!btn) return;
    const channel = btn.dataset.channel || "drums"; // Default to drums if channel missing (drum btns have type=drum)
    const lane = btn.dataset.lane;
    const index = Number(btn.dataset.index);
    const subtype = btn.dataset.subtype;
    
    if (btn.dataset.type === "drum") {
        setFocusedStep("drums", index, lane);
    } else {
        setFocusedStep(channel, index, null, subtype);
    }
}

function createButton(text, className, handler) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.className = className;
  btn.addEventListener("click", handler);
  return btn;
}

function createReadout(id, text) {
  const span = document.createElement("span");
  span.id = id;
  span.textContent = ` ${text} `;
  return span;
}

function createDivider() {
  const div = document.createElement("div");
  div.className = "section-divider";
  return div;
}

function setActiveKnob(type) {
  state.activeKnob = type;
}

function handleKnobClick(type, event) {
  if (state.suppressKnobClick) {
    state.suppressKnobClick = false;
    return;
  }
  const focus = state.focusedStep;
  if (!focus) return;
  
  // If step is empty, create it with default volume
  const step = getSynthStep(focus.channel, focus.index);
  if (!step) return;
  if ((step.velocity || 0) <= 0) {
      setStepVelocity(focus.channel, focus.index, DEFAULT_STEP_VELOCITY);
      // After creating, we can process the click as usual or just return
      // User said "If they are turned, a note should appear."
      // Click might be considered "turning" if it increments?
      // Let's allow the increment to happen immediately after creation
  }

  if (type === "note") {
    const semitone = getStepSemitone(step, focus.channel);
    setStepSemitone(focus.channel, focus.index, semitone + (event.shiftKey ? -1 : 1));
    return;
  }
  if (type === "octave") {
    shiftStepOctave(focus.channel, focus.index, event.shiftKey ? -1 : 1);
    return;
  }
  if (type === "volume") {
    const current = step.velocity || 0;
    const next = clamp(current + (event.shiftKey ? -1 : 1), 0, 9);
    setStepVelocity(focus.channel, focus.index, next);
    return;
  }
  if (type === "mod") {
    const current = step.mod || 0;
    const next = clamp(current + (event.shiftKey ? -5 : 5), 0, 100);
    step.mod = next;
    updateKnobDisplays();
    notifyStateChange();
    return;
  }
}

function handleKnobNumberInput(type, digit) {
  if (type === "note") {
    const focus = state.focusedStep;
    if (!focus) return;
    setStepSemitone(focus.channel, focus.index, digit);
    return;
  }
  if (type === "octave") {
    const focus = state.focusedStep;
    if (!focus) return;
    setStepOctave(focus.channel, focus.index, digit);
    return;
  }
  if (type === "volume") {
    const focus = state.focusedStep;
    if (!focus) return;
    setStepVelocity(focus.channel, focus.index, digit);
    return;
  }
}

function startKnobDrag(type, event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  pushToHistory();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  state.knobDrag = {
    type,
    pointerId: event.pointerId,
    anchorY: event.clientY,
    steps: 0,
    target,
    moved: false
  };
  window.addEventListener("pointermove", handleKnobDragMove);
  window.addEventListener("pointerup", handleKnobDragEnd);
  window.addEventListener("pointercancel", handleKnobDragEnd);
}

function handleKnobDragMove(event) {
  const drag = state.knobDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  const delta = drag.anchorY - event.clientY;
  const steps = Math.trunc(delta / KNOB_DRAG_STEP_PX);
  const diff = steps - drag.steps;
  if (diff !== 0) {
    applyKnobDrag(drag.type, diff);
    drag.steps = steps;
    drag.moved = true;
  }
}

function handleKnobDragEnd(event) {
  const drag = state.knobDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.target?.releasePointerCapture?.(drag.pointerId);
  state.knobDrag = null;
  state.suppressKnobClick = !!drag.moved;
  window.removeEventListener("pointermove", handleKnobDragMove);
  window.removeEventListener("pointerup", handleKnobDragEnd);
  window.removeEventListener("pointercancel", handleKnobDragEnd);
}

function applyKnobDrag(type, steps) {
  if (!steps) return;
  const focus = state.focusedStep;
  if (!focus) return;

  // If step is empty, create it with default volume
  const step = getSynthStep(focus.channel, focus.index);
  if (!step) return;
  
  // REMOVED: Auto-activation of step on knob drag.
  // if ((step.velocity || 0) <= 0) {
  //     setStepVelocity(focus.channel, focus.index, DEFAULT_STEP_VELOCITY);
  // }

  if (type === "note") {
    const semitone = getStepSemitone(step, focus.channel);
    setStepSemitone(focus.channel, focus.index, semitone + steps);
    return;
  }
  if (type === "octave") {
    shiftStepOctave(focus.channel, focus.index, steps);
    return;
  }
  if (type === "volume") {
    const current = step.velocity || 0;
    const next = clamp(current + steps, 0, 9);
    setStepVelocity(focus.channel, focus.index, next);
    return;
  }
  if (type === "mod") {
    const current = step.mod || 0;
    const next = clamp(current + steps * 5, 0, 100);
    step.mod = next;
    updateKnobDisplays();
    notifyStateChange();
    return;
  }
}

function updateKnobDisplays() {
  const step = getFocusedStep();
  const channel = state.focusedStep?.channel;
  const hasNote = step && (step.velocity > 0 || step.level > 0);
  
  // Check if we are in a synth track (not drums)
  const isSynthTrack = channel && channel !== "drums";
  const controls = document.getElementById("synth-controls");
  
  if (controls) {
      if (isSynthTrack) {
          controls.classList.remove("dimmed");
      } else {
          controls.classList.add("dimmed");
      }
  }

  // Helper to update active state
  const updateActiveState = (type, isActive) => {
      const btn = refs.knobs[type];
      const wrap = btn?.parentElement;
      if (btn) {
          if (isActive && isSynthTrack) {
              btn.classList.add("active");
              wrap?.classList.add("active");
          } else {
              btn.classList.remove("active");
              wrap?.classList.remove("active");
          }
      }
  };

  if (refs.knobValues.note) {
    if (hasNote) {
      const semitone = getStepSemitone(step, channel);
      const label = NOTE_NAMES[semitone] || "--";
      refs.knobValues.note.textContent = label;
    } else {
      refs.knobValues.note.textContent = "";
    }
    updateActiveState("note", true);
  }
  if (refs.knobValues.octave) {
    if (hasNote) {
      const octave = getStepOctave(step, channel);
      refs.knobValues.octave.textContent = `${octave}`;
    } else {
      refs.knobValues.octave.textContent = "";
    }
    updateActiveState("octave", true);
  }
  if (refs.knobValues.volume) {
    if (hasNote) {
      refs.knobValues.volume.textContent = `${step.velocity || 0}`;
    } else {
      refs.knobValues.volume.textContent = "";
    }
    updateActiveState("volume", true);
  }
  if (refs.knobValues.mod) {
    if (hasNote) {
      refs.knobValues.mod.textContent = `${step.mod || 0}`;
    } else {
      refs.knobValues.mod.textContent = "";
    }
    updateActiveState("mod", true);
  }
  updateKnobAngles();
}

function updateKnobAngles() {
  setKnobAngleValue("note", getNoteKnobRatio());
  setKnobAngleValue("octave", getOctaveKnobRatio());
  setKnobAngleValue("volume", getVolumeKnobRatio());
  setKnobAngleValue("mod", getModKnobRatio());
}

function setKnobAngleValue(type, ratio) {
  const btn = refs.knobs[type];
  if (!btn) return;
  // If ratio is null (empty knob), set to default (min) instead of hiding
  // This keeps the knob "available" visually
  const safeRatio = (ratio !== null && Number.isFinite(ratio)) ? clamp(ratio, 0, 1) : 0;
  const angle = -135 + safeRatio * 270;
  btn.style.setProperty("--knob-angle", `${angle}deg`);
}

function getNoteKnobRatio() {
  const step = getFocusedStep();
  const channel = state.focusedStep?.channel;
  const hasNote = step && (step.velocity > 0 || step.level > 0);
  if (!hasNote) return null;
  const semitone = step ? getStepSemitone(step, channel) : 0;
  return clamp(semitone / (NOTE_NAMES.length - 1), 0, 1);
}

function getVolumeKnobRatio() {
  const step = getFocusedStep();
  const hasNote = step && (step.velocity > 0 || step.level > 0);
  if (!hasNote) return null;
  if (step) {
    return clamp((step.velocity || 0) / 9, 0, 1);
  }
  return 0;
}

function getOctaveKnobRatio() {
  const step = getFocusedStep();
  const channel = state.focusedStep?.channel;
  const hasNote = step && (step.velocity > 0 || step.level > 0);
  if (!hasNote) return null;
  const octave = step ? getStepOctave(step, channel) : getTrackDefaultOctave(channel ?? "bass");
  return clamp(octave / (NOTE_RANGE_OCTAVES - 1), 0, 1);
}

function getModKnobRatio() {
  const step = getFocusedStep();
  const hasNote = step && (step.velocity > 0 || step.level > 0);
  if (!hasNote) return null;
  return clamp((step.mod || 0) / 100, 0, 1);
}

function setFocusedStep(channelKey, index, laneKey = null, subtype = null) {
  state.focusedStep = { channel: channelKey, index, lane: laneKey, subtype };
  
  // Ensure the track is active when focused
  if (state.activeTrack !== channelKey) {
      setActiveTrack(channelKey);
  }
  
  // Update UI to reflect focus
  document.querySelectorAll(".focused-step").forEach(el => el.classList.remove("focused-step"));
  
  if (channelKey === "drums" && laneKey) {
      const btn = refs.stepButtons.drums[laneKey]?.[index];
      if (btn) btn.classList.add("focused-step");
  } else if (channelKey === "arp") {
      // Arp has two buttons per step in the array: [Note, Type, Note, Type...]
      // index is the step index (0-15)
      // We need to find the correct button.
      const buttons = refs.stepButtons.synth[channelKey];
      if (buttons) {
          const btnIndex = index * 2 + (subtype === "type" ? 1 : 0);
          const btn = buttons[btnIndex];
          if (btn) btn.classList.add("focused-step");
      }
  } else {
      const btn = refs.stepButtons.synth[channelKey]?.[index];
      if (btn) btn.classList.add("focused-step");
  }
  
  updateKnobDisplays();
}

function getFocusedStep() {
  if (!state.focusedStep) return null;
  return getSynthStep(state.focusedStep.channel, state.focusedStep.index);
}

function getSynthStep(channelKey, index) {
  return state.pattern[channelKey]?.[index];
}

function rememberGridFocus(button) {
  if (!button) return;
  const row = Number(button.dataset.focusRow);
  const col = Number(button.dataset.focusCol);
  if (Number.isNaN(row) || Number.isNaN(col)) return;
  state.lastFocus = { row, col };
}

function focusStoredStepButton() {
  if (!state.lastFocus) return null;
  const button = focusGrid.rows[state.lastFocus.row]?.[state.lastFocus.col];
  if (button) {
    button.focus();
  }
  return button || null;
}

function ensureStepDefaults(channelKey, index) {
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  if (typeof step.note !== "number") {
    step.note = getTrackDefaultNoteIndex(channelKey);
    step.degree = step.note;
  }
  if (typeof step.decay !== "number") {
    step.decay = DEFAULT_STEP_DECAY;
  }
  if (channelKey !== "arp" && typeof step.direction !== "number") {
    step.direction = 0;
  }
  if (channelKey === "arp" && !step.chordId) {
    step.chordId = defaultArpChord.id;
  }
  // Default volume for new steps
  if ((step.velocity || 0) <= 0) {
      step.velocity = (channelKey === "arp") ? 5 : DEFAULT_STEP_VELOCITY;
  }
}

function shiftKeyboardOctave(delta) {
  setKeyboardOctave(state.keyboardOctave + delta);
}

function setKeyboardOctave(octave) {
  const maxBase = Math.max(0, NOTE_RANGE_OCTAVES - 2);
  state.keyboardOctave = clamp(octave, 0, maxBase);
  updateKnobDisplays();
}

function handleNoteKeyInput(spec, channelKey, index) {
  // Use track-specific default octave as base
  const trackDefaultOctave = TRACK_DEFAULT_OCTAVE[channelKey] ?? 3;
  const baseOctave = clamp(trackDefaultOctave + (spec.octave || 0), 0, NOTE_RANGE_OCTAVES - 1);
  const noteIndex = clampNoteIndex(baseOctave * 12 + spec.semitone);
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  setStepNoteValue(channelKey, index, noteIndex);
  if ((step.velocity || 0) <= 0) {
    setStepVelocity(channelKey, index, DEFAULT_STEP_VELOCITY);
  }
  
  previewSynthStep(channelKey, index);

  // Auto-advance cursor REMOVED per user request
  /*
  const nextIndex = (index + 1) % SYNTH_STEPS;
  
  let nextBtn;
  if (channelKey === "arp") {
      setFocusedStep(channelKey, nextIndex, null, "note");
      nextBtn = refs.stepButtons.synth.arp[nextIndex * 2];
  } else {
      setFocusedStep(channelKey, nextIndex);
      nextBtn = refs.stepButtons.synth[channelKey]?.[nextIndex];
  }
  
  if (nextBtn) {
    nextBtn.focus();
  }
  */
}

function captureVisualizerSnapshot() {
  return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const size = 500;
      canvas.width = size;
      canvas.height = size;
      
      // Background
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, size, size);
      
      // Text
      ctx.fillStyle = "#55ff55"; // C64 Green-ish
      // Try to match the visualizer color if possible
      if (refs.visualizerBody) {
          const style = window.getComputedStyle(refs.visualizerBody);
          ctx.fillStyle = style.color || "#55ff55";
      }
      
      ctx.font = "20px monospace"; // Adjust size to fit
      ctx.textBaseline = "top";
      
      const text = refs.visualizerBody ? refs.visualizerBody.innerText : "";
      const lines = text.split("\n");
      
      // Center vertically
      const lineHeight = 22;
      const totalHeight = lines.length * lineHeight;
      const startY = (size - totalHeight) / 2;
      
      lines.forEach((line, i) => {
          // Center horizontally
          const metrics = ctx.measureText(line);
          const startX = (size - metrics.width) / 2;
          ctx.fillText(line, startX, startY + (i * lineHeight));
      });
      
      canvas.toBlob((blob) => {
          resolve(blob);
      }, "image/png");
  });
}

async function handleExportMp3() {
    // Ensure audio is ready (initialize if needed)
    if (!audio.ready) {
        try {
            await Tone.start();
            setupAudio();
        } catch (e) {
            console.error("Audio init failed", e);
            alert("Audio initialization failed. Please try playing the song first.");
            return;
        }
    }
    
    // Find button by ID or text
    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("EXPORT"));
    const originalText = btn ? btn.textContent : "[EXPORT WAV]";
    
    if (btn) btn.textContent = "[RECORDING...]";
    
    try {
        // Ensure context is running
        if (Tone.context.state !== "running") {
            await Tone.context.resume();
        }

        // Stop playback first
        handleStop();
        
        // Setup Recorder - Try to force WAV if supported, otherwise default
        // Note: Browser support for audio/wav in MediaRecorder is limited.
        // Tone.Recorder uses MediaRecorder.
        let recorder;
        try {
             recorder = new Tone.Recorder({ mimeType: "audio/wav", channels: 2 });
        } catch (e) {
             console.warn("audio/wav not supported, falling back to default");
             recorder = new Tone.Recorder({ channels: 2 });
        }

        if (!audio.master) throw new Error("Audio master not initialized");
        audio.master.connect(recorder);
        
        // Start Recording
        recorder.start();
        
        // Determine sequence
        const enabledIndices = state.patternEnable
            .map((enabled, idx) => enabled ? idx : -1)
            .filter(idx => idx !== -1);
            
        const firstIdx = enabledIndices.length > 0 ? enabledIndices[0] : state.editingPatternIdx;
        const count = enabledIndices.length || 1;
        
        // Set initial state
        audio.playingPatternIdx = firstIdx;
        applyWaveformToVoices(state.patterns[firstIdx].channelSettings);
        
        // Calculate duration
        const barDuration = Tone.Time("1m").toSeconds();
        // Record 2 loops of the entire sequence
        const loops = 2;
        const totalDuration = count * SYNTH_BARS * barDuration * loops;
        
        // Start Playback
        Tone.Transport.stop();
        Tone.Transport.position = 0;
        audio.currentStep = 0;
        updatePlayheadUI(0);
        Tone.Transport.start();
        audio.playing = true;
        updateTransportUI();
        
        // Capture Snapshot in the middle of the first pattern
        let snapshotBlob = null;
        const snapshotTime = (SYNTH_BARS * barDuration) / 2;
        
        setTimeout(async () => {
            try {
                snapshotBlob = await captureVisualizerSnapshot();
            } catch (e) {
                console.warn("Snapshot failed", e);
            }
        }, snapshotTime * 1000);

        // Wait for duration
        await new Promise(r => setTimeout(r, totalDuration * 1000));
        
        // Stop Playback (stops new notes)
        handleStop();
        
        // Wait for tail (2 seconds)
        await new Promise(r => setTimeout(r, 2000));
        
        // Stop Recording
        const recording = await recorder.stop();
        
        if (recording.size === 0) {
            throw new Error("Recording is empty. Audio context might be suspended.");
        }

        // Determine extension based on mimeType
        const mimeType = recorder.mimeType || "audio/webm";
        let ext = "wav"; // Default to wav as requested
        
        if (mimeType.includes("wav")) ext = "wav";
        else if (mimeType.includes("mp4")) ext = "mp4";
        else if (mimeType.includes("ogg")) ext = "ogg";
        else ext = "wav"; // Force wav extension even if webm, as requested

        // Download Locally
        const artist = (state.currentUser || "Unknown").trim();
        const track = (state.trackName || "Untitled").trim();
        
        // Format: Artist - song name - DD-MM-YYYY
        const dateStr = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
        const baseFilename = `${artist} - ${track} - ${dateStr}`;
        // Sanitize filename
        const safeFilename = baseFilename.replace(/[^a-z0-9 \-_]/gi, '');
        
        const filename = `${safeFilename}.${ext}`;
        
        // Create Download Link
        const url = URL.createObjectURL(recording);
        const anchor = document.createElement("a");
        anchor.style.display = "none";
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        
        // Cleanup
        setTimeout(() => {
            document.body.removeChild(anchor);
            window.URL.revokeObjectURL(url);
        }, 100);

        // Cleanup Audio
        audio.master.disconnect(recorder);
        recorder.dispose();
    } catch (e) {
        console.error("Export Error:", e);
        alert("Export failed: " + e.message);
    } finally {
        if (btn) btn.textContent = originalText;
    }
}

// Removed handleCloudExport as it is now merged into handleExportMp3

function setStepVelocity(channelKey, index, value) {
  pushToHistory();
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const next = clamp(Math.round(value), 0, 9);
  step.velocity = next;
  step.level = velocityToLevel(next);
  if (next > 0) {
    ensureStepDefaults(channelKey, index);
  }
  if (channelKey === "arp" && !step.chordId) {
    step.chordId = defaultArpChord.id;
  }
  if (channelKey !== "arp" && typeof step.direction !== "number") {
    step.direction = 0;
  }
  
  if (channelKey === "arp") {
      const btnNote = refs.stepButtons.synth.arp[index * 2];
      const btnType = refs.stepButtons.synth.arp[index * 2 + 1];
      if (btnNote && btnType) {
          renderArpButtons(btnNote, btnType, index);
      }
  } else {
      renderSynthButtonContent(refs.stepButtons.synth[channelKey][index], channelKey, index);
  }
  
  updateKnobDisplays();
  notifyStateChange();
}

function setStepDecay(channelKey, index, value) {
  if (channelKey === "arp") return;
  const step = getSynthStep(channelKey, index);
  if (!step) return;
  const next = clamp(Math.round(value), 0, 9);
  step.decay = next;
  updateKnobDisplays();
  notifyStateChange();
}



function initResponsiveViewport() {
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  
  const baseWidth = 1180;
  const baseHeight = 780;
  
  const handleResize = () => {
    // Subtract padding (2rem * 2 = ~64px) plus a bit of safety margin
    const padding = 80; 
    const availableWidth = window.innerWidth - padding;
    const availableHeight = window.innerHeight - padding;
    
    const scaleX = availableWidth / baseWidth;
    const scaleY = availableHeight / baseHeight;
    const scale = Math.min(1, scaleX, scaleY);
    
    viewport.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  
  window.addEventListener("resize", handleResize);
  handleResize();
}

function notifyStateChange() {
  // Auto-rename if editing the default song
  if (state.trackName === "DEMO SONG") {
      state.trackName = "NEW SONG";
      const input = document.getElementById("track-name-input");
      if (input) input.value = state.trackName;
  }
}

// Initialize Theme Controls
// Removed setupThemeControls as it is now handled in renderThemeControls

