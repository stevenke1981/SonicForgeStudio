#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de, Deserialize, Serialize};
use sonicforge_audio::{
    render_offline, AudioDeviceInfo, AudioDeviceManager, AudioStatus, GraphSnapshot, TransportPoll,
};
use sonicforge_core::project::Project;
use sonicforge_io::{journal::RecoveryJournal, midi::MidiFormat};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProjectWavResult {
    path: String,
    file_name: String,
    frames: u64,
    sample_rate: u32,
}

const MAX_WAV_EXPORT_FRAMES: u64 = 50_000_000;
static EXPORT_LOCK: Mutex<()> = Mutex::new(());
static EXPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct BoundedMidiBytes(Vec<u8>);

impl<'de> Deserialize<'de> for BoundedMidiBytes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        struct Visitor;

        impl<'de> de::Visitor<'de> for Visitor {
            type Value = BoundedMidiBytes;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a MIDI byte array up to 64 MiB")
            }

            fn visit_bytes<E>(self, value: &[u8]) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.len() > sonicforge_io::midi::MAX_MIDI_BYTES {
                    return Err(E::custom("MIDI payload exceeds the 64 MiB IPC limit"));
                }
                Ok(BoundedMidiBytes(value.to_owned()))
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: de::SeqAccess<'de>,
            {
                let mut bytes = Vec::with_capacity(4096);
                while let Some(byte) = sequence.next_element::<u8>()? {
                    if bytes.len() >= sonicforge_io::midi::MAX_MIDI_BYTES {
                        return Err(de::Error::custom(
                            "MIDI payload exceeds the 64 MiB IPC limit",
                        ));
                    }
                    bytes.push(byte);
                }
                Ok(BoundedMidiBytes(bytes))
            }
        }

        deserializer.deserialize_bytes(Visitor)
    }
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
fn transport_start(
    project: Project,
    device_id: Option<String>,
    sample_rate: u32,
    buffer_size: u32,
    start_position_samples: u64,
    state: tauri::State<'_, AppState>,
) -> Result<AudioStatus, String> {
    let requested_sample_rate = if sample_rate == 0 {
        project.sample_rate
    } else {
        sample_rate
    };
    let snapshot = GraphSnapshot::from_project(&project, requested_sample_rate)
        .map_err(|error| error.to_string())?;
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    audio
        .start_playback(
            snapshot,
            device_id.as_deref(),
            requested_sample_rate,
            buffer_size,
        )
        .map_err(|error| error.to_string())?;
    let controller = audio
        .playback_controller()
        .ok_or_else(|| "transport graph was not created".to_owned())?;
    if start_position_samples > 0 {
        controller
            .seek_samples(start_position_samples)
            .map_err(|error| error.to_string())?;
    }
    controller.play().map_err(|error| error.to_string())?;
    Ok(audio.status())
}

#[tauri::command]
fn transport_play(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    let controller = audio
        .playback_controller()
        .ok_or_else(|| "transport graph is not prepared".to_owned())?;
    controller.play().map_err(|error| error.to_string())?;
    Ok(audio.status())
}

#[tauri::command]
fn transport_pause(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    if let Some(controller) = audio.playback_controller() {
        controller.pause().map_err(|error| error.to_string())?;
    }
    Ok(audio.status())
}

#[tauri::command]
fn transport_stop(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    if let Some(controller) = audio.playback_controller() {
        controller.stop().map_err(|error| error.to_string())?;
    }
    Ok(audio.status())
}

#[tauri::command]
fn transport_seek(
    position_samples: u64,
    state: tauri::State<'_, AppState>,
) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    audio
        .playback_controller()
        .ok_or_else(|| "transport graph is not available".to_owned())?
        .seek_samples(position_samples)
        .map_err(|error| error.to_string())?;
    Ok(audio.status())
}

#[tauri::command]
fn get_transport_position(state: tauri::State<'_, AppState>) -> Result<TransportPoll, String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "audio control state is unavailable".to_owned())?;
    Ok(audio.poll_transport_position())
}

#[tauri::command]
async fn save_project(app: tauri::AppHandle, project: Project) -> Result<ProjectSummary, String> {
    let root = project_root(&app)?;
    let file_name = project_file_name(&project.id)?;
    let name = project.name.clone();
    let id = project.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = root.join(&file_name);
        let journal = RecoveryJournal::new(recovery_journal_path(&root, &id)?);
        journal
            .append(&project)
            .map_err(|error| error.to_string())?;
        sonicforge_io::save_project_atomic(&path, &project).map_err(|error| error.to_string())?;
        journal.clear().map_err(|error| {
            format!("project saved but recovery journal cleanup failed: {error}")
        })?;
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
async fn write_recovery_journal(app: tauri::AppHandle, project: Project) -> Result<u64, String> {
    let root = project_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        RecoveryJournal::new(recovery_journal_path(&root, &project.id)?)
            .append(&project)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("recovery journal task failed: {error}"))?
}

#[tauri::command]
async fn recover_project(app: tauri::AppHandle) -> Result<Option<Project>, String> {
    let root = project_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let mut recovered: Option<(Project, Option<std::time::SystemTime>)> = None;
        for entry in std::fs::read_dir(&root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with(".recovery-") || !name.ends_with(".journal") {
                continue;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok();
            let snapshot = RecoveryJournal::new(path)
                .recover()
                .map_err(|error| error.to_string())?
                .latest;
            if let Some(snapshot) = snapshot {
                let replace = recovered
                    .as_ref()
                    .is_none_or(|(_, current_modified)| modified > *current_modified);
                if replace {
                    recovered = Some((snapshot.project, modified));
                }
            }
        }
        Ok(recovered.map(|(project, _)| project))
    })
    .await
    .map_err(|error| format!("recovery journal task failed: {error}"))?
}

#[tauri::command]
fn import_midi(bytes: BoundedMidiBytes) -> Result<Project, String> {
    sonicforge_io::midi::import_midi(&bytes.0).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_midi(project: Project, format: String) -> Result<Vec<u8>, String> {
    let format = match format.to_ascii_lowercase().as_str() {
        "type0" | "0" => MidiFormat::Type0,
        "type1" | "1" => MidiFormat::Type1,
        _ => return Err("MIDI format must be type0 or type1".to_owned()),
    };
    sonicforge_io::midi::export_midi(&project, format).map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_project_wav(
    app: tauri::AppHandle,
    project: Project,
    file_name: String,
) -> Result<ExportProjectWavResult, String> {
    let file_name = validate_export_file_name(&file_name)?;
    let root = export_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        export_project_wav_file(&root, project, &file_name)
    })
    .await
    .map_err(|error| format!("WAV export task failed: {error}"))?
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

fn export_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("exports"))
        .map_err(|error| format!("cannot resolve local export directory: {error}"))
}

fn validate_export_file_name(file_name: &str) -> Result<String, String> {
    if file_name.is_empty() {
        return Err("export file name must be 1..255 bytes".to_owned());
    }
    if file_name
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("export file name cannot contain whitespace or control characters".to_owned());
    }
    if file_name.chars().any(|character| {
        matches!(
            character,
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        )
    }) {
        return Err("export file name contains an unsafe path character".to_owned());
    }
    if file_name == "." || file_name == ".." || file_name.contains("..") {
        return Err("export file name cannot contain path traversal".to_owned());
    }
    if file_name.ends_with('.') {
        return Err("export file name cannot end with a dot".to_owned());
    }

    let normalized = match file_name.rsplit_once('.') {
        Some((stem, extension)) if extension.eq_ignore_ascii_case("wav") && !stem.is_empty() => {
            file_name.to_owned()
        }
        Some(_) => return Err("export file name must use the .wav extension".to_owned()),
        None => format!("{file_name}.wav"),
    };
    if normalized.len() > 255 {
        return Err("export file name must be 1..255 bytes including extension".to_owned());
    }
    let stem = normalized
        .rsplit_once('.')
        .map_or(normalized.as_str(), |(stem, _)| stem);
    let device_component = stem.split('.').next().unwrap_or(stem).to_ascii_uppercase();
    let reserved = matches!(device_component.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            device_component.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if reserved {
        return Err("export file name is reserved by the operating system".to_owned());
    }
    Ok(normalized)
}

fn export_project_wav_file(
    root: &Path,
    project: Project,
    file_name: &str,
) -> Result<ExportProjectWavResult, String> {
    let _export_guard = EXPORT_LOCK
        .lock()
        .map_err(|_| "WAV export coordinator is unavailable".to_owned())?;
    let file_name = validate_export_file_name(file_name)?;
    let snapshot = GraphSnapshot::from_project(&project, project.sample_rate)
        .map_err(|error| error.to_string())?;
    let duration_samples = snapshot.duration_samples();
    if duration_samples == 0 {
        return Err("cannot export an empty project".to_owned());
    }
    if duration_samples > MAX_WAV_EXPORT_FRAMES {
        return Err("WAV export duration exceeds the allocation limit".to_owned());
    }
    let frames = usize::try_from(duration_samples)
        .map_err(|_| "WAV export duration is not representable on this platform".to_owned())?;
    let rendered = render_offline(snapshot.as_ref(), frames).map_err(|error| error.to_string())?;

    std::fs::create_dir_all(root)
        .map_err(|error| format!("cannot create export directory: {error}"))?;
    let path = root.join(&file_name);
    let unique = EXPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = root.join(format!(
        ".{file_name}.{}.{}.{}.tmp",
        std::process::id(),
        timestamp,
        unique
    ));
    sonicforge_core::wav::write_pcm16_stereo(&temporary_path, snapshot.sample_rate(), &rendered)
        .map_err(|error| format!("cannot write WAV export: {error}"))?;
    if let Err(error) = std::fs::OpenOptions::new()
        .write(true)
        .open(&temporary_path)
        .and_then(|file| file.sync_all())
    {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("cannot flush WAV export: {error}"));
    }
    if let Err(error) = std::fs::hard_link(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!(
            "cannot finalize WAV export without overwriting an existing file: {error}"
        ));
    }
    let _ = std::fs::remove_file(&temporary_path);

    Ok(ExportProjectWavResult {
        path: path.to_string_lossy().into_owned(),
        file_name,
        frames: duration_samples,
        sample_rate: snapshot.sample_rate(),
    })
}

fn recovery_journal_path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    let file_name = project_file_name(project_id)?;
    Ok(root.join(format!(".recovery-{file_name}.journal")))
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
            transport_start,
            transport_play,
            transport_pause,
            transport_stop,
            transport_seek,
            get_transport_position,
            save_project,
            load_project,
            list_projects,
            write_recovery_journal,
            recover_project,
            import_midi,
            export_midi,
            export_project_wav
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("error while running SonicForge Studio: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use sonicforge_core::{project::Project, sequence::NoteEvent};

    use super::{
        export_project_wav_file, list_project_files, load_project_file, project_file_name,
        validate_export_file_name,
    };

    #[test]
    fn project_file_name_rejects_path_traversal() {
        assert!(project_file_name("../escape").is_err());
        assert_eq!(
            project_file_name("safe-project"),
            Ok("safe-project.sfsproj".to_owned())
        );
    }

    #[test]
    fn export_file_name_validation_rejects_unsafe_names() {
        for file_name in [
            "",
            " ",
            "studio mix.wav",
            "../escape.wav",
            "..\\escape.wav",
            "CON.wav",
            "com1",
            "COM1.backup.wav",
            "LPT9.wav",
            "LPT².mix.wav",
            "report.txt",
        ] {
            assert!(
                validate_export_file_name(file_name).is_err(),
                "{file_name:?} should be rejected"
            );
        }
        assert_eq!(
            validate_export_file_name("laser.wav"),
            Ok("laser.wav".to_owned())
        );
        assert_eq!(
            validate_export_file_name("laser"),
            Ok("laser.wav".to_owned())
        );
    }

    #[test]
    fn export_helper_rejects_empty_graph_without_tauri_runtime() {
        let mut project = Project::demo();
        project.tracks[0].pattern.notes.clear();
        let directory = tempfile::tempdir().expect("tempdir");

        let error = export_project_wav_file(directory.path(), project, "empty.wav")
            .expect_err("empty project should not export");
        assert!(error.contains("empty project"));
    }

    #[test]
    fn export_helper_writes_pcm16_stereo_wav_without_tauri_runtime() {
        let mut project = Project::demo();
        project.tracks[0].pattern.notes = vec![NoteEvent::new(0.0, 0.01, 60, 0.5)];
        let directory = tempfile::tempdir().expect("tempdir");

        let result = export_project_wav_file(directory.path(), project.clone(), "tone")
            .expect("export helper");
        let bytes = std::fs::read(&result.path).expect("read exported wav");

        assert_eq!(result.file_name, "tone.wav");
        assert!(result.frames > 0);
        assert_eq!(result.sample_rate, 48_000);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(bytes.len(), 44 + result.frames as usize * 4);
        assert!(bytes[44..].iter().any(|byte| *byte != 0));

        let duplicate = export_project_wav_file(directory.path(), project, "tone")
            .expect_err("existing export must not be overwritten");
        assert!(duplicate.contains("without overwriting"));
        assert_eq!(std::fs::read(&result.path).expect("read original"), bytes);
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
