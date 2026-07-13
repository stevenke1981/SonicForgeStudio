import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createDemoProject } from "../lib/tauri";
import type { ProjectSummary } from "../lib/tauri";
import { ProjectControls } from "./ProjectControls";

describe("ProjectControls save concurrency", () => {
  it("keeps newer edits dirty when an older save finishes", async () => {
    const project = createDemoProject();
    const newerProject = { ...project, bpm: project.bpm + 1 };
    let resolveSave: ((summary: ProjectSummary) => void) | undefined;
    const saveProjectAction = vi.fn(() => new Promise<ProjectSummary>((resolve) => {
      resolveSave = resolve;
    }));
    const onDirtyChange = vi.fn();
    const commonProps = {
      dirty: true,
      onProjectLoaded: vi.fn(),
      onDirtyChange,
      onAnnounce: vi.fn(),
      saveProjectAction,
    };

    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <ProjectControls {...commonProps} project={project} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(saveProjectAction).toHaveBeenCalledWith(project);

    rerender(
      <I18nProvider initialLocale="en">
        <ProjectControls {...commonProps} project={newerProject} />
      </I18nProvider>,
    );
    await act(async () => {
      resolveSave?.({ id: project.id, name: project.name, fileName: `${project.id}.sfsproj` });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ })).toBeEnabled());

    expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  });
});
