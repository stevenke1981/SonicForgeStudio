import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, loadProject, saveAutosavePreference, saveProject } from "../lib/tauri";
import type { Project, ProjectSummary } from "../lib/tauri";
import { useTranslation } from "../i18n";

interface ProjectControlsProps {
  project: Project;
  dirty: boolean;
  onProjectLoaded: (project: Project) => void;
  onDirtyChange: (dirty: boolean) => void;
  onAnnounce: (message: string) => void;
  saveProjectAction?: (project: Project) => Promise<ProjectSummary>;
}

export function ProjectControls({ project, dirty, onProjectLoaded, onDirtyChange, onAnnounce, saveProjectAction = saveProject }: ProjectControlsProps) {
  const t = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(project.id);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveInterval, setAutosaveInterval] = useState(2);
  const [busy, setBusy] = useState(false);
  const latestProject = useRef(project);
  latestProject.current = project;

  const refreshProjects = useCallback(async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    if (nextProjects.some((item) => item.id === project.id)) setSelectedProjectId(project.id);
  }, [project.id]);

  useEffect(() => {
    void refreshProjects().catch(() => setProjects([]));
  }, [refreshProjects]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty) return;
    const timer = window.setTimeout(() => {
      const snapshot = project;
      saveProjectAction(snapshot)
        .then(() => {
          if (latestProject.current === snapshot) {
            onDirtyChange(false);
            onAnnounce(t("template.autosaved", { name: snapshot.name }));
          }
          return refreshProjects();
        })
        .catch((error: unknown) => onAnnounce(error instanceof Error ? error.message : t("status.autosaveFailed")));
    }, autosaveInterval * 60_000);
    return () => window.clearTimeout(timer);
  }, [autosaveEnabled, autosaveInterval, dirty, onAnnounce, onDirtyChange, project, refreshProjects, saveProjectAction, t]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onAnnounce(error instanceof Error ? error.message : t("status.projectCommandFailed"));
    } finally {
      setBusy(false);
    }
  };

  const load = () => run(async () => {
    const loaded = await loadProject(selectedProjectId);
    onProjectLoaded(loaded);
    onDirtyChange(false);
    onAnnounce(t("template.loaded", { name: loaded.name }));
  });

  const save = () => run(async () => {
    const snapshot = project;
    const summary = await saveProjectAction(snapshot);
    if (latestProject.current === snapshot) {
      onDirtyChange(false);
      setSelectedProjectId(summary.id);
      onAnnounce(t("template.saved", { fileName: summary.fileName }));
    }
    await refreshProjects();
  });

  const saveAs = () => run(async () => {
    const snapshot = project;
    const copyNumber = projects.filter((item) => item.id.startsWith(`${snapshot.id}-copy`)).length + 1;
    const copy: Project = { ...snapshot, id: `${snapshot.id}-copy-${copyNumber}`, name: `${snapshot.name} Copy ${copyNumber}` };
    const summary = await saveProjectAction(copy);
    if (latestProject.current === snapshot) {
      onProjectLoaded(copy);
      onDirtyChange(false);
      setSelectedProjectId(summary.id);
      onAnnounce(t("template.savedAs", { fileName: summary.fileName }));
    }
    await refreshProjects();
  });

  const setAutosave = (enabled: boolean, interval = autosaveInterval) => {
    setAutosaveEnabled(enabled);
    setAutosaveInterval(interval);
    saveAutosavePreference(enabled, interval);
    onAnnounce(enabled ? t("template.autosaveEvery", { minutes: interval }) : t("status.autosaveDisabled"));
  };

  return (
    <div className="project-controls" aria-label={t("project.controls")}>
      <div className="project-identity" title={`${project.id}.sfsproj`}>
        <span className={`dirty-indicator ${dirty ? "dirty" : "clean"}`} aria-hidden="true" />
        <span>{project.name}</span>
        <small aria-label={t("project.saveStatus")}>{dirty ? t("project.unsaved") : t("project.saved")}</small>
      </div>
      <select className="project-picker" aria-label={t("project.savedProjects")} value={selectedProjectId} disabled={projects.length === 0} onChange={(event) => setSelectedProjectId(event.target.value)}>
        {projects.length === 0 ? <option value={project.id}>{t("project.noSavedProjects")}</option> : projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button type="button" className="ghost-button" disabled={busy || projects.length === 0} onClick={load}>{t("project.open")}</button>
      <button type="button" className="primary-button" disabled={busy || !dirty} onClick={save}>{t("project.save")}</button>
      <button type="button" className="ghost-button" disabled={busy} onClick={saveAs}>{t("project.saveAs")}</button>
      <label className="autosave-control">
        <input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosave(event.target.checked)} />
        <span>{t("project.autosave")}</span>
        <select aria-label={t("project.autosaveInterval")} value={autosaveInterval} disabled={!autosaveEnabled} onChange={(event) => setAutosave(true, Number(event.target.value))}>
          <option value="1">{t("project.minute.one")}</option><option value="2">{t("project.minute.two")}</option><option value="5">{t("project.minute.five")}</option><option value="10">{t("project.minute.ten")}</option>
        </select>
      </label>
    </div>
  );
}
