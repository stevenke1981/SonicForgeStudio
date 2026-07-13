import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslation } from "../i18n";
import { MAX_STEPS } from "./stepSequencerModel";
import type { Ratchet, StepPattern, StepState } from "./stepSequencerModel";
const STEP_COLUMNS = 16;

export interface StepSequencerProps {
  pattern: StepPattern;
  dirty: boolean;
  playing?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onChange: (pattern: StepPattern, description: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPlay?: () => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePattern(pattern: StepPattern): StepPattern {
  const length = clamp(Math.round(pattern.length), 1, MAX_STEPS);
  return {
    length,
    swing: clamp(Math.round(pattern.swing), 0, 100),
    steps: Array.from({ length: MAX_STEPS }, (_, index) => ({
      ...(pattern.steps[index] ?? {}),
      enabled: pattern.steps[index]?.enabled ?? (index < length && (index % 4 === 0 || index % 4 === 2)),
      velocity: clamp(Math.round(pattern.steps[index]?.velocity ?? (index % 4 === 0 ? 112 : 92)), 1, 127),
      probability: clamp(Math.round(pattern.steps[index]?.probability ?? 100), 0, 100),
      microShift: clamp(Math.round(pattern.steps[index]?.microShift ?? 0), -50, 50),
      ratchet: clamp(Math.round(pattern.steps[index]?.ratchet ?? 1), 1, 4) as Ratchet,
    })),
  };
}

const panelStyle: CSSProperties = {
  height: "calc(100% - 78px)",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  minHeight: 0,
  background: "#0b1218",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 10px",
  overflowX: "auto",
  borderBottom: "1px solid var(--line)",
  color: "var(--muted)",
  font: "8px var(--mono)",
  whiteSpace: "nowrap",
};

const toolbarButtonStyle: CSSProperties = {
  padding: "5px 8px",
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  background: "var(--surface)",
  fontSize: 8,
};

function Control({
  label,
  value,
  min,
  max,
  step = 1,
  output,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  output: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 132, color: "var(--muted)", fontSize: 9 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <output style={{ color: "var(--amber)", font: "9px var(--mono)" }}>{output}</output>
      </span>
      <input aria-label={ariaLabel} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function StepSequencer({
  pattern,
  dirty,
  playing = false,
  canUndo = false,
  canRedo = false,
  onChange,
  onUndo,
  onRedo,
  onPlay,
}: StepSequencerProps) {
  const t = useTranslation();
  const normalizedPattern = normalizePattern(pattern);
  const [selectedStep, setSelectedStep] = useState(0);
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = normalizedPattern.steps[selectedStep] ?? normalizedPattern.steps[0];

  useEffect(() => {
    if (selectedStep >= normalizedPattern.length) setSelectedStep(Math.max(0, normalizedPattern.length - 1));
  }, [normalizedPattern.length, selectedStep]);

  const updatePattern = (next: StepPattern, description: string) => onChange(normalizePattern(next), description);

  const updateStep = (index: number, patch: Partial<StepState>, description: string) => {
    const current = normalizedPattern.steps[index];
    const nextStep = { ...current, ...patch };
    if (JSON.stringify(current) === JSON.stringify(nextStep)) return;
    updatePattern({
      ...normalizedPattern,
      steps: normalizedPattern.steps.map((step, stepIndex) => stepIndex === index ? nextStep : step),
    }, description);
  };

  const focusStep = (index: number) => {
    const nextIndex = clamp(index, 0, MAX_STEPS - 1);
    setSelectedStep(nextIndex);
    stepRefs.current[nextIndex]?.focus();
  };

  const onStepKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const row = Math.floor(index / STEP_COLUMNS);
    const column = index % STEP_COLUMNS;
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = index + 1;
    if (event.key === "ArrowLeft") nextIndex = index - 1;
    if (event.key === "ArrowDown") nextIndex = (row + 1) * STEP_COLUMNS + column;
    if (event.key === "ArrowUp") nextIndex = (row - 1) * STEP_COLUMNS + column;
    if (event.key === "Home") nextIndex = row * STEP_COLUMNS;
    if (event.key === "End") nextIndex = row * STEP_COLUMNS + STEP_COLUMNS - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      focusStep(nextIndex);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedStep(index);
      updateStep(index, { enabled: !normalizedPattern.steps[index].enabled }, t("status.stepChanged"));
    }
  };

  return (
    <section className="piano-roll" data-testid="step-sequencer" aria-label={t("sequencer.title")} style={panelStyle}>
      <div style={toolbarStyle}>
        <strong style={{ color: "var(--text)", fontSize: 10 }}>{t("sequencer.title")}</strong>
        <span style={{ color: "var(--cyan)", font: "9px var(--mono)" }}>{t("sequencer.steps", { count: normalizedPattern.length })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={toolbarButtonStyle} onClick={onPlay} disabled={!onPlay} aria-label={playing ? t("sequencer.pause") : t("sequencer.play")}>
          {playing ? "Ⅱ" : "▶"} {playing ? t("transport.pause") : t("transport.play")}
        </button>
        <button type="button" style={{ ...toolbarButtonStyle, opacity: canUndo ? 1 : 0.45 }} onClick={onUndo} disabled={!canUndo} aria-label={t("sequencer.undo")}>↶ {t("sequencer.undo")}</button>
        <button type="button" style={{ ...toolbarButtonStyle, opacity: canRedo ? 1 : 0.45 }} onClick={onRedo} disabled={!canRedo} aria-label={t("sequencer.redo")}>↷ {t("sequencer.redo")}</button>
        <span data-testid="sequencer-dirty-state" role="status" style={{ color: dirty ? "var(--amber)" : "var(--cyan)", font: "9px var(--mono)" }}>
          {dirty ? t("project.unsaved") : t("project.saved")}
        </span>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 14, marginBottom: 14 }}>
          <Control label={t("sequencer.patternLength")} ariaLabel={t("sequencer.patternLength")} min={1} max={MAX_STEPS} value={normalizedPattern.length} output={`${normalizedPattern.length} ${t("sequencer.stepsUnit")}`} onChange={(value) => {
            const length = clamp(value, 1, MAX_STEPS);
            setSelectedStep((current) => Math.min(current, length - 1));
            updatePattern({ ...normalizedPattern, length }, t("status.stepChanged"));
          }} />
          <Control label={t("sequencer.swing")} ariaLabel={t("sequencer.swing")} min={0} max={100} value={normalizedPattern.swing} output={`${normalizedPattern.swing}%`} onChange={(value) => updatePattern({ ...normalizedPattern, swing: value }, t("status.stepChanged"))} />
          <span style={{ color: "var(--faint)", font: "9px var(--mono)" }}>{t("sequencer.keyboardHint")}</span>
        </div>

        <div role="grid" aria-label={t("sequencer.grid")} style={{ display: "grid", gridTemplateColumns: `repeat(${STEP_COLUMNS}, minmax(34px, 1fr))`, gap: 6, minWidth: 590 }}>
          {normalizedPattern.steps.map((step, index) => {
            const active = index < normalizedPattern.length && step.enabled;
            const selectedCell = selectedStep === index;
            return (
              <div role="row" key={index} style={{ display: "contents" }}>
                <button
                  ref={(element) => { stepRefs.current[index] = element; }}
                  type="button"
                  aria-label={`${t("sequencer.step", { number: index + 1 })} ${active ? t("sequencer.active") : t("sequencer.inactive")}`}
                  aria-pressed={active}
                  tabIndex={selectedCell ? 0 : -1}
                  onClick={() => { setSelectedStep(index); updateStep(index, { enabled: !step.enabled }, t("status.stepChanged")); }}
                  onFocus={() => setSelectedStep(index)}
                  onKeyDown={(event) => onStepKeyDown(event, index)}
                  style={{
                    display: "grid",
                    gap: 5,
                    minHeight: 58,
                    padding: "7px 4px",
                    color: active ? "#071013" : "var(--muted)",
                    border: `1px solid ${selectedCell ? "var(--text)" : active ? "var(--cyan)" : "var(--line)"}`,
                    borderRadius: 6,
                    background: active ? "var(--cyan)" : "var(--surface-raised)",
                    boxShadow: selectedCell ? "0 0 0 2px rgba(241,191,112,.32)" : "none",
                    font: "9px var(--mono)",
                    textAlign: "center",
                    opacity: index < normalizedPattern.length ? 1 : 0.38,
                  }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{active ? Math.round(step.velocity) : "·"}</strong>
                  <small style={{ fontSize: 8 }}>{step.ratchet > 1 ? `×${step.ratchet}` : `${Math.round(step.probability)}%`}</small>
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginTop: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 7, background: "#0d161d" }} aria-label={t("sequencer.selectedControls")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", font: "10px var(--mono)" }}>
            <span style={{ color: "var(--amber)" }}>{t("sequencer.step", { number: String(selectedStep + 1).padStart(2, "0") })}</span>
            <button type="button" style={{ ...toolbarButtonStyle, padding: "3px 6px" }} onClick={() => updateStep(selectedStep, { enabled: !selected.enabled }, t("status.stepChanged"))} aria-pressed={selected.enabled}>
              {selected.enabled ? t("sequencer.on") : t("sequencer.off")}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr))", gap: 12 }}>
            <Control label={t("piano.velocity")} ariaLabel="Velocity" min={1} max={127} value={selected.velocity} output={String(selected.velocity)} onChange={(value) => updateStep(selectedStep, { velocity: value }, t("status.stepChanged"))} />
            <Control label={t("sequencer.probability")} ariaLabel={t("sequencer.probability")} min={0} max={100} value={selected.probability} output={`${selected.probability}%`} onChange={(value) => updateStep(selectedStep, { probability: value }, t("status.stepChanged"))} />
            <Control label={t("sequencer.microShift")} ariaLabel={t("sequencer.microShift")} min={-50} max={50} value={selected.microShift} output={`${selected.microShift} ms`} onChange={(value) => updateStep(selectedStep, { microShift: value }, t("status.stepChanged"))} />
            <Control label={t("sequencer.ratchet")} ariaLabel={t("sequencer.ratchet")} min={1} max={4} value={selected.ratchet} output={`×${selected.ratchet}`} onChange={(value) => updateStep(selectedStep, { ratchet: clamp(value, 1, 4) as Ratchet }, t("status.stepChanged"))} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderTop: "1px solid var(--line)", color: "var(--muted)", font: "8px var(--mono)" }}>
        <span>{normalizedPattern.steps.slice(0, normalizedPattern.length).filter((step) => step.enabled).length} active steps</span>
        <span style={{ color: "var(--faint)" }}>{t("sequencer.footer")}</span>
        <span style={{ marginLeft: "auto", color: "var(--faint)" }}>{t("sequencer.history")}</span>
      </div>
    </section>
  );
}
