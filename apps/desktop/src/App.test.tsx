import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { loadProject } from "./lib/tauri";
import type { Project } from "./lib/tauri";

const PROJECT_STORAGE_KEY = "sonicforge.preview.projects.v1";

describe("SonicForge Studio GUI shell", () => {
  beforeEach(() => localStorage.clear());
  it("switches workspace modes without leaving the app shell", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /SFX Lab/i }));
    expect(screen.getByTestId("sfx-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Mixer/i }));
    expect(screen.getByTestId("mixer-panel")).toBeInTheDocument();
  });

  it("keeps transport and deterministic SFX controls interactive", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /SFX Lab/i }));
    await waitFor(() => expect(screen.getByTestId("sfx-panel")).toBeInTheDocument());
    const seed = screen.getByRole("spinbutton", { name: "SFX seed" }) as HTMLInputElement;
    fireEvent.change(seed, { target: { value: "99" } });
    expect(seed.value).toBe("99");
    fireEvent.click(screen.getByRole("button", { name: "Unlock seed" }));
    fireEvent.click(screen.getByRole("button", { name: /Randomize/i }).firstChild?.parentElement ?? screen.getByRole("button", { name: /Randomize/i }));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "SFX seed" })).toBeInTheDocument());
  });

  it("previews and stops every built-in SFX recipe through the shared transport", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /SFX Lab/i }));
    const recipes = [
      ["laserPulse", "Laser Pulse"],
      ["deepImpact", "Deep Impact"],
      ["fastWhoosh", "Fast Whoosh"],
      ["softUiClick", "Soft UI Click"],
      ["rainAmbience", "Rain Ambience"],
    ] as const;

    for (const [id, label] of recipes) {
      const card = screen.getByTestId(`sfx-recipe-${id}`);
      fireEvent.click(within(card).getByRole("button", { name: `Preview ${label}` }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
      fireEvent.click(within(card).getByRole("button", { name: `Stop ${label}` }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument());
    }
  });

  it("controls the current project from Mixer transport", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /Mixer/i }));
    const mixer = screen.getByTestId("mixer-panel");
    fireEvent.click(within(mixer).getByRole("button", { name: /Play/i }));
    await waitFor(() => expect(within(mixer).getByText(/playing/i)).toBeInTheDocument());
    fireEvent.click(within(mixer).getByRole("button", { name: /Pause/i }));
    await waitFor(() => expect(within(mixer).getByText(/ready/i)).toBeInTheDocument());
    fireEvent.click(within(mixer).getByRole("button", { name: /Play/i }));
    fireEvent.click(within(mixer).getByRole("button", { name: /Stop/i }));
    await waitFor(() => expect(within(mixer).getByText(/ready/i)).toBeInTheDocument());
  });

  it("exports the current project to a WAV result", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Export WAV/ }));
    const dialog = screen.getByRole("dialog", { name: "Export WAV" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Safe file name" }), {
      target: { value: "my-song" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export WAV" }));

    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Export complete"));
    expect(within(dialog).getByRole("status")).toHaveTextContent("browser-preview://exports/my-song.wav");
  });

  it("adds factory instruments with playable patterns and switches the selected track sound", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add instrument/ }));
    const picker = screen.getByRole("dialog", { name: "Add a playable instrument" });
    expect(within(picker).getAllByRole("button", { name: /^Add / })).toHaveLength(10);
    fireEvent.click(within(picker).getByRole("button", { name: "Add Bell" }));

    expect(screen.getByLabelText("Song editor timeline").querySelector(".track-label.selected")).toHaveTextContent("Bell");
    const instrument = screen.getByRole("combobox", { name: "Track instrument" });
    expect(instrument).toHaveValue("bell");
    fireEvent.click(screen.getByRole("tab", { name: "Piano Roll" }));
    await waitFor(() => expect(screen.getByTestId("note-count")).toHaveTextContent("4 NOTES"));
    fireEvent.change(instrument, { target: { value: "warm-pad" } });
    expect(instrument).toHaveValue("warm-pad");
    expect(screen.getByText("Track sound changed to Warm Pad")).toBeInTheDocument();
    expect(screen.getByLabelText("Project save status")).toHaveTextContent("Unsaved changes");
  });

  it("keeps instrument picker focus modal and restores the trigger on Escape", async () => {
    render(<App />);
    const trigger = screen.getByRole("button", { name: /Add instrument/ });
    trigger.focus();
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Add a playable instrument" });
    await waitFor(() => expect(picker).toHaveFocus());
    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a playable instrument" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("preserves melodic pitches when the selected track is edited in Step Sequencer", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Add instrument/ }));
    const picker = screen.getByRole("dialog", { name: "Add a playable instrument" });
    fireEvent.click(within(picker).getByRole("button", { name: "Add Bell" }));
    fireEvent.click(screen.getByRole("tab", { name: "Step Sequencer" }));
    fireEvent.change(screen.getByRole("slider", { name: "Velocity" }), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    const saved = await loadProject("sonicforge-demo");
    const bell = saved.tracks.find((track) => track.name === "Bell");
    expect(bell?.pattern.notes.map((note) => note.midiNote)).toEqual([72, 76, 79, 84]);
  });

  it("changes sequencer resolution without moving or replacing existing notes", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Add instrument/ }));
    const picker = screen.getByRole("dialog", { name: "Add a playable instrument" });
    fireEvent.click(within(picker).getByRole("button", { name: "Add Bell" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));
    const before = await loadProject("sonicforge-demo");

    fireEvent.click(screen.getByRole("tab", { name: "Step Sequencer" }));
    fireEvent.change(screen.getByRole("slider", { name: "Pattern length" }), { target: { value: "64" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    const after = await loadProject("sonicforge-demo");
    expect(after.tracks.find((track) => track.name === "Bell")?.pattern.notes)
      .toEqual(before.tracks.find((track) => track.name === "Bell")?.pattern.notes);
  });

  it("edits only the selected sequencer step while preserving chords and notes after bar one", async () => {
    const outsideNote = { startBeat: 8, lengthBeats: 2.5, midiNote: 72, velocity: 0.41 };
    const project: Project = {
      schemaVersion: 1,
      id: "sequencer-preservation",
      name: "Sequencer Preservation",
      sampleRate: 48_000,
      ppq: 960,
      bpm: 120,
      tempoMap: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      tracks: [{
        id: "pad",
        name: "Pad",
        kind: "instrument",
        color: "#b99aff",
        gain: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        pattern: {
          lengthBeats: 16,
          notes: [
            { startBeat: 0, lengthBeats: 4, midiNote: 48, velocity: 0.46 },
            { startBeat: 0, lengthBeats: 4, midiNote: 55, velocity: 0.46 },
            { startBeat: 0, lengthBeats: 4, midiNote: 60, velocity: 0.46 },
            { startBeat: 0, lengthBeats: 4, midiNote: 64, velocity: 0.46 },
            outsideNote,
          ],
        },
        clips: [],
        waveform: "triangle",
      }],
      devices: [{ id: "instrument-pad", kind: "builtin.instrument.warm-pad", parameters: {} }],
      automation: [],
      assets: [],
    };
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify([project]));
    render(<App />);

    const picker = screen.getByRole("combobox", { name: "Saved projects" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: project.id } });
    fireEvent.click(screen.getByRole("button", { name: /^Open$/ }));
    await screen.findByText("Loaded Sequencer Preservation");
    fireEvent.click(screen.getByRole("tab", { name: "Step Sequencer" }));
    fireEvent.change(screen.getByRole("slider", { name: "Velocity" }), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    const saved = await loadProject(project.id);
    const notes = saved.tracks[0]?.pattern.notes ?? [];
    expect(notes.filter((note) => note.startBeat === 0).map((note) => note.midiNote)).toEqual([48, 55, 60, 64]);
    expect(notes.find((note) => note.startBeat === outsideNote.startBeat)).toEqual(outsideNote);
  });

  it("moves the playhead with keyboard seeking", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    const playhead = screen.getByTestId("playhead");
    expect(playhead).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(playhead, { key: "ArrowRight" });
    expect(playhead).toHaveAttribute("aria-valuenow", "0.25");
    fireEvent.keyDown(playhead, { key: "End" });
    expect(playhead).toHaveAttribute("aria-valuenow", "40");
  });

  it("opens the command palette from the visible shortcut button", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open SFX Lab/i }));
    await waitFor(() => expect(screen.getByTestId("sfx-panel")).toBeInTheDocument());
  });

  it("does not hijack Space from native interactive and editable controls", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument());
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    container.append(textarea, editable);
    const nativeTargets = [
      screen.getByRole("spinbutton", { name: "BPM" }),
      screen.getByRole("combobox", { name: "UI scale" }),
      screen.getByRole("button", { name: /Templates/i }),
      textarea,
      editable,
    ];

    for (const target of nativeTargets) {
      target.focus();
      fireEvent.keyDown(target, { key: " ", code: "Space" });
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    }

    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument());
  });

  it("focuses and closes audio settings with Escape, then restores focus", async () => {
    render(<App />);
    const trigger = screen.getByRole("button", { name: "Open audio settings" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Audio settings" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Audio settings" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("edits notes in the Canvas piano roll and exposes resize and velocity controls", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Piano Roll" }));
    expect(screen.getByTestId("piano-roll")).toBeInTheDocument();
    expect(screen.getByTestId("note-count")).toHaveTextContent("5 NOTES");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByTestId("note-count")).toHaveTextContent("6 NOTES");
    fireEvent.change(screen.getByRole("slider", { name: "Note length" }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("slider", { name: "Note velocity" }), { target: { value: "111" } });
    expect(screen.getByText("10/16")).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Legato" }));
    expect(screen.getByText("8/16")).toBeInTheDocument();
  });

  it("saves dirty project state and configures audio through the settings UI", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Piano Roll" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByLabelText("Project save status")).toHaveTextContent("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    fireEvent.click(screen.getByRole("button", { name: "Open audio settings" }));
    expect(await screen.findByRole("dialog", { name: "Audio settings" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Audio buffer size" }), { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply & start" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop audio" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Open audio settings" })).toHaveTextContent("512f");
  });

  it("offers every required UI scale", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    const scale = screen.getByRole("combobox", { name: "UI scale" });
    expect(Array.from((scale as HTMLSelectElement).options).map((option) => option.text)).toEqual(["100%", "125%", "150%", "200%"]);
    fireEvent.change(scale, { target: { value: "200" } });
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-ui-scale", "200");
  });

  it("loads the public-domain Twinkle template into the complete project model", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    const heading = screen.getByRole("heading", { name: "Twinkle Twinkle Little Star" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Use template" }));
    await waitFor(() => expect(screen.getByTestId("piano-roll")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("note-count")).toHaveTextContent("42 NOTES"));
    expect(screen.getByText("Twinkle Twinkle Little Star")).toBeInTheDocument();
  });

  it("round-trips the complete project model through the UI save and load path", async () => {
    const project: Project = {
      schemaVersion: 1,
      id: "round-trip-project",
      name: "Round Trip Project",
      sampleRate: 96_000,
      ppq: 480,
      bpm: 123,
      tempoMap: [{ tick: 0, bpm: 123 }, { tick: 7_680, bpm: 98.5 }],
      timeSignatures: [{ tick: 0, numerator: 7, denominator: 8 }],
      tracks: [{
        id: "custom-lead",
        name: "Custom Lead",
        kind: "instrument",
        color: "#123456",
        gain: 0.63,
        pan: -0.17,
        muted: false,
        solo: true,
        armed: true,
        pattern: {
          lengthBeats: 48,
          notes: [
            { startBeat: 0.125, lengthBeats: 0.625, midiNote: 61, velocity: 0.333 },
            { startBeat: 32.5, lengthBeats: 3.25, midiNote: 73, velocity: 0.875 },
          ],
        },
        clips: [{ id: "original-clip", name: "Original Clip", startTick: 37, lengthTicks: 9_601, patternId: null, loopEnabled: false }],
        waveform: "triangle",
      }],
      devices: [
        { id: "device-one", kind: "builtin.synth", parameters: { cutoff: 0.42 } },
        { id: "instrument-custom-lead", kind: "builtin.instrument.warm-pad", parameters: { attack: 0.37, spread: 0.61 } },
      ],
      automation: [{ target: "device-one.cutoff", points: [{ tick: 0, value: 0.1 }, { tick: 480, value: 0.9 }] }],
      assets: [{ id: "asset-one", kind: "audio", path: "samples/kick.wav", sha256: "abc123", size: 42 }],
    };
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify([project]));
    render(<App />);

    const picker = screen.getByRole("combobox", { name: "Saved projects" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: project.id } });
    fireEvent.click(screen.getByRole("button", { name: /^Open$/ }));
    await screen.findByText("Loaded Round Trip Project");

    const bpm = screen.getByRole("spinbutton", { name: "BPM" });
    fireEvent.change(bpm, { target: { value: "124" } });
    fireEvent.change(bpm, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    await expect(loadProject(project.id)).resolves.toEqual(project);
  });

  it("preserves template notes and allocates unique clip model IDs when saved", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    const card = screen.getByRole("heading", { name: "Twinkle Twinkle Little Star" }).closest("article");
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Use template" }));
    await waitFor(() => expect(screen.getByTestId("note-count")).toHaveTextContent("42 NOTES"));
    fireEvent.click(screen.getByRole("tab", { name: "Song Editor" }));
    fireEvent.click(screen.getByRole("button", { name: /New clip/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByLabelText("Project save status")).toHaveTextContent("Saved"));

    const saved = await loadProject("template-twinkle-twinkle");
    expect(saved.tracks[0]?.pattern.lengthBeats).toBe(48);
    expect(saved.tracks[0]?.pattern.notes).toHaveLength(42);
    const clipIds = saved.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    expect(new Set(clipIds).size).toBe(clipIds.length);
    expect(clipIds).toContain("twinkle-clip");
  });

  it("switches the visible interface to Traditional Chinese", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("song-editor")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-TW" } });
    expect(screen.getByRole("tab", { name: /音樂/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /範本/ })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-TW");
  });
});
