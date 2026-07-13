use std::{
    error::Error,
    fmt,
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use sonicforge_core::Project;

const JOURNAL_MAGIC: &[u8; 4] = b"SFRJ";
const JOURNAL_VERSION: u8 = 1;
const JOURNAL_HEADER_BYTES: usize = 4 + 1 + 8 + 4 + 4;
const CHECKPOINT_MAGIC: &str = "SonicForge Recovery Checkpoint";
const CHECKPOINT_VERSION: u32 = 1;

pub const DEFAULT_MAX_JOURNAL_RECORDS: usize = 256;
pub const DEFAULT_MAX_JOURNAL_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_MAX_JOURNAL_RECORD_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JournalConfig {
    pub max_records: usize,
    pub max_bytes: u64,
    pub max_record_bytes: usize,
}

impl Default for JournalConfig {
    fn default() -> Self {
        Self {
            max_records: DEFAULT_MAX_JOURNAL_RECORDS,
            max_bytes: DEFAULT_MAX_JOURNAL_BYTES,
            max_record_bytes: DEFAULT_MAX_JOURNAL_RECORD_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JournalTail {
    Clean,
    Truncated { offset: u64 },
    Corrupt { offset: u64 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecoverySnapshot {
    pub sequence: u64,
    pub project: Project,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecoveryState {
    pub latest: Option<RecoverySnapshot>,
    pub valid_records: usize,
    pub tail: JournalTail,
}

#[derive(Debug)]
pub enum JournalError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Invalid(String),
    LimitExceeded(String),
    CheckpointCorrupt(String),
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "recovery journal I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "recovery journal JSON failed: {error}"),
            Self::Invalid(message) => write!(formatter, "invalid recovery journal: {message}"),
            Self::LimitExceeded(message) => {
                write!(formatter, "recovery journal limit exceeded: {message}")
            }
            Self::CheckpointCorrupt(message) => {
                write!(formatter, "recovery checkpoint is corrupt: {message}")
            }
        }
    }
}

impl Error for JournalError {}

impl From<std::io::Error> for JournalError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for JournalError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Clone)]
pub struct RecoveryJournal {
    path: PathBuf,
    config: JournalConfig,
}

#[derive(Debug, Serialize, Deserialize)]
struct CheckpointFile {
    magic: String,
    version: u32,
    sequence: u64,
    project: Project,
}

#[derive(Debug)]
struct JournalScan {
    records: Vec<RecoverySnapshot>,
    valid_offset: u64,
    last_sequence: Option<u64>,
    tail: JournalTail,
}

impl RecoveryJournal {
    /// Creates a journal that only records validated project snapshots. It has no
    /// API for arbitrary bytes, log messages, credentials, or secret metadata.
    #[must_use]
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_owned(),
            config: JournalConfig::default(),
        }
    }

    pub fn with_config(
        path: impl AsRef<Path>,
        config: JournalConfig,
    ) -> Result<Self, JournalError> {
        validate_config(config)?;
        Ok(Self {
            path: path.as_ref().to_owned(),
            config,
        })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Removes the transient recovery snapshot after a durable project save.
    pub fn clear(&self) -> Result<(), JournalError> {
        for path in [&self.path, &self.checkpoint_path()] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(JournalError::Io(error)),
            }
        }
        Ok(())
    }

    /// Appends one bounded, checksummed project snapshot and syncs the file.
    pub fn append(&self, project: &Project) -> Result<u64, JournalError> {
        validate_project(project)?;
        let payload = serde_json::to_vec(project)?;
        self.ensure_payload_fits(&payload)?;
        let scan = self.scan()?;
        if scan.records.len() >= self.config.max_records {
            return Err(JournalError::LimitExceeded(format!(
                "journal contains {} records",
                self.config.max_records
            )));
        }
        let sequence = scan
            .last_sequence
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| JournalError::LimitExceeded("sequence number overflow".to_owned()))?;
        let frame = encode_frame(sequence, &payload)?;
        let valid_offset = usize::try_from(scan.valid_offset).map_err(|_| {
            JournalError::LimitExceeded("journal offset does not fit in memory".to_owned())
        })?;
        let total_size = u64::try_from(valid_offset)
            .ok()
            .and_then(|offset| offset.checked_add(u64::try_from(frame.len()).ok()?))
            .ok_or_else(|| JournalError::LimitExceeded("journal size overflow".to_owned()))?;
        if total_size > self.config.max_bytes {
            return Err(JournalError::LimitExceeded(format!(
                "record would exceed {} bytes",
                self.config.max_bytes
            )));
        }

        create_parent(&self.path)?;
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&self.path)?;
        if scan.tail != JournalTail::Clean {
            file.set_len(scan.valid_offset)?;
        }
        file.seek(SeekFrom::End(0))?;
        file.write_all(&frame)?;
        file.sync_data()?;
        Ok(sequence)
    }

    /// Atomically writes a checkpoint and then compacts the append-only journal.
    /// If compaction is interrupted, the checkpoint and old journal are both still
    /// recoverable because the checkpoint sequence supersedes older records.
    pub fn checkpoint(&self, project: &Project) -> Result<u64, JournalError> {
        validate_project(project)?;
        let payload = serde_json::to_vec(project)?;
        self.ensure_payload_fits(&payload)?;
        let scan = self.scan()?;
        let existing_checkpoint = self.read_checkpoint()?;
        let base_sequence = scan
            .last_sequence
            .unwrap_or(0)
            .max(existing_checkpoint.as_ref().map_or(0, |item| item.sequence));
        let sequence = base_sequence
            .checked_add(1)
            .ok_or_else(|| JournalError::LimitExceeded("sequence number overflow".to_owned()))?;
        let checkpoint = CheckpointFile {
            magic: CHECKPOINT_MAGIC.to_owned(),
            version: CHECKPOINT_VERSION,
            sequence,
            project: project.clone(),
        };
        let checkpoint_bytes = serde_json::to_vec(&checkpoint)?;
        if checkpoint_bytes.len() > self.config.max_record_bytes {
            return Err(JournalError::LimitExceeded(
                "checkpoint exceeds the maximum record size".to_owned(),
            ));
        }
        let checkpoint_path = self.checkpoint_path();
        create_parent(&checkpoint_path)?;
        AtomicFile::new(&checkpoint_path, AllowOverwrite)
            .write(|temporary| {
                temporary.write_all(&checkpoint_bytes)?;
                temporary.flush()
            })
            .map_err(atomic_error)?;

        create_parent(&self.path)?;
        AtomicFile::new(&self.path, AllowOverwrite)
            .write(|temporary| temporary.flush())
            .map_err(atomic_error)?;
        Ok(sequence)
    }

    /// Returns the newest checkpoint or valid journal record and never treats a
    /// truncated/corrupt tail as a process-fatal parse error.
    pub fn recover(&self) -> Result<RecoveryState, JournalError> {
        let checkpoint = self.read_checkpoint()?;
        let scan = self.scan()?;
        let mut latest = checkpoint.map(|item| RecoverySnapshot {
            sequence: item.sequence,
            project: item.project,
        });
        for record in &scan.records {
            if latest
                .as_ref()
                .is_none_or(|current| record.sequence > current.sequence)
            {
                latest = Some(record.clone());
            }
        }
        Ok(RecoveryState {
            latest,
            valid_records: scan.records.len(),
            tail: scan.tail,
        })
    }

    fn ensure_payload_fits(&self, payload: &[u8]) -> Result<(), JournalError> {
        if payload.len() > self.config.max_record_bytes {
            return Err(JournalError::LimitExceeded(format!(
                "snapshot is larger than {} bytes",
                self.config.max_record_bytes
            )));
        }
        Ok(())
    }

    fn checkpoint_path(&self) -> PathBuf {
        self.path.with_extension("checkpoint")
    }

    fn read_checkpoint(&self) -> Result<Option<CheckpointFile>, JournalError> {
        let checkpoint_path = self.checkpoint_path();
        let bytes = match fs::read(&checkpoint_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(JournalError::Io(error)),
        };
        if bytes.len() > self.config.max_record_bytes {
            return Err(JournalError::CheckpointCorrupt(
                "checkpoint exceeds the configured size limit".to_owned(),
            ));
        }
        let checkpoint: CheckpointFile = serde_json::from_slice(&bytes)
            .map_err(|error| JournalError::CheckpointCorrupt(error.to_string()))?;
        if checkpoint.magic != CHECKPOINT_MAGIC || checkpoint.version != CHECKPOINT_VERSION {
            return Err(JournalError::CheckpointCorrupt(
                "unsupported checkpoint header".to_owned(),
            ));
        }
        validate_project(&checkpoint.project)
            .map_err(|error| JournalError::CheckpointCorrupt(error.to_string()))?;
        Ok(Some(checkpoint))
    }

    fn scan(&self) -> Result<JournalScan, JournalError> {
        let metadata = match fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(JournalScan {
                    records: Vec::new(),
                    valid_offset: 0,
                    last_sequence: None,
                    tail: JournalTail::Clean,
                })
            }
            Err(error) => return Err(JournalError::Io(error)),
        };
        if metadata.len() > self.config.max_bytes {
            return Err(JournalError::LimitExceeded(format!(
                "journal is larger than {} bytes",
                self.config.max_bytes
            )));
        }
        let bytes = fs::read(&self.path)?;
        let mut position = 0_usize;
        let mut records = Vec::new();
        let mut last_sequence = None;
        let mut tail = JournalTail::Clean;
        while position < bytes.len() {
            let record_offset = position as u64;
            if bytes.len() - position < JOURNAL_HEADER_BYTES {
                tail = JournalTail::Truncated {
                    offset: record_offset,
                };
                break;
            }
            if &bytes[position..position + 4] != JOURNAL_MAGIC
                || bytes[position + 4] != JOURNAL_VERSION
            {
                tail = JournalTail::Corrupt {
                    offset: record_offset,
                };
                break;
            }
            let sequence = u64::from_be_bytes(
                bytes[position + 5..position + 13]
                    .try_into()
                    .expect("journal sequence slice is fixed-size"),
            );
            let payload_length = u32::from_be_bytes(
                bytes[position + 13..position + 17]
                    .try_into()
                    .expect("journal length slice is fixed-size"),
            ) as usize;
            let expected_checksum = u32::from_be_bytes(
                bytes[position + 17..position + 21]
                    .try_into()
                    .expect("journal checksum slice is fixed-size"),
            );
            if payload_length > self.config.max_record_bytes {
                tail = JournalTail::Corrupt {
                    offset: record_offset,
                };
                break;
            }
            let payload_start = position + JOURNAL_HEADER_BYTES;
            let payload_end = match payload_start.checked_add(payload_length) {
                Some(end) => end,
                None => {
                    tail = JournalTail::Corrupt {
                        offset: record_offset,
                    };
                    break;
                }
            };
            if payload_end > bytes.len() {
                tail = JournalTail::Truncated {
                    offset: record_offset,
                };
                break;
            }
            let payload = &bytes[payload_start..payload_end];
            if checksum(sequence, payload) != expected_checksum
                || last_sequence.is_some_and(|previous| sequence <= previous)
            {
                tail = JournalTail::Corrupt {
                    offset: record_offset,
                };
                break;
            }
            let project: Project = match serde_json::from_slice(payload) {
                Ok(project) => project,
                Err(_) => {
                    tail = JournalTail::Corrupt {
                        offset: record_offset,
                    };
                    break;
                }
            };
            if validate_project(&project).is_err() {
                tail = JournalTail::Corrupt {
                    offset: record_offset,
                };
                break;
            }
            records.push(RecoverySnapshot { sequence, project });
            if records.len() > self.config.max_records {
                return Err(JournalError::LimitExceeded(format!(
                    "journal contains more than {} records",
                    self.config.max_records
                )));
            }
            last_sequence = Some(sequence);
            position = payload_end;
        }
        let valid_offset = if tail == JournalTail::Clean {
            bytes.len() as u64
        } else {
            match tail {
                JournalTail::Truncated { offset } | JournalTail::Corrupt { offset } => offset,
                JournalTail::Clean => unreachable!("tail was checked above"),
            }
        };
        Ok(JournalScan {
            records,
            valid_offset,
            last_sequence,
            tail,
        })
    }
}

fn validate_config(config: JournalConfig) -> Result<(), JournalError> {
    if config.max_records == 0 || config.max_bytes == 0 || config.max_record_bytes == 0 {
        return Err(JournalError::Invalid(
            "journal limits must be positive".to_owned(),
        ));
    }
    if u64::try_from(config.max_record_bytes)
        .ok()
        .is_none_or(|size| size + JOURNAL_HEADER_BYTES as u64 > config.max_bytes)
    {
        return Err(JournalError::Invalid(
            "maximum record size does not fit in maximum journal size".to_owned(),
        ));
    }
    Ok(())
}

fn validate_project(project: &Project) -> Result<(), JournalError> {
    project
        .validate()
        .map_err(|message| JournalError::Invalid(message.to_owned()))
}

fn encode_frame(sequence: u64, payload: &[u8]) -> Result<Vec<u8>, JournalError> {
    let length = u32::try_from(payload.len())
        .map_err(|_| JournalError::LimitExceeded("record payload is too large".to_owned()))?;
    let mut frame = Vec::with_capacity(JOURNAL_HEADER_BYTES + payload.len());
    frame.extend_from_slice(JOURNAL_MAGIC);
    frame.push(JOURNAL_VERSION);
    frame.extend_from_slice(&sequence.to_be_bytes());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&checksum(sequence, payload).to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

fn checksum(sequence: u64, payload: &[u8]) -> u32 {
    let mut hash = 0x811c_9dc5_u32;
    for byte in sequence
        .to_be_bytes()
        .into_iter()
        .chain(payload.iter().copied())
    {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn create_parent(path: &Path) -> Result<(), JournalError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn atomic_error(error: atomicwrites::Error<std::io::Error>) -> JournalError {
    match error {
        atomicwrites::Error::Internal(error) => JournalError::Io(error),
        atomicwrites::Error::User(error) => JournalError::Io(error),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use sonicforge_core::Project;

    use super::{JournalConfig, JournalError, JournalTail, RecoveryJournal};

    #[test]
    fn append_and_recover_latest_snapshot() {
        let directory = tempfile::tempdir().expect("tempdir");
        let journal = RecoveryJournal::new(directory.path().join("recovery.journal"));
        let first = Project::demo();
        let mut second = first.clone();
        second.name = "Second".to_owned();
        assert_eq!(journal.append(&first).expect("append first"), 1);
        assert_eq!(journal.append(&second).expect("append second"), 2);

        let recovery = journal.recover().expect("recover");
        assert_eq!(recovery.tail, JournalTail::Clean);
        assert_eq!(recovery.valid_records, 2);
        assert_eq!(recovery.latest.expect("latest").project, second);
    }

    #[test]
    fn truncated_and_corrupt_tails_are_reported_and_repaired_on_append() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("recovery.journal");
        let journal = RecoveryJournal::new(&path);
        let first = Project::demo();
        journal.append(&first).expect("append first");
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open tail")
            .write_all(b"SFR")
            .expect("write truncated tail");
        assert!(matches!(
            journal.recover().expect("recover truncated").tail,
            JournalTail::Truncated { .. }
        ));

        let mut second = first.clone();
        second.name = "Second".to_owned();
        journal.append(&second).expect("repair and append");
        assert_eq!(
            journal
                .recover()
                .expect("recover repaired")
                .latest
                .expect("latest")
                .project,
            second
        );

        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open corrupt tail")
            .write_all(b"BAD!\x01\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0")
            .expect("write corrupt tail");
        assert!(matches!(
            journal.recover().expect("recover corrupt").tail,
            JournalTail::Corrupt { .. }
        ));
    }

    #[test]
    fn checkpoint_is_atomic_and_compacts_the_journal() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("recovery.journal");
        let journal = RecoveryJournal::new(&path);
        let mut project = Project::demo();
        project.name = "Checkpoint".to_owned();
        journal.append(&project).expect("append");
        let checkpoint_sequence = journal.checkpoint(&project).expect("checkpoint");
        let recovery = journal.recover().expect("recover checkpoint");
        assert_eq!(
            recovery.latest.expect("latest").sequence,
            checkpoint_sequence
        );
        assert_eq!(recovery.valid_records, 0);
        assert_eq!(recovery.tail, JournalTail::Clean);
        assert!(path.with_extension("checkpoint").is_file());
    }

    #[test]
    fn record_limit_is_enforced_without_accepting_arbitrary_payloads() {
        let directory = tempfile::tempdir().expect("tempdir");
        let journal = RecoveryJournal::with_config(
            directory.path().join("bounded.journal"),
            JournalConfig {
                max_records: 1,
                max_bytes: 1_000_000,
                max_record_bytes: 500_000,
            },
        )
        .expect("config");
        let project = Project::demo();
        journal.append(&project).expect("first append");
        assert!(matches!(
            journal.append(&project),
            Err(JournalError::LimitExceeded(_))
        ));
    }
}
