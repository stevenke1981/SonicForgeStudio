import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { PianoNote } from "../lib/pianoRoll";
import { PianoRoll } from "./PianoRoll";

describe("PianoRoll note identity", () => {
  it("allocates a unique ID after loading a template-sized note collection", async () => {
    const notes: PianoNote[] = Array.from({ length: 42 }, (_, index) => ({
      id: index + 1,
      pitch: 60 + (index % 8),
      tick: index * 4,
      duration: 4,
      velocity: 96,
    }));
    const onNotesChange = vi.fn<(notes: PianoNote[]) => void>();

    render(
      <I18nProvider initialLocale="en">
        <PianoRoll externalNotes={notes} onDirty={vi.fn()} onNotesChange={onNotesChange} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(onNotesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 43 }),
    ])));
    const latestNotes = onNotesChange.mock.calls.at(-1)?.[0] ?? [];
    expect(latestNotes).toHaveLength(43);
    expect(new Set(latestNotes.map((note) => note.id)).size).toBe(latestNotes.length);
  });
});
