import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("saves a user-named copy and switches to the new project", async () => {
    const project = createDemoProject();
    const saveProjectAction = vi.fn(async (copy: typeof project): Promise<ProjectSummary> => ({
      id: copy.id,
      name: copy.name,
      fileName: `${copy.id}.sfsproj`,
    }));
    const onProjectLoaded = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProjectControls
          project={project}
          dirty
          onProjectLoaded={onProjectLoaded}
          onDirtyChange={onDirtyChange}
          onAnnounce={vi.fn()}
          saveProjectAction={saveProjectAction}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    const dialog = screen.getByRole("dialog", { name: "Save project as" });
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Night Sketch" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Safe project ID" }), { target: { value: "night-sketch" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save As" }));

    await waitFor(() => expect(saveProjectAction).toHaveBeenCalled());
    expect(saveProjectAction.mock.calls[0][0]).toMatchObject({ id: "night-sketch", name: "Night Sketch" });
    expect(onProjectLoaded).toHaveBeenCalledWith(expect.objectContaining({ id: "night-sketch", name: "Night Sketch" }));
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });
});
