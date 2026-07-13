import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { listProjects, loadProject, saveAutosavePreference, saveProject } from "../lib/tauri";
import type { Project, ProjectSummary } from "../lib/tauri";
import { useTranslation } from "../i18n";
import type { Translate } from "../i18n";

interface ProjectControlsProps {
  project: Project;
  dirty: boolean;
  onProjectLoaded: (project: Project) => void;
  onDirtyChange: (dirty: boolean) => void;
  onAnnounce: (message: string) => void;
  saveProjectAction?: (project: Project) => Promise<ProjectSummary>;
}

const SAFE_PROJECT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function validateSaveAs(name: string, id: string, projects: ProjectSummary[], currentId: string, t: Translate): string | null {
  const trimmedName = name.trim();
  const trimmedId = id.trim();
  const hasUnsafeNameCharacter = [...trimmedName].some((character) => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character));
  if (!trimmedName || trimmedName.length > 120 || hasUnsafeNameCharacter) return t("project.invalidName");
  if (!SAFE_PROJECT_ID.test(trimmedId)) return t("project.invalidId");
  if (trimmedId !== currentId && projects.some((item) => item.id === trimmedId)) return t("project.idExists");
  return null;
}

export function ProjectControls({ project, dirty, onProjectLoaded, onDirtyChange, onAnnounce, saveProjectAction = saveProject }: ProjectControlsProps) {
  const t = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(project.id);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveInterval, setAutosaveInterval] = useState(2);
  const [busy, setBusy] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsId, setSaveAsId] = useState("");
  const [saveAsError, setSaveAsError] = useState("");
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

  const openSaveAs = () => {
    const suggestedId = `${project.id}-copy`;
    setSaveAsName(`${project.name} Copy`);
    setSaveAsId(suggestedId);
    setSaveAsError("");
    setSaveAsOpen(true);
  };

  const submitSaveAs = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const error = validateSaveAs(saveAsName, saveAsId, projects, project.id, t);
    if (error) {
      setSaveAsError(error);
      return;
    }
    setBusy(true);
    setSaveAsError("");
    try {
      const snapshot = project;
      const copy = JSON.parse(JSON.stringify(snapshot)) as Project;
      copy.id = saveAsId.trim();
      copy.name = saveAsName.trim();
      const summary = await saveProjectAction(copy);
      if (latestProject.current === snapshot) {
        onProjectLoaded(copy);
        onDirtyChange(false);
        setSelectedProjectId(summary.id);
        onAnnounce(t("template.savedAs", { fileName: summary.fileName }));
      }
      setSaveAsOpen(false);
      await refreshProjects();
    } catch (errorValue: unknown) {
      const message = errorValue instanceof Error ? errorValue.message : t("status.projectCommandFailed");
      setSaveAsError(message);
      onAnnounce(message);
    } finally {
      setBusy(false);
    }
  };

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
      <button type="button" className="ghost-button" disabled={busy} onClick={openSaveAs}>{t("project.saveAs")}</button>
      <label className="autosave-control">
        <input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosave(event.target.checked)} />
        <span>{t("project.autosave")}</span>
        <select aria-label={t("project.autosaveInterval")} value={autosaveInterval} disabled={!autosaveEnabled} onChange={(event) => setAutosave(true, Number(event.target.value))}>
          <option value="1">{t("project.minute.one")}</option><option value="2">{t("project.minute.two")}</option><option value="5">{t("project.minute.five")}</option><option value="10">{t("project.minute.ten")}</option>
        </select>
      </label>
      {saveAsOpen && <SaveAsDialog
        name={saveAsName}
        id={saveAsId}
        error={saveAsError}
        busy={busy}
        onNameChange={setSaveAsName}
        onIdChange={setSaveAsId}
        onCancel={() => { if (!busy) setSaveAsOpen(false); }}
        onSubmit={submitSaveAs}
      />}
    </div>
  );
}

function SaveAsDialog({ name, id, error, busy, onNameChange, onIdChange, onCancel, onSubmit }: {
  name: string;
  id: string;
  error: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onIdChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, []);
  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section ref={dialogRef} className="save-as-dialog" role="dialog" aria-modal="true" aria-label={t("project.saveAsDialog")} onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
      <div className="settings-heading"><div><div className="eyebrow">{t("project.saveAsEyebrow")}</div><h2>{t("project.saveAsDialog")}</h2></div><button type="button" className="tiny-button" aria-label={t("project.closeSaveAs")} onClick={onCancel}>×</button></div>
      <p className="settings-copy">{t("project.saveAsDescription")}</p>
      <form className="save-as-form" onSubmit={onSubmit}>
        <label><span>{t("project.nameLabel")}</span><input autoComplete="off" value={name} onChange={(event) => onNameChange(event.target.value)} /></label>
        <label><span>{t("project.idLabel")}</span><input autoComplete="off" spellCheck={false} value={id} onChange={(event) => onIdChange(event.target.value)} /></label>
        {error && <div className="modal-error" role="alert">{error}</div>}
        <div className="settings-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>{t("project.cancel")}</button><button type="submit" className="primary-button" disabled={busy}>{busy ? t("project.saving") : t("project.saveAs")}</button></div>
      </form>
    </section>
  </div>;
}
