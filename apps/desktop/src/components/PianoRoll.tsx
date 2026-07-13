import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { initialPianoNotes } from "../lib/pianoRoll";
import type { PianoNote } from "../lib/pianoRoll";
import { useTranslation } from "../i18n";

type Tool = "draw" | "select" | "erase";

interface PianoRollProps {
  onDirty: (message: string) => void;
  onNotesChange?: (notes: PianoNote[]) => void;
  externalNotes?: PianoNote[];
  resetKey?: number;
}

const WIDTH = 960;
const HEIGHT = 390;
const KEY_WIDTH = 62;
const GRID_TOP = 24;
const NOTE_AREA_HEIGHT = 272;
const VELOCITY_TOP = 320;
const ROW_HEIGHT = 11;
const TICK_WIDTH = 24;
const MIN_PITCH = 48;
const MAX_PITCH = 72;

interface CanvasMetrics {
  backingWidth: number;
  backingHeight: number;
  pixelRatio: number;
}

const ghostNotes: PianoNote[] = [
  { id: -1, pitch: 55, tick: 0, duration: 8, velocity: 64, ghost: true },
  { id: -2, pitch: 57, tick: 12, duration: 4, velocity: 64, ghost: true },
  { id: -3, pitch: 55, tick: 20, duration: 8, velocity: 64, ghost: true },
];

const scalePitchClasses: Record<string, Set<number>> = {
  "C Major": new Set([0, 2, 4, 5, 7, 9, 11]),
  "C Minor": new Set([0, 2, 3, 5, 7, 8, 10]),
  Chromatic: new Set(Array.from({ length: 12 }, (_, index) => index)),
};

function noteName(pitch: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function hitNote(notes: PianoNote[], x: number, y: number): PianoNote | undefined {
  if (y < GRID_TOP || y > GRID_TOP + NOTE_AREA_HEIGHT) return undefined;
  return [...notes].reverse().find((note) => {
    const noteX = KEY_WIDTH + note.tick * TICK_WIDTH;
    const noteY = GRID_TOP + (MAX_PITCH - note.pitch) * ROW_HEIGHT;
    return x >= noteX && x <= noteX + note.duration * TICK_WIDTH && y >= noteY && y <= noteY + ROW_HEIGHT;
  });
}

function nextPianoNoteId(notes: PianoNote[]): number {
  return Math.max(0, ...notes.map((note) => note.id)) + 1;
}

export function PianoRoll({ onDirty, onNotesChange, externalNotes, resetKey = 0 }: PianoRollProps) {
  const t = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialNotes = externalNotes ?? initialPianoNotes;
  const nextId = useRef(nextPianoNoteId(initialNotes));
  const lastResetKey = useRef(resetKey);
  const [notes, setNotes] = useState(() => initialNotes);
  const [selectedId, setSelectedId] = useState<number | null>(() => initialNotes[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("select");
  const [scale, setScale] = useState("C Major");
  const [showGhosts, setShowGhosts] = useState(true);
  const [canvasMetrics, setCanvasMetrics] = useState<CanvasMetrics>({ backingWidth: WIDTH, backingHeight: HEIGHT, pixelRatio: 1 });
  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedId), [notes, selectedId]);
  const scaleLabel = scale === "C Major" ? t("piano.scale.cMajor") : scale === "C Minor" ? t("piano.scale.cMinor") : t("piano.scale.chromatic");
  const toolLabel = tool === "draw" ? t("piano.draw") : tool === "select" ? t("piano.select") : t("piano.erase");

  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      const nextNotes = externalNotes ?? initialPianoNotes;
      nextId.current = nextPianoNoteId(nextNotes);
      setNotes(nextNotes);
      setSelectedId(nextNotes[0]?.id ?? null);
    }
  }, [externalNotes, resetKey]);

  useEffect(() => {
    onNotesChange?.(notes);
  }, [notes, onNotesChange]);

  const commit = useCallback((message: string, mutate: (current: PianoNote[]) => PianoNote[]) => {
    setNotes(mutate);
    onDirty(message);
  }, [onDirty]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.max(1, Math.round(rect.width * pixelRatio));
    const backingHeight = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    setCanvasMetrics((current) => (
      current.backingWidth === backingWidth
      && current.backingHeight === backingHeight
      && current.pixelRatio === pixelRatio
        ? current
        : { backingWidth, backingHeight, pixelRatio }
    ));
  }, []);

  useLayoutEffect(() => {
    resizeCanvas();
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resizeCanvas);
    observer?.observe(canvas);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    context.setTransform(canvasMetrics.backingWidth / WIDTH, 0, 0, canvasMetrics.backingHeight / HEIGHT, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#0b1117";
    context.fillRect(0, 0, WIDTH, HEIGHT);

    const scaleNotes = scalePitchClasses[scale];
    for (let pitch = MAX_PITCH; pitch >= MIN_PITCH; pitch -= 1) {
      const y = GRID_TOP + (MAX_PITCH - pitch) * ROW_HEIGHT;
      const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
      context.fillStyle = isBlack ? "#0d141b" : "#111a22";
      context.fillRect(0, y, KEY_WIDTH, ROW_HEIGHT - 1);
      context.fillStyle = scaleNotes.has(pitch % 12) ? "rgba(96,217,210,.07)" : "rgba(255,255,255,.012)";
      context.fillRect(KEY_WIDTH, y, WIDTH - KEY_WIDTH, ROW_HEIGHT - 1);
      context.fillStyle = isBlack ? "#61717d" : "#a7b4bc";
      context.font = "9px Cascadia Code, monospace";
      context.fillText(noteName(pitch), 8, y + 12);
    }

    for (let tick = 0; tick <= 36; tick += 1) {
      const x = KEY_WIDTH + tick * TICK_WIDTH;
      context.strokeStyle = tick % 4 === 0 ? "#344653" : "rgba(52,70,83,.34)";
      context.beginPath();
      context.moveTo(x + 0.5, GRID_TOP);
      context.lineTo(x + 0.5, GRID_TOP + NOTE_AREA_HEIGHT);
      context.stroke();
      if (tick % 4 === 0) {
        context.fillStyle = "#738590";
        context.fillText(String(tick / 4 + 1).padStart(2, "0"), x + 4, 15);
      }
    }

    const drawNote = (note: PianoNote) => {
      const x = KEY_WIDTH + note.tick * TICK_WIDTH + 2;
      const y = GRID_TOP + (MAX_PITCH - note.pitch) * ROW_HEIGHT + 2;
      const width = note.duration * TICK_WIDTH - 4;
      context.fillStyle = note.ghost ? "rgba(185,154,255,.16)" : note.id === selectedId ? "#6de0d8" : "#23666b";
      context.strokeStyle = note.ghost ? "rgba(185,154,255,.48)" : note.id === selectedId ? "#e8f0f3" : "#60d9d2";
      context.lineWidth = note.id === selectedId ? 2 : 1;
      context.beginPath();
      context.roundRect(x, y, width, ROW_HEIGHT - 4, 3);
      context.fill();
      context.stroke();
      if (!note.ghost) {
        context.fillStyle = note.id === selectedId ? "#071013" : "#d9f4f2";
        context.font = "8px Cascadia Code, monospace";
        context.fillText(noteName(note.pitch), x + 5, y + 10);
      }
    };

    if (showGhosts) ghostNotes.forEach(drawNote);
    notes.forEach(drawNote);

    context.fillStyle = "#0d161d";
    context.fillRect(0, VELOCITY_TOP, WIDTH, HEIGHT - VELOCITY_TOP);
    context.fillStyle = "#738590";
    context.font = "8px Cascadia Code, monospace";
    context.fillText(t("piano.velocity"), 8, VELOCITY_TOP + 14);
    notes.forEach((note) => {
      const x = KEY_WIDTH + note.tick * TICK_WIDTH + 4;
      const height = Math.max(5, note.velocity / 2.4);
      context.fillStyle = note.id === selectedId ? "#f1bf70" : "#489c9b";
      context.fillRect(x, HEIGHT - 8 - height, Math.max(4, note.duration * TICK_WIDTH - 8), height);
    });
  }, [canvasMetrics, notes, scale, selectedId, showGhosts, t]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (WIDTH / Math.max(rect.width, 1)),
      y: (event.clientY - rect.top) * (HEIGHT / Math.max(rect.height, 1)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasPoint(event);
    const hit = hitNote(notes, x, y);
    if (tool === "erase") {
      if (hit) {
        commit(t("status.noteErased"), (current) => current.filter((note) => note.id !== hit.id));
        if (selectedId === hit.id) setSelectedId(null);
      }
      return;
    }
    if (tool === "select") {
      setSelectedId(hit?.id ?? null);
      return;
    }
    if (y < GRID_TOP || y > GRID_TOP + NOTE_AREA_HEIGHT || x < KEY_WIDTH) return;
    while (notes.some((note) => note.id === nextId.current)) nextId.current += 1;
    const id = nextId.current++;
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - Math.floor((y - GRID_TOP) / ROW_HEIGHT)));
    const tick = Math.max(0, Math.round((x - KEY_WIDTH) / TICK_WIDTH));
    commit(t("status.noteDrawn"), (current) => [...current, { id, pitch, tick, duration: 4, velocity: 96 }]);
    setSelectedId(id);
  };

  const updateSelected = (patch: Partial<PianoNote>, message: string) => {
    if (selectedId === null) return;
    commit(message, (current) => current.map((note) => note.id === selectedId ? { ...note, ...patch } : note));
  };

  const quantize = () => commit(t("status.noteQuantized"), (current) => current.map((note) => note.id === selectedId ? { ...note, tick: Math.round(note.tick / 4) * 4 } : note));
  const transpose = (semitones: number) => selectedNote && updateSelected({ pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, selectedNote.pitch + semitones)) }, `Note transposed ${semitones > 0 ? "+" : ""}${semitones}`);
  const duplicate = () => {
    if (!selectedNote) return;
    while (notes.some((note) => note.id === nextId.current)) nextId.current += 1;
    const id = nextId.current++;
    commit(t("status.noteDuplicated"), (current) => [...current, { ...selectedNote, id, tick: selectedNote.tick + selectedNote.duration }]);
    setSelectedId(id);
  };
  const legato = () => selectedNote && updateSelected({ duration: 8 }, t("status.noteLegato"));

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Delete" && selectedId !== null) {
      event.preventDefault();
      commit(t("status.selectedNoteErased"), (current) => current.filter((note) => note.id !== selectedId));
      setSelectedId(null);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      transpose(1);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      transpose(-1);
    }
  };

  return (
    <section className="piano-roll" data-testid="piano-roll" aria-label={t("piano.editor")}>
      <div className="piano-toolbar" aria-label={t("piano.tools")}>
        <div className="tool-group" role="group" aria-label={t("piano.editingTool")}>
          {(["draw", "select", "erase"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={tool === item} className={tool === item ? "active" : ""} onClick={() => setTool(item)}>{item === "draw" ? "✎" : item === "select" ? "⌖" : "⌫"} {item === "draw" ? t("piano.draw") : item === "select" ? t("piano.select") : t("piano.erase")}</button>
          ))}
        </div>
        <div className="tool-divider" />
        <button type="button" onClick={quantize}>{t("piano.quantize16")}</button>
        <button type="button" onClick={() => transpose(-1)}>−1</button>
        <button type="button" onClick={() => transpose(1)}>+1</button>
        <button type="button" onClick={duplicate}>{t("piano.duplicate")}</button>
        <button type="button" onClick={legato}>{t("piano.legato")}</button>
        <div className="toolbar-spacer" />
        <label>{t("piano.scale")} <select aria-label={t("piano.scaleLabel")} value={scale} onChange={(event) => setScale(event.target.value)}><option value="C Major">{t("piano.scale.cMajor")}</option><option value="C Minor">{t("piano.scale.cMinor")}</option><option value="Chromatic">{t("piano.scale.chromatic")}</option></select></label>
        <label className="toggle-label"><input type="checkbox" checked={showGhosts} onChange={(event) => setShowGhosts(event.target.checked)} /> {t("piano.ghostNotes")}</label>
      </div>
      <div className="piano-canvas-frame">
        <canvas ref={canvasRef} data-pixel-ratio={canvasMetrics.pixelRatio} tabIndex={0} role="application" aria-label={t("template.pianoCanvas", { count: notes.length, selection: selectedNote ? t("template.noteSelected", { note: noteName(selectedNote.pitch) }) : t("template.noNoteSelected") })} onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
      </div>
      <div className="note-inspector" aria-label={t("piano.selectedControls")}>
        <span data-testid="note-count">{t("template.noteCount", { count: notes.length })}</span>
        {selectedNote ? (
          <>
            <strong data-testid="selected-note">{noteName(selectedNote.pitch)} · {selectedNote.tick / 4 + 1}.1</strong>
            <label>{t("piano.length")} <input aria-label={t("piano.noteLength")} type="range" min="1" max="16" value={selectedNote.duration} onChange={(event) => updateSelected({ duration: Number(event.target.value) }, t("status.noteResized"))} /><output>{selectedNote.duration}/16</output></label>
            <label>{t("piano.velocity")} <input aria-label={t("piano.noteVelocity")} type="range" min="1" max="127" value={selectedNote.velocity} onChange={(event) => updateSelected({ velocity: Number(event.target.value) }, t("status.noteVelocityChanged"))} /><output>{selectedNote.velocity}</output></label>
          </>
        ) : <span className="muted-label">{t("piano.selectHint")}</span>}
        <span className="piano-state" role="status">{t("template.pianoState", { scale: scaleLabel, ghosts: showGhosts ? t("piano.ghostsOn") : t("piano.ghostsOff"), tool: toolLabel })}</span>
      </div>
    </section>
  );
}
