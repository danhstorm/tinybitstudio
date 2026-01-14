import { drumLanes } from "./constants.js";
import { isArpChannel, clonePattern, createEmptyDrumPattern, createLinearSynthPattern, createArpPattern } from "./patterns.js";
import { clamp, velocityToLevel } from "./utils.js";

const CACHE_KEY = "tinybitstudio_autosave_cache";

export function getStorageKey(user, slot = 0) {
  return `tinybitstudio_slot_${user}_${slot}`;
}

// Autosave cache functions - saves full state for session recovery
export function saveCacheSnapshot(snapshot) {
  try {
    const payload = JSON.stringify(snapshot);
    localStorage.setItem(CACHE_KEY, payload);
    return true;
  } catch (e) {
    console.warn("Cache save failed:", e);
    return false;
  }
}

export function loadCacheSnapshot() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Cache load failed:", e);
    return null;
  }
}

export function clearCacheSnapshot() {
  localStorage.removeItem(CACHE_KEY);
}

export function saveSceneData(user, slot, snapshot) {
  const payload = encodeSnapshot(snapshot);
  localStorage.setItem(getStorageKey(user, slot), payload);
  return payload.length;
}

export function loadSceneData(user, slot) {
  const raw = localStorage.getItem(getStorageKey(user, slot));
  if (!raw) return null;
  return decodeSnapshot(raw);
}

export function encodeSnapshot(snapshot) {
  const version = 2;
  const parts = [
    `V${version}`,
    `Q${snapshot.tempo.toString(36)}`,
    `W${snapshot.swing.toString(36)}`,
    `C${snapshot.scaleId}`,
    `O${snapshot.voice}`,
    `D${encodeDrumSection(snapshot.pattern.drums)}`,
    `B${encodeSynthSection("bass", snapshot.pattern.bass, version)}`,
    `L${encodeSynthSection("lead", snapshot.pattern.lead, version)}`,
    `A${encodeSynthSection("arp", snapshot.pattern.arp, version)}`
  ];
  return parts.join("|");
}

function encodeDrumSection(drums) {
  return drumLanes
    .map(({ key }) => {
      const entries = drums[key]
        .map((level, index) => (level > 0 ? `${index.toString(36)}:${level}` : null))
        .filter(Boolean)
        .join(",");
      return `${key}=${entries}`;
    })
    .join(";");
}

function encodeSynthSection(channelKey, trackArray, version = 1) {
  return trackArray
    .map((step, index) => {
      const velocity = clamp(Math.round(step?.velocity ?? 0), 0, 9);
      if (velocity <= 0) return null;
      
      const note = (step.note || 0).toString(36);
      const vel = velocity.toString();
      
      if (isArpChannel(channelKey)) {
          const chord = step.chordId || "maj";
          return `${index.toString(36)}:${note}:${vel}:${chord}`;
      } else {
          const dir = (step.direction || 0).toString();
          const decay = (step.decay || 0).toString();
          return `${index.toString(36)}:${note}:${vel}:${dir}:${decay}`;
      }
    })
    .filter(Boolean)
    .join(",");
}

export function decodeSnapshot(dataString) {
  const sections = {};
  dataString.split("|").forEach((chunk) => {
    if (!chunk) return;
    const key = chunk[0];
    const payload = chunk.slice(1);
    sections[key] = payload;
  });
  const version = Number.parseInt(sections.V || "1", 10) || 1;
  const tempo = parseInt(sections.Q || "", 36);
  const swing = parseInt(sections.W || "", 36);
  
  return {
    tempo: Number.isFinite(tempo) ? tempo : 120,
    swing: Number.isFinite(swing) ? swing : 0,
    scaleId: sections.C || "major",
    voice: sections.O || "square",
    pattern: {
      drums: decodeDrumSection(sections.D || ""),
      bass: decodeSynthSection(sections.B || "", "bass", version),
      lead: decodeSynthSection(sections.L || "", "lead", version),
      arp: decodeSynthSection(sections.A || "", "arp", version)
    }
  };
}

function decodeDrumSection(payload) {
  const drums = createEmptyDrumPattern();
  payload.split(";").forEach((laneChunk) => {
    if (!laneChunk) return;
    const [laneKey, entries] = laneChunk.split("=");
    if (!drums[laneKey] || !entries) return;
    entries.split(",").forEach((entry) => {
      if (!entry) return;
      const [indexStr, levelStr] = entry.split(":");
      const index = parseInt(indexStr, 36);
      const level = Number(levelStr);
      // Assuming DRUM_STEPS is 32, but we don't have it here. 
      // We trust the index is valid or the array will just expand/ignore.
      if (Number.isFinite(index) && (level === 1 || level === 2)) {
        drums[laneKey][index] = level;
      }
    });
  });
  return drums;
}

function decodeSynthSection(payload, channelKey, version) {
  const pattern = isArpChannel(channelKey) ? createArpPattern(channelKey) : createLinearSynthPattern(channelKey);
  
  if (!payload) return pattern;
  
  payload.split(",").forEach((entry) => {
    if (!entry) return;
    const parts = entry.split(":");
    const index = parseInt(parts[0], 36);
    if (!pattern[index]) return;
    
    const note = parseInt(parts[1], 36);
    const velocity = Number(parts[2]);
    
    pattern[index].note = note;
    pattern[index].degree = note;
    pattern[index].velocity = velocity;
    pattern[index].level = velocityToLevel(velocity);
    
    if (isArpChannel(channelKey)) {
        pattern[index].chordId = parts[3] || "maj";
    } else {
        pattern[index].direction = Number(parts[3] || 0);
        pattern[index].decay = Number(parts[4] || 0); // Default will be handled by ensureStepDefaults if 0
    }
  });
  
  return pattern;
}
