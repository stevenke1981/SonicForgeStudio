import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { loadDesktopState } from "./lib/tauri";
import type { AudioStatus, DesktopState } from "./lib/tauri";
import "./styles.css";

type Mode = "Music" | "SFX Lab" | "Mixer";

type Clip = {
  id: number;
  name: string;
  left: number;
  width: number;
  tone: "cyan" | "amber" | "violet";
};

type Track = {
  id: number;
  name: string;
  icon: string;
  color: string;
  gain: number;
  pan: number;
  muted: boolean;
  clips: Clip[];
};

const modes: Mode[] = ["Music", "SFX Lab", "Mixer"];

const browserItems = [
  { label: "Starred", symbol: "✦" },
  { label: "Instruments", symbol: "◌" },
  { label: "Drum kits", symbol: "◈" },
  { label: "SFX recipes", symbol: "⌁" },
  { label: "Effects", symbol: "◎" },
  { label: "Samples", symbol: "▧" },
  { label: "Presets", symbol: "◇" },
];

const initialTracks: Track[] = [
  {
    id: 1,
    name: "Lead Synth",
    icon: "◌",
    color: "cyan",
    gain: 0.72,
    pan: 0,
    muted: false,
    clips: [{ id: 11, name: "Lead Pattern 01", left: 12, width: 230, tone: "cyan" }],
  },
  {
    id: 2,
    name: "Drum Machine",
    icon: "◈",
    color: "amber",
    gain: 0.64,
    pan: -0.08,
    muted: false,
    clips: [{ id: 21, name: "Drum Pattern A", left: 112, width: 286, tone: "amber" }],
  },
  {
    id: 3,
    name: "Laser FX",
    icon: "⌁",
    color: "violet",
    gain: 0.54,
    pan: 0.18,
    muted: false,
    clips: [{ id: 31, name: "Laser Seed 42", left: 12, width: 130, tone: "violet" }],
  },
];

const fallbackAudio: AudioStatus = {
  state: "unavailable",
  deviceName: null,
  sampleRate: 48_000,
  bufferSize: 256,
  xrunCount: 0,
  engineAvailable: false,
};

function formatTime(playing: boolean): string {
  return playing ? "00:03:12" : "00:00:00";
}

function App() {
  const [mode, setMode] = useState<Mode>("Music");
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [selectedTrackId, setSelectedTrackId] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState(11);
  const [selectedBrowserItem, setSelectedBrowserItem] = useState("Starred");
  const [seed, setSeed] = useState(42);
  const [locked, setLocked] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [timelineCleared, setTimelineCleared] = useState(false);
  const [toast, setToast] = useState("Ready for a new sound");
  const [loading, setLoading] = useState(true);
  const [desktop, setDesktop] = useState<DesktopState>({
    appInfo: {
      name: "SonicForge Studio",
      version: "0.1.0",
      platform: "browser-preview",
      shell: "web-preview",
    },
    audioStatus: fallbackAudio,
  });
  const nextClipId = useRef(100);

  useEffect(() => {
    let cancelled = false;
    loadDesktopState().then((state) => {
      if (!cancelled) {
        setDesktop(state);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (event.code === "Space" && event.target instanceof HTMLElement && event.target.tagName !== "INPUT") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedTrackId) ?? tracks[0],
    [selectedTrackId, tracks],
  );
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selectedClipId);
  const audioStatus = desktop.audioStatus ?? fallbackAudio;

  const announce = (message: string) => {
    setToast(message);
  };

  const updateTrack = (trackId: number, patch: Partial<Track>) => {
    setTracks((current) => current.map((track) => (track.id === trackId ? { ...track, ...patch } : track)));
  };

  const updateClip = (trackId: number, clipId: number, patch: Partial<Clip>) => {
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId
          ? { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)) }
          : track,
      ),
    );
  };

  const addClip = () => {
    const id = nextClipId.current++;
    const clip: Clip = { id, name: "New Pattern", left: 260, width: 160, tone: "cyan" };
    setTracks((current) =>
      current.map((track) => (track.id === selectedTrackId ? { ...track, clips: [...track.clips, clip] } : track)),
    );
    setTimelineCleared(false);
    setSelectedClipId(id);
    announce("New clip added to the selected track");
  };

  const duplicateClip = () => {
    if (!selectedTrack || !selectedClip) return;
    const id = nextClipId.current++;
    const copy = { ...selectedClip, id, name: `${selectedClip.name} copy`, left: selectedClip.left + selectedClip.width + 12 };
    updateTrack(selectedTrack.id, { clips: [...selectedTrack.clips, copy] });
    setSelectedClipId(id);
    announce("Clip duplicated");
  };

  const splitClip = () => {
    if (!selectedTrack || !selectedClip || selectedClip.width < 44) return;
    const leftWidth = Math.round(selectedClip.width / 2 - 4);
    const rightId = nextClipId.current++;
    const right: Clip = {
      ...selectedClip,
      id: rightId,
      name: `${selectedClip.name} / B`,
      left: selectedClip.left + leftWidth + 8,
      width: selectedClip.width - leftWidth - 8,
    };
    updateTrack(selectedTrack.id, {
      clips: selectedTrack.clips.flatMap((clip) =>
        clip.id === selectedClip.id
          ? [{ ...clip, name: `${clip.name} / A`, width: leftWidth }, right]
          : [clip],
      ),
    });
    setSelectedClipId(rightId);
    announce("Clip split at the playhead");
  };

  const moveClip = (event: DragEvent<HTMLButtonElement>, trackId: number, clipId: number) => {
    const clip = tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!clip) return;
    updateClip(trackId, clipId, { left: Math.max(8, clip.left + (event.clientX ? 16 : 0)) });
    announce("Clip moved on the grid");
  };

  const randomize = () => {
    setSeed((value) => (locked ? value : value + 17));
    announce(locked ? "Seed is locked — unlock it before randomizing" : "New deterministic seed generated");
  };

  const freezeSfx = () => {
    setMode("Music");
    addClip();
    announce(`Laser seed ${seed} frozen to the timeline`);
  };

  const togglePlay = () => {
    setPlaying((value) => !value);
    announce(playing ? "Transport paused" : "Transport playing");
  };

  const resetTransport = () => {
    setPlaying(false);
    announce("Transport stopped");
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="SonicForge Studio">
          <span className="brand-mark">SF</span>
          <span>
            <strong>SonicForge</strong>
            <small>STUDIO / 0.1</small>
          </span>
        </div>
        <nav className="menu-row" aria-label="Application menu">
          <button className="menu-button" type="button">File</button>
          <button className="menu-button" type="button">Edit</button>
          <button className="menu-button" type="button">Project</button>
        </nav>
        <div className="topbar-spacer" />
        <div className="transport" aria-label="Transport controls">
          <button className="icon-button" type="button" aria-label="Stop" onClick={resetTransport}>■</button>
          <button className={`icon-button play-button ${playing ? "is-playing" : ""}`} type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button className="icon-button record-button" type="button" aria-label="Record" disabled>●</button>
        </div>
        <label className="tempo-control">
          <span>BPM</span>
          <input aria-label="BPM" type="number" min="20" max="400" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
        </label>
        <span className="metric-pill">4 / 4</span>
        <span className="metric-pill timecode">{formatTime(playing)}</span>
        <div className="engine-status" title={desktop.error ?? "Tauri status command"}>
          <span className={`status-dot ${audioStatus.engineAvailable ? "online" : "offline"}`} />
          <span>{loading ? "CONNECTING" : audioStatus.engineAvailable ? "ENGINE READY" : "OFFLINE MOCK"}</span>
          <small>DSP {audioStatus.engineAvailable ? "--" : "18%"} · XRUN {audioStatus.xrunCount} · {audioStatus.bufferSize}f</small>
        </div>
        <button className="command-button" type="button" aria-label="Open command palette" onClick={() => setCommandPaletteOpen(true)}>
          <span>⌘K</span>
        </button>
      </header>

      <div className="mode-strip" role="tablist" aria-label="Workspace modes">
        {modes.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {item === "Music" ? "◌" : item === "SFX Lab" ? "⌁" : "▥"} {item}
          </button>
        ))}
      </div>

      <main className="workspace-grid">
        <aside className="browser-panel panel-surface">
          <div className="panel-heading">
            <span>Browser</span>
            <button type="button" className="tiny-button" aria-label="Add browser item" onClick={() => announce("Browser is ready for a new collection")}>＋</button>
          </div>
          <div className="search-field"><span>⌕</span><input aria-label="Search browser" placeholder="Search sounds" /></div>
          <div className="browser-list">
            {browserItems.map((item) => (
              <button key={item.label} type="button" className={`browser-item ${selectedBrowserItem === item.label ? "active" : ""}`} onClick={() => { setSelectedBrowserItem(item.label); announce(`${item.label} browser selected`); }}>
                <span className="browser-symbol">{item.symbol}</span><span>{item.label}</span><span className="item-count">{item.label === "Starred" ? "06" : "24"}</span>
              </button>
            ))}
          </div>
          <div className="browser-divider" />
          <div className="panel-subheading">RECIPES / BUILT-IN</div>
          <div className="recipe-list">
            {["Laser Pulse", "Deep Impact", "Fast Whoosh", "Soft UI Click", "Rain Ambience"].map((recipe, index) => (
              <button key={recipe} type="button" className={`recipe-item ${index === 0 ? "selected" : ""}`} onClick={() => { setMode("SFX Lab"); announce(`${recipe} loaded into SFX Lab`); }}>
                <span className={`recipe-dot dot-${index % 3}`} />{recipe}<span className="chevron">›</span>
              </button>
            ))}
          </div>
          <div className="browser-footnote"><span className="status-dot offline" /> Browser preview · {desktop.appInfo.platform}</div>
        </aside>

        <section className="main-panel panel-surface">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">PROJECT / SONICFORGE DEMO</div>
              <h1>{mode === "Music" ? "Song Editor" : mode === "SFX Lab" ? "SFX Lab" : "Mixer"}</h1>
            </div>
            <div className="workspace-actions">
              <button type="button" className="ghost-button" onClick={() => announce("Autosave journal is not connected in the preview")}>Autosave <span className="status-dot offline" /></button>
              <button type="button" className="primary-button" onClick={addClip}>＋ New clip</button>
            </div>
          </div>
          {mode === "Music" && <SongEditor tracks={tracks} selectedTrackId={selectedTrackId} selectedClipId={selectedClipId} setSelectedTrackId={setSelectedTrackId} setSelectedClipId={setSelectedClipId} onClipDrag={moveClip} onAnnounce={announce} timelineCleared={timelineCleared} onClear={() => { setTracks((current) => current.map((track) => ({ ...track, clips: [] }))); setTimelineCleared(true); announce("Timeline cleared — add a clip to begin"); }} />}
          {mode === "SFX Lab" && <SfxLab onFreeze={freezeSfx} onAnnounce={announce} />}
          {mode === "Mixer" && <MixerFocus tracks={tracks} onMute={(id) => updateTrack(id, { muted: !tracks.find((track) => track.id === id)?.muted })} onGain={(id, gain) => updateTrack(id, { gain })} />}
        </section>

        <aside className="inspector-panel panel-surface">
          <div className="panel-heading"><span>Inspector</span><span className="inspector-code">{mode === "SFX Lab" ? "RECIPE / 01" : "TRACK / 01"}</span></div>
          {mode === "SFX Lab" ? <SfxInspector seed={seed} locked={locked} setLocked={setLocked} onSeedChange={setSeed} onRandomize={randomize} onAnnounce={announce} /> : <TrackInspector track={selectedTrack} clip={selectedClip} onUpdateClip={(patch) => selectedTrack && selectedClip && updateClip(selectedTrack.id, selectedClip.id, patch)} onDuplicate={duplicateClip} onSplit={splitClip} onAnnounce={announce} />}
        </aside>

        <section className="bottom-panel panel-surface">
          <div className="bottom-heading"><span>MIXER / EVENT FLOW</span><div><button type="button" className="bottom-tab active">Mixer</button><button type="button" className="bottom-tab" onClick={() => announce("Automation lanes are ready for the next engine slice")}>Automation</button><button type="button" className="bottom-tab" onClick={() => announce("Event list is empty in the preview")}>Event List</button></div></div>
          <div className="mixer-row">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => updateTrack(track.id, { muted: !track.muted })} onGain={(gain) => updateTrack(track.id, { gain })} />)}<MixerStrip track={{ id: 0, name: "Master", icon: "✦", color: "master", gain: 0.82, pan: 0, muted: false, clips: [] }} onMute={() => announce("Master mute is preview-only")} onGain={() => announce("Master gain is preview-only")} master /></div>
        </section>
      </main>

      {toast && <div className="toast" role="status"><span className="toast-icon">✦</span>{toast}</div>}
      {commandPaletteOpen && <CommandPalette onClose={() => setCommandPaletteOpen(false)} onPlay={togglePlay} onMode={(nextMode) => { setMode(nextMode); setCommandPaletteOpen(false); }} />}
    </div>
  );
}

function SongEditor({ tracks, selectedTrackId, selectedClipId, setSelectedTrackId, setSelectedClipId, onClipDrag, onAnnounce, timelineCleared, onClear }: { tracks: Track[]; selectedTrackId: number; selectedClipId: number; setSelectedTrackId: (id: number) => void; setSelectedClipId: (id: number) => void; onClipDrag: (event: DragEvent<HTMLButtonElement>, trackId: number, clipId: number) => void; onAnnounce: (message: string) => void; timelineCleared: boolean; onClear: () => void }) {
  return (
    <div className="editor-canvas" data-testid="song-editor">
      <div className="ruler"><span className="ruler-label">BAR</span>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((bar) => <span key={bar}>{bar}</span>)}</div>
      <div className="timeline-stage">
        <div className="timeline-grid" aria-label="Song editor timeline">
          {tracks.map((track, index) => <div className="track-lane" key={track.id} style={{ top: `${index * 58}px` }}><button type="button" className={`track-label ${selectedTrackId === track.id ? "selected" : ""}`} onClick={() => setSelectedTrackId(track.id)}><span className={`track-icon ${track.color}`}>{track.icon}</span><span>{track.name}</span><span className="lane-menu">···</span></button>{track.clips.map((clip) => <button key={clip.id} type="button" draggable className={`clip clip-${clip.tone} ${selectedClipId === clip.id ? "selected" : ""}`} style={{ left: `${clip.left}px`, width: `${clip.width}px` }} onClick={() => { setSelectedTrackId(track.id); setSelectedClipId(clip.id); }} onDragEnd={(event) => onClipDrag(event, track.id, clip.id)} aria-label={`Select ${clip.name}`}><span className="clip-handle" /><span>{clip.name}</span><small>8 bars · seed 42</small></button>)}</div>)}
          <div className="playhead" aria-label="Playhead"><span>00:03:12</span></div>
          {timelineCleared && <div className="empty-timeline"><span className="empty-icon">＋</span><strong>Timeline is empty</strong><span>Use “New clip” to start a sound sketch.</span></div>}
        </div>
      </div>
      <div className="editor-footer"><div className="snap-control"><span>SNAP</span><button type="button" className="select-button" onClick={() => onAnnounce("Snap set to 1/16")}>1/16 <span>⌄</span></button></div><div className="zoom-control"><span>ZOOM</span><input aria-label="Timeline zoom" type="range" min="60" max="140" defaultValue="100" onChange={(event) => onAnnounce(`Timeline zoom ${event.target.value}%`)} /></div><div className="footer-spacer" /><button type="button" className="ghost-button danger-button" onClick={onClear}>Clear timeline</button><span className="hint-key">Space <span>Play / pause</span></span></div>
    </div>
  );
}

function SfxLab({ onFreeze, onAnnounce }: { onFreeze: () => void; onAnnounce: (message: string) => void }) {
  const [macros, setMacros] = useState({ character: 72, pitch: 68, body: 44, noise: 31, space: 58, length: 62 });
  return (
    <div className="sfx-workspace" data-testid="sfx-panel">
      <div className="sfx-hero"><div className="eyebrow">RECIPE / BUILT-IN / 01</div><h2>Laser Pulse</h2><p>Down-sweep with a bright transient and a compact tail.</p><div className="waveform" aria-label="Laser waveform">{Array.from({ length: 54 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 29) % 66)}%` }} />)}</div><div className="sfx-hero-actions"><button type="button" className="primary-button" onClick={() => onAnnounce("Previewing Laser Pulse")}>▶ Preview</button><button type="button" className="ghost-button" onClick={onFreeze}>Freeze to track</button></div></div>
      <div className="macro-card"><div className="card-heading"><span>MACROS</span><span className="muted-label">LOCKED VALUES STAY FIXED</span></div><div className="macro-grid">{Object.entries(macros).map(([key, value]) => <label className="macro-control" key={key}><span className="macro-dial" style={{ "--dial": `${value * 2.9}deg` } as React.CSSProperties}><i /></span><span>{key}</span><input type="range" min="0" max="100" value={value} onChange={(event) => setMacros((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></div>
      <div className="sfx-bottom-grid"><div className="sfx-note"><span className="note-mark">i</span><span>Deterministic preview. Same seed + same parameters always renders identical PCM.</span></div><button type="button" className="ghost-button" onClick={() => onAnnounce("Advanced parameters expanded")}>Advanced parameters <span>⌄</span></button></div>
    </div>
  );
}

function SfxInspector({ seed, locked, setLocked, onSeedChange, onRandomize, onAnnounce }: { seed: number; locked: boolean; setLocked: (value: boolean) => void; onSeedChange: (value: number) => void; onRandomize: () => void; onAnnounce: (message: string) => void }) {
  return <div className="sfx-inspector-card"><div className="card-heading"><span>RENDER CONTROL</span><span className="recipe-version">LASER / V1</span></div><div className="inspector-row"><span>Seed</span><div className="inline-control"><input aria-label="SFX seed" type="number" value={seed} onChange={(event) => onSeedChange(Number(event.target.value))} /><button type="button" className={`lock-button ${locked ? "locked" : ""}`} aria-label={locked ? "Unlock seed" : "Lock seed"} onClick={() => setLocked(!locked)}>{locked ? "▣" : "□"}</button></div></div><div className="inspector-row"><span>Variants</span><select aria-label="Variant count" defaultValue="8"><option>1 variant</option><option>8 variants</option><option>16 variants</option><option>32 variants</option></select></div><div className="inspector-row"><span>Peak target</span><span className="value-readout">-1.0 dBFS</span></div><div className="inspector-actions"><button type="button" className="ghost-button" onClick={onRandomize}>⤨ Randomize</button><button type="button" className="primary-button" onClick={() => onAnnounce("Batch export queued in the render worker")}>Export batch</button></div></div>;
}

function TrackInspector({ track, clip, onUpdateClip, onDuplicate, onSplit, onAnnounce }: { track?: Track; clip?: Clip; onUpdateClip: (patch: Partial<Clip>) => void; onDuplicate: () => void; onSplit: () => void; onAnnounce: (message: string) => void }) {
  if (!track || !clip) return <div className="empty-inspector"><span className="empty-icon">⌁</span><strong>Select a clip</strong><span>Choose a track or clip to inspect its parameters.</span></div>;
  return <div className="inspector-content"><div className="selected-object"><span className={`track-icon ${track.color}`}>{track.icon}</span><div><strong>{clip.name}</strong><small>{track.name} · Pattern clip</small></div></div><div className="inspector-section"><div className="section-label">CLIP TRANSFORM</div><div className="inspector-row"><span>Position</span><span className="value-readout">{Math.round(clip.left / 64 + 1)}.1.00</span></div><div className="inspector-row"><span>Length</span><input aria-label="Clip length" type="range" min="40" max="420" value={clip.width} onChange={(event) => onUpdateClip({ width: Number(event.target.value) })} /></div><div className="inspector-row"><span>Color</span><span className={`color-chip ${clip.tone}`} /></div></div><div className="inspector-section"><div className="section-label">ACTIONS</div><div className="inspector-actions stacked"><button type="button" className="ghost-button" onClick={onDuplicate}>⧉ Duplicate <span className="hint-key">Ctrl+D</span></button><button type="button" className="ghost-button" onClick={onSplit}>⫽ Split at playhead</button><button type="button" className="ghost-button" onClick={() => onAnnounce("Clip is ready for a non-destructive freeze")}>◈ Freeze audio</button></div></div><div className="inspector-note"><span>⌘</span> UI edits stay in the project command layer. DSP nodes remain on the Rust side.</div></div>;
}

function MixerFocus({ tracks, onMute, onGain }: { tracks: Track[]; onMute: (id: number) => void; onGain: (id: number, gain: number) => void }) {
  return <div className="mixer-focus" data-testid="mixer-panel"><div className="mixer-focus-intro"><div className="eyebrow">MIX BUS / LIVE VIEW</div><h2>Control the shape of the mix.</h2><p>Gain and mute controls are local UI state until the Rust control queue is connected.</p></div><div className="mixer-focus-grid">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => onMute(track.id)} onGain={(gain) => onGain(track.id, gain)} large />)}</div></div>;
}

function MixerStrip({ track, onMute, onGain, large = false, master = false }: { track: Track; onMute: () => void; onGain: (gain: number) => void; large?: boolean; master?: boolean }) {
  return <div className={`mixer-strip ${large ? "large" : ""} ${master ? "master-strip" : ""}`}><div className="strip-top"><span className={`track-icon ${track.color}`}>{track.icon}</span><strong>{track.name}</strong><button type="button" className={`mute-button ${track.muted ? "muted" : ""}`} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} onClick={onMute}>{track.muted ? "M" : "·"}</button></div><div className="meter-track"><span style={{ height: `${track.muted ? 8 : Math.max(12, track.gain * 78)}%` }} /></div><input className="vertical-fader" aria-label={`${track.name} gain`} type="range" min="0" max="100" value={Math.round(track.gain * 100)} onChange={(event) => onGain(Number(event.target.value) / 100)} /><div className="strip-db">{track.muted ? "MUTED" : `${Math.round(track.gain * 100 - 100)} dB`}</div></div>;
}

function CommandPalette({ onClose, onPlay, onMode }: { onClose: () => void; onPlay: () => void; onMode: (mode: Mode) => void }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}><div className="command-search"><span>⌘</span><input autoFocus placeholder="Type a command" aria-label="Command search" /></div><div className="command-list"><button type="button" onClick={onPlay}><span>▶</span> Play / pause <kbd>Space</kbd></button><button type="button" onClick={() => onMode("Music")}><span>◌</span> Open Song Editor <kbd>⌘1</kbd></button><button type="button" onClick={() => onMode("SFX Lab")}><span>⌁</span> Open SFX Lab <kbd>⌘2</kbd></button><button type="button" onClick={() => onMode("Mixer")}><span>▥</span> Open Mixer <kbd>⌘3</kbd></button></div><div className="command-foot"><span>ESC to close</span><span>Commands run through the control layer</span></div></section></div>;
}

export default App;
