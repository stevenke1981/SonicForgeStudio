import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("SonicForge Studio GUI shell", () => {
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

  it("opens the command palette from the visible shortcut button", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open SFX Lab/i }));
    await waitFor(() => expect(screen.getByTestId("sfx-panel")).toBeInTheDocument());
  });
});
