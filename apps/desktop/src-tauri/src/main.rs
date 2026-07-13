#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use sonicforge_audio::{AudioDeviceInfo, AudioDeviceManager, AudioStatus};
use sonicforge_core::project::Project;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
    shell: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    file_name: String,
}

struct AppState {
    audio: Mutex<AudioDeviceManager>,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "SonicForge Studio",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        shell: "tauri-rust",
    }
}

#[tauri::command]
fn get_audio_status(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    Ok(audio.status())
}

#[tauri::command]
fn list_audio_devices(state: tauri::State<'_, AppState>) -> Result<Vec<AudioDeviceInfo>, String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    audio
        .list_output_devices()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_audio_device(
    device_id: Option<String>,
    sample_rate: u32,
    buffer_size: u32,
    state: tauri::State<'_, AppState>,
) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    audio
        .start_test_tone(device_id.as_deref(), sample_rate, buffer_size)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_audio_device(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    Ok(audio.stop())
}

#[tauri::command]
async fn save_project(app: tauri::AppHandle, project: Project) -> Result<ProjectSummary, String> {
    let root = project_root(&app)?;
    let file_name = project_file_name(&project.id)?;
    let name = project.name.clone();
    let id = project.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = root.join(&file_name);
        sonicforge_io::save_project_atomic(&path, &project).map_err(|error| error.to_string())?;
        Ok(ProjectSummary {
            id,
            name,
            file_name,
        })
    })
    .await
    .map_err(|error| format!("project save task failed: {error}"))?
}

#[tauri::command]
async fn load_project(app: tauri::AppHandle, project_id: String) -> Result<Project, String> {
    let root = project_root(&app)?;
    let file_name = project_file_name(&project_id)?;
    tauri::async_runtime::spawn_blocking(move || load_project_file(&root, &file_name))
        .await
        .map_err(|error| format!("project load task failed: {error}"))?
}

#[tauri::command]
async fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let root = project_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_project_files(&root))
        .await
        .map_err(|error| format!("project list task failed: {error}"))?
}

fn project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("projects"))
        .map_err(|error| format!("cannot resolve local project directory: {error}"))
}

fn project_file_name(project_id: &str) -> Result<String, String> {
    if project_id.is_empty()
        || project_id.len() > 64
        || !project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("project id must contain only ASCII letters, numbers, '-' or '_'".to_owned());
    }
    Ok(format!("{project_id}.sfsproj"))
}

fn canonical_project_root(root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("cannot create project directory: {error}"))?;
    std::fs::canonicalize(root)
        .map_err(|error| format!("cannot resolve project directory: {error}"))
}

fn canonicalize_project_file(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("cannot resolve project file: {error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("project file resolves outside the project directory".to_owned());
    }
    if !canonical.is_file() {
        return Err("project path is not a file".to_owned());
    }
    Ok(canonical)
}

fn load_project_file(root: &Path, file_name: &str) -> Result<Project, String> {
    let root = canonical_project_root(root)?;
    let path = canonicalize_project_file(&root, &root.join(file_name))?;
    sonicforge_io::load_project(&path).map_err(|error| error.to_string())
}

fn list_project_files(root: &Path) -> Result<Vec<ProjectSummary>, String> {
    let root = canonical_project_root(root)?;
    let mut projects = Vec::new();
    for entry in
        std::fs::read_dir(&root).map_err(|error| format!("cannot read projects: {error}"))?
    {
        let entry = entry.map_err(|error| format!("cannot read project entry: {error}"))?;
        let listed_path = entry.path();
        if listed_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("sfsproj")
        {
            continue;
        }
        let Ok(path) = canonicalize_project_file(&root, &listed_path) else {
            continue;
        };
        let Ok(project) = sonicforge_io::load_project(&path) else {
            continue;
        };
        let Some(file_name) = listed_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        projects.push(ProjectSummary {
            id: project.id,
            name: project.name,
            file_name: file_name.to_owned(),
        });
    }
    projects.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(projects)
}

fn main() {
    let result = tauri::Builder::default()
        .manage(AppState {
            audio: Mutex::new(AudioDeviceManager::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_audio_status,
            list_audio_devices,
            start_audio_device,
            stop_audio_device,
            save_project,
            load_project,
            list_projects
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("error while running SonicForge Studio: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use sonicforge_core::project::Project;

    use super::{list_project_files, load_project_file, project_file_name};

    #[test]
    fn project_file_name_rejects_path_traversal() {
        assert!(project_file_name("../escape").is_err());
        assert_eq!(
            project_file_name("safe-project"),
            Ok("safe-project.sfsproj".to_owned())
        );
    }

    #[test]
    fn load_and_list_reject_paths_that_resolve_outside_project_root() {
        let directory = tempfile::tempdir().expect("tempdir");
        let root = directory.path().join("projects");
        std::fs::create_dir_all(&root).expect("project root");
        let outside = directory.path().join("outside.sfsproj");
        sonicforge_io::save_project_atomic(&outside, &Project::demo()).expect("outside project");

        let error = load_project_file(&root, "../outside.sfsproj")
            .expect_err("reject project outside root");
        assert!(error.contains("outside the project directory"));

        let link = root.join("linked.sfsproj");
        if let Err(error) = symlink_file(&outside, &link) {
            #[cfg(windows)]
            if error.raw_os_error() == Some(1314) {
                return;
            }
            panic!("cannot create test symlink: {error}");
        }

        let error =
            load_project_file(&root, "linked.sfsproj").expect_err("reject symlink outside root");
        assert!(error.contains("outside the project directory"));
        assert!(list_project_files(&root).expect("list projects").is_empty());
    }

    #[cfg(unix)]
    fn symlink_file(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn symlink_file(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }
}
