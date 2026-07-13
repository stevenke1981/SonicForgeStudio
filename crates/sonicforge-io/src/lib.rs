use std::{
    collections::BTreeSet,
    error::Error,
    fmt,
    fs::File,
    io::{Read, Seek, Write},
    path::Path,
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use sonicforge_core::project::{Project, PROJECT_SCHEMA_VERSION};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub mod journal;
pub mod midi;

const FORMAT_NAME: &str = "SonicForge Studio Project";
const MAX_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub schema_version: u32,
    pub project_file: String,
    pub modified_utc: String,
}

#[derive(Debug)]
pub enum ProjectIoError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Zip(zip::result::ZipError),
    Invalid(String),
}

impl fmt::Display for ProjectIoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "project I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "project JSON is invalid: {error}"),
            Self::Zip(error) => write!(formatter, "project archive is invalid: {error}"),
            Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl Error for ProjectIoError {}

impl From<std::io::Error> for ProjectIoError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ProjectIoError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<zip::result::ZipError> for ProjectIoError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::Zip(error)
    }
}

pub fn save_project_atomic(path: &Path, project: &Project) -> Result<(), ProjectIoError> {
    project
        .validate()
        .map_err(|message| ProjectIoError::Invalid(message.to_owned()))?;
    ensure_json_entry_fits(project, "project.json")?;
    let parent = path.parent().ok_or_else(|| {
        ProjectIoError::Invalid("project path has no parent directory".to_owned())
    })?;
    std::fs::create_dir_all(parent)?;
    AtomicFile::new(path, AllowOverwrite)
        .write(|temporary| write_project_archive(temporary, project))
        .map_err(|error| match error {
            atomicwrites::Error::Internal(error) => ProjectIoError::Io(error),
            atomicwrites::Error::User(error) => error,
        })
}

pub fn load_project(path: &Path) -> Result<Project, ProjectIoError> {
    let file = File::open(path)?;
    read_project_archive(file)
}

fn write_project_archive<W: Write + Seek>(
    writer: W,
    project: &Project,
) -> Result<(), ProjectIoError> {
    let modified_utc = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ProjectIoError::Invalid(format!("cannot format timestamp: {error}")))?;
    let manifest = Manifest {
        format: FORMAT_NAME.to_owned(),
        schema_version: PROJECT_SCHEMA_VERSION,
        project_file: "project.json".to_owned(),
        modified_utc,
    };
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut archive = ZipWriter::new(writer);
    archive.start_file("manifest.json", options)?;
    serde_json::to_writer_pretty(&mut archive, &manifest)?;
    archive.start_file("project.json", options)?;
    serde_json::to_writer_pretty(&mut archive, project)?;
    archive.finish()?;
    Ok(())
}

fn ensure_json_entry_fits<T: Serialize>(value: &T, name: &str) -> Result<(), ProjectIoError> {
    let mut writer = SizeLimitedWriter::new(MAX_ENTRY_BYTES);
    match serde_json::to_writer_pretty(&mut writer, value) {
        Ok(()) => Ok(()),
        Err(_) if writer.exceeded => Err(ProjectIoError::Invalid(format!(
            "{name} exceeds the maximum uncompressed size"
        ))),
        Err(error) => Err(ProjectIoError::Json(error)),
    }
}

struct SizeLimitedWriter {
    written: u64,
    limit: u64,
    exceeded: bool,
}

impl SizeLimitedWriter {
    const fn new(limit: u64) -> Self {
        Self {
            written: 0,
            limit,
            exceeded: false,
        }
    }
}

impl Write for SizeLimitedWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let next = self.written.saturating_add(buffer.len() as u64);
        if next > self.limit {
            self.exceeded = true;
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "serialized JSON exceeds its size limit",
            ));
        }
        self.written = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn read_project_archive<R: Read + Seek>(reader: R) -> Result<Project, ProjectIoError> {
    let mut archive = ZipArchive::new(reader)?;
    if archive.len() > MAX_ENTRIES {
        return Err(ProjectIoError::Invalid(
            "project archive has too many entries".to_owned(),
        ));
    }
    let mut total = 0_u64;
    let mut names = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name();
        if !matches!(name, "manifest.json" | "project.json") {
            return Err(ProjectIoError::Invalid(format!(
                "unexpected project entry: {name}"
            )));
        }
        if entry.enclosed_name().is_none() || entry.size() > MAX_ENTRY_BYTES {
            return Err(ProjectIoError::Invalid(
                "unsafe or oversized project entry".to_owned(),
            ));
        }
        if !names.insert(name.to_owned()) {
            return Err(ProjectIoError::Invalid(
                "project archive contains duplicate entries".to_owned(),
            ));
        }
        total = total.saturating_add(entry.size());
    }
    if names.len() != 2 {
        return Err(ProjectIoError::Invalid(
            "project archive must contain manifest.json and project.json".to_owned(),
        ));
    }
    if total > MAX_TOTAL_BYTES {
        return Err(ProjectIoError::Invalid(
            "project archive is too large".to_owned(),
        ));
    }

    let manifest: Manifest = read_json_entry(&mut archive, "manifest.json")?;
    if manifest.format != FORMAT_NAME
        || manifest.schema_version != PROJECT_SCHEMA_VERSION
        || manifest.project_file != "project.json"
    {
        return Err(ProjectIoError::Invalid(
            "unsupported project manifest".to_owned(),
        ));
    }
    let project: Project = read_json_entry(&mut archive, "project.json")?;
    project
        .validate()
        .map_err(|message| ProjectIoError::Invalid(message.to_owned()))?;
    Ok(project)
}

fn read_json_entry<T: for<'de> Deserialize<'de>>(
    archive: &mut ZipArchive<impl Read + Seek>,
    name: &str,
) -> Result<T, ProjectIoError> {
    let entry = archive.by_name(name)?;
    let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0).min(64 * 1024));
    entry.take(MAX_ENTRY_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ENTRY_BYTES {
        return Err(ProjectIoError::Invalid(
            "project JSON entry is too large".to_owned(),
        ));
    }
    Ok(serde_json::from_slice(&bytes)?)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use sonicforge_core::project::Project;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{load_project, save_project_atomic, ProjectIoError, MAX_ENTRY_BYTES};

    #[test]
    fn project_round_trip_is_lossless() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("round-trip.sfsproj");
        let project = Project::demo();
        save_project_atomic(&path, &project).expect("save project");
        assert_eq!(load_project(&path).expect("load project"), project);
    }

    #[test]
    fn atomic_save_replaces_an_existing_project() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("replace.sfsproj");
        let original = Project::demo();
        save_project_atomic(&path, &original).expect("save original project");

        let mut replacement = original.clone();
        replacement.name = "Replacement".to_owned();
        save_project_atomic(&path, &replacement).expect("replace project");

        assert_eq!(load_project(&path).expect("load replacement"), replacement);
    }

    #[test]
    fn oversized_project_is_rejected_without_replacing_existing_file() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("size-limit.sfsproj");
        let original = Project::demo();
        save_project_atomic(&path, &original).expect("save original project");

        let mut oversized = original.clone();
        oversized.name = "x".repeat(MAX_ENTRY_BYTES as usize);
        let error = save_project_atomic(&path, &oversized).expect_err("reject oversized project");

        assert!(matches!(error, ProjectIoError::Invalid(_)));
        assert_eq!(
            load_project(&path).expect("load original project"),
            original
        );
    }

    #[test]
    fn schema_v1_golden_project_remains_readable() {
        let golden = include_str!("../tests/golden/project-v1.json");
        let project: Project = serde_json::from_str(golden).expect("parse golden project");
        assert_eq!(project.validate(), Ok(()));
    }

    #[test]
    fn duplicate_archive_entries_are_rejected() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer
            .start_file("manifest.json", options)
            .expect("manifest");
        writer.write_all(b"{}").expect("manifest bytes");
        writer
            .start_file("manifesx.json", options)
            .expect("temporary distinct entry");
        writer.write_all(b"{}").expect("second entry bytes");
        let mut bytes = writer
            .finish()
            .expect("finish fixture archive")
            .into_inner();

        let replacements = replace_all_same_length(&mut bytes, b"manifesx.json", b"manifest.json");
        assert_eq!(replacements, 2, "local and central ZIP entry names");

        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("duplicate.sfsproj");
        std::fs::write(&path, bytes).expect("write duplicate fixture");
        let error = load_project(&path).expect_err("reject duplicate archive entries");
        // zip may coalesce duplicate central-directory names before iteration;
        // both outcomes reject the hostile archive before JSON parsing.
        assert!(matches!(
            error,
            ProjectIoError::Invalid(ref message)
                if message == "project archive contains duplicate entries"
                    || message == "project archive must contain manifest.json and project.json"
        ));
    }

    fn replace_all_same_length(bytes: &mut [u8], from: &[u8], to: &[u8]) -> usize {
        assert_eq!(from.len(), to.len());
        let mut replacements = 0;
        let mut offset = 0;
        while let Some(relative) = bytes[offset..]
            .windows(from.len())
            .position(|window| window == from)
        {
            let start = offset + relative;
            bytes[start..start + from.len()].copy_from_slice(to);
            replacements += 1;
            offset = start + from.len();
        }
        replacements
    }
}
