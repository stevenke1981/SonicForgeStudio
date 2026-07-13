import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { StepSequencer } from "./StepSequencer";
import { createDefaultStepPattern } from "./stepSequencerModel";
import type { StepPattern } from "./stepSequencerModel";

function StepSequencerHarness() {
  const [pattern, setPattern] = useState<StepPattern>(() => createDefaultStepPattern());
  return <StepSequencer pattern={pattern} dirty={false} onChange={setPatternWithDescription(setPattern)} />;
}

function setPatternWithDescription(setPattern: (pattern: StepPattern) => void) {
  return (nextPattern: StepPattern) => setPattern(nextPattern);
}

function renderSequencer() {
  return render(
    <I18nProvider initialLocale="en">
      <StepSequencerHarness />
    </I18nProvider>,
  );
}

describe("StepSequencer", () => {
  it("renders 1–64 steps and exposes keyboard navigation", () => {
    renderSequencer();
    const length = screen.getByRole("slider", { name: "Pattern length" });
    fireEvent.change(length, { target: { value: "64" } });

    expect(screen.getByRole("button", { name: "Step 64 inactive" })).toBeInTheDocument();
    const firstStep = screen.getByRole("button", { name: /Step 1 (active|inactive)$/ });
    firstStep.focus();
    fireEvent.keyDown(firstStep, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /Step 2 (active|inactive)$/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: /Step 2 (active|inactive)$/ }), { key: " " });
    expect(screen.getByRole("button", { name: "Step 2 active" })).toHaveAttribute("aria-pressed", "true");
  });

  it("edits velocity, probability, micro-shift, and ratchet for the selected step", () => {
    renderSequencer();
    fireEvent.click(screen.getByRole("button", { name: /Step 1 (active|inactive)$/ }));

    fireEvent.change(screen.getByRole("slider", { name: "Velocity" }), { target: { value: "80" } });
    fireEvent.change(screen.getByRole("slider", { name: "Probability" }), { target: { value: "65" } });
    fireEvent.change(screen.getByRole("slider", { name: "Micro-shift" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("slider", { name: "Ratchet" }), { target: { value: "4" } });

    expect(screen.getByRole("slider", { name: "Velocity" })).toHaveValue("80");
    expect(screen.getByRole("slider", { name: "Probability" })).toHaveValue("65");
    expect(screen.getByRole("slider", { name: "Micro-shift" })).toHaveValue("12");
    expect(screen.getByRole("slider", { name: "Ratchet" })).toHaveValue("4");
    expect(screen.getAllByText("×4")).toHaveLength(2);
  });

  it("supports swing, dirty status, and play/undo/redo controls", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onPlay = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <StepSequencer pattern={createDefaultStepPattern()} dirty canUndo canRedo onRedo={onRedo} onUndo={onUndo} onPlay={onPlay} onChange={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Swing" }), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Play pattern" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    expect(screen.getByTestId("sequencer-dirty-state")).toHaveTextContent("Unsaved changes");
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });
});
