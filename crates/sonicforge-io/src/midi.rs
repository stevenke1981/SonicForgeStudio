use std::{
    collections::{BTreeMap, VecDeque},
    error::Error,
    fmt,
};

use sonicforge_core::{
    project::{Clip, Project, TempoPoint, TimeSignature, Track, TrackKind, Waveform},
    sequence::{NoteEvent, Pattern},
};

const DEFAULT_BPM: f64 = 120.0;
const DEFAULT_SAMPLE_RATE: u32 = 48_000;
pub const MAX_MIDI_BYTES: usize = 64 * 1024 * 1024;
const MAX_MIDI_TRACKS: usize = 256;
const MAX_MIDI_EVENTS_PER_TRACK: usize = 1_000_000;
const MAX_VLQ: u32 = 0x0fff_ffff;
const MAX_MIDI_TICK: u64 = MAX_VLQ as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MidiFormat {
    Type0,
    Type1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MidiError {
    Invalid(String),
    Unsupported(String),
    LimitExceeded(String),
    Project(String),
}

impl fmt::Display for MidiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => write!(formatter, "invalid MIDI file: {message}"),
            Self::Unsupported(message) => write!(formatter, "unsupported MIDI feature: {message}"),
            Self::LimitExceeded(message) => write!(formatter, "MIDI limit exceeded: {message}"),
            Self::Project(message) => write!(
                formatter,
                "project cannot be represented as MIDI: {message}"
            ),
        }
    }
}

impl Error for MidiError {}

#[derive(Debug)]
struct Cursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Cursor<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.position)
    }

    fn read_u8(&mut self, context: &str) -> Result<u8, MidiError> {
        let byte = self
            .bytes
            .get(self.position)
            .copied()
            .ok_or_else(|| invalid(format!("truncated {context}")))?;
        self.position += 1;
        Ok(byte)
    }

    fn peek_u8(&self, context: &str) -> Result<u8, MidiError> {
        self.bytes
            .get(self.position)
            .copied()
            .ok_or_else(|| invalid(format!("truncated {context}")))
    }

    fn read_exact(&mut self, length: usize, context: &str) -> Result<&'a [u8], MidiError> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| invalid(format!("{context} length overflow")))?;
        if end > self.bytes.len() {
            return Err(invalid(format!("truncated {context}")));
        }
        let bytes = &self.bytes[self.position..end];
        self.position = end;
        Ok(bytes)
    }

    fn read_u16_be(&mut self, context: &str) -> Result<u16, MidiError> {
        let bytes = self.read_exact(2, context)?;
        Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn read_u32_be(&mut self, context: &str) -> Result<u32, MidiError> {
        let bytes = self.read_exact(4, context)?;
        Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn read_vlq(&mut self, context: &str) -> Result<u32, MidiError> {
        let mut value = 0_u32;
        for byte_index in 0..4 {
            let byte = self.read_u8(context)?;
            value = (value << 7) | u32::from(byte & 0x7f);
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            if byte_index == 3 {
                return Err(invalid(format!("{context} uses more than four bytes")));
            }
        }
        Err(invalid(format!("invalid {context}")))
    }
}

#[derive(Debug, Clone, Copy)]
struct ImportedNote {
    start_tick: u64,
    end_tick: u64,
    midi_note: u8,
    velocity: u8,
}

#[derive(Debug, Default)]
struct ParsedTrack {
    name: Option<String>,
    notes: Vec<ImportedNote>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventKind {
    NoteOff,
    NoteOn,
    Tempo([u8; 3]),
    TimeSignature([u8; 4]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExportEvent {
    tick: u64,
    priority: u8,
    channel: u8,
    note: u8,
    velocity: u8,
    kind: EventKind,
}

/// Imports a Standard MIDI File into the UI-independent SonicForge project model.
///
/// SMF type 0 and type 1 are supported. MIDI channels are used only while pairing
/// note-on/note-off events because the current project model stores notes per track.
pub fn import_midi(bytes: &[u8]) -> Result<Project, MidiError> {
    if bytes.len() > MAX_MIDI_BYTES {
        return Err(MidiError::LimitExceeded(format!(
            "file is larger than {MAX_MIDI_BYTES} bytes"
        )));
    }

    let mut cursor = Cursor::new(bytes);
    if cursor.read_exact(4, "MIDI header")? != b"MThd" {
        return Err(invalid("missing MThd header"));
    }
    let header_length = cursor.read_u32_be("MIDI header length")?;
    if header_length != 6 {
        return Err(invalid("MIDI header length must be six bytes"));
    }
    let format = cursor.read_u16_be("MIDI format")?;
    let track_count = usize::from(cursor.read_u16_be("MIDI track count")?);
    let division = cursor.read_u16_be("MIDI time division")?;
    if !matches!(format, 0 | 1) {
        return Err(MidiError::Unsupported(format!(
            "SMF format {format}; only type 0 and type 1 are supported"
        )));
    }
    if (format == 0 && track_count != 1) || (format == 1 && track_count == 0) {
        return Err(invalid("MIDI format and track count do not agree"));
    }
    if track_count > MAX_MIDI_TRACKS {
        return Err(MidiError::LimitExceeded(format!(
            "file contains more than {MAX_MIDI_TRACKS} tracks"
        )));
    }
    if division & 0x8000 != 0 || division == 0 {
        return Err(MidiError::Unsupported(
            "SMPTE or zero MIDI division is not supported".to_owned(),
        ));
    }
    let ppq = u32::from(division);

    let mut tempo_events = Vec::new();
    let mut time_signature_events = Vec::new();
    let mut tracks = Vec::with_capacity(track_count);
    for track_index in 0..track_count {
        if cursor.read_exact(4, "track header")? != b"MTrk" {
            return Err(invalid(format!(
                "track {track_index} is missing MTrk header"
            )));
        }
        let track_length = usize::try_from(cursor.read_u32_be("track length")?)
            .map_err(|_| invalid("track length cannot fit in memory"))?;
        let track_bytes = cursor.read_exact(track_length, "track data")?;
        tracks.push(parse_track(
            track_bytes,
            &mut tempo_events,
            &mut time_signature_events,
        )?);
    }
    if cursor.remaining() != 0 {
        return Err(invalid("trailing bytes after the last MIDI track"));
    }

    let tempo_map = make_tempo_map(tempo_events)?;
    let time_signatures = make_time_signature_map(time_signature_events)?;
    let project_tracks = tracks
        .into_iter()
        .enumerate()
        .filter_map(|(index, track)| make_project_track(index, track, ppq))
        .collect();

    let project = Project {
        schema_version: sonicforge_core::project::PROJECT_SCHEMA_VERSION,
        id: "midi-import".to_owned(),
        name: "MIDI Import".to_owned(),
        sample_rate: DEFAULT_SAMPLE_RATE,
        ppq,
        bpm: tempo_map[0].bpm,
        tempo_map,
        time_signatures,
        tracks: project_tracks,
        devices: Vec::new(),
        automation: Vec::new(),
        assets: Vec::new(),
    };
    project
        .validate()
        .map_err(|message| MidiError::Project(message.to_owned()))?;
    Ok(project)
}

/// Exports a project to a deterministic SMF type 0 or type 1 byte sequence.
pub fn export_midi(project: &Project, format: MidiFormat) -> Result<Vec<u8>, MidiError> {
    project
        .validate()
        .map_err(|message| MidiError::Project(message.to_owned()))?;
    let ppq = u16::try_from(project.ppq)
        .map_err(|_| MidiError::Project("project PPQ does not fit in MIDI division".to_owned()))?;

    let tempo_events = make_tempo_export_events(project)?;
    let mut track_data = Vec::new();
    match format {
        MidiFormat::Type0 => {
            let mut events = tempo_events;
            for (track_index, track) in project.tracks.iter().enumerate() {
                events.extend(track_export_events(track, track_index, project.ppq)?);
            }
            track_data.push(write_track(events)?);
        }
        MidiFormat::Type1 => {
            track_data.push(write_track(tempo_events)?);
            for (track_index, track) in project.tracks.iter().enumerate() {
                track_data.push(write_track(track_export_events(
                    track,
                    track_index,
                    project.ppq,
                )?)?);
            }
        }
    }

    let track_count = u16::try_from(track_data.len())
        .map_err(|_| MidiError::LimitExceeded("too many output tracks".to_owned()))?;
    let mut output = Vec::new();
    output.extend_from_slice(b"MThd");
    output.extend_from_slice(&6_u32.to_be_bytes());
    output.extend_from_slice(
        &match format {
            MidiFormat::Type0 => 0_u16,
            MidiFormat::Type1 => 1_u16,
        }
        .to_be_bytes(),
    );
    output.extend_from_slice(&track_count.to_be_bytes());
    output.extend_from_slice(&ppq.to_be_bytes());
    for data in track_data {
        let length = u32::try_from(data.len())
            .map_err(|_| MidiError::LimitExceeded("output track is too large".to_owned()))?;
        output.extend_from_slice(b"MTrk");
        output.extend_from_slice(&length.to_be_bytes());
        output.extend_from_slice(&data);
    }
    Ok(output)
}

fn parse_track(
    bytes: &[u8],
    tempo_events: &mut Vec<(u64, f64)>,
    time_signature_events: &mut Vec<(u64, TimeSignature)>,
) -> Result<ParsedTrack, MidiError> {
    let mut cursor = Cursor::new(bytes);
    let mut current_tick = 0_u64;
    let mut running_status = None;
    let mut end_of_track = false;
    let mut event_count = 0_usize;
    let mut track = ParsedTrack::default();
    let mut open_notes: BTreeMap<(u8, u8), VecDeque<(u64, u8)>> = BTreeMap::new();

    while cursor.remaining() > 0 {
        event_count = event_count.saturating_add(1);
        if event_count > MAX_MIDI_EVENTS_PER_TRACK {
            return Err(MidiError::LimitExceeded(format!(
                "track contains more than {MAX_MIDI_EVENTS_PER_TRACK} events"
            )));
        }
        let delta = u64::from(cursor.read_vlq("delta time")?);
        current_tick = current_tick
            .checked_add(delta)
            .ok_or_else(|| invalid("MIDI tick position overflow"))?;
        if current_tick > MAX_MIDI_TICK {
            return Err(MidiError::LimitExceeded(
                "MIDI tick position exceeds the SMF VLQ range".to_owned(),
            ));
        }

        let status_or_data = cursor.peek_u8("event status")?;
        let status = if status_or_data & 0x80 != 0 {
            let status = cursor.read_u8("event status")?;
            if (0x80..=0xef).contains(&status) {
                running_status = Some(status);
            } else {
                running_status = None;
            }
            status
        } else {
            running_status.ok_or_else(|| invalid("running status used before a channel status"))?
        };

        match status {
            0x80..=0x8f => {
                let note = read_data_byte(&mut cursor, "note-off note")?;
                let _velocity = read_data_byte(&mut cursor, "note-off velocity")?;
                close_note(
                    &mut open_notes,
                    status & 0x0f,
                    note,
                    current_tick,
                    &mut track.notes,
                );
            }
            0x90..=0x9f => {
                let note = read_data_byte(&mut cursor, "note-on note")?;
                let velocity = read_data_byte(&mut cursor, "note-on velocity")?;
                if velocity == 0 {
                    close_note(
                        &mut open_notes,
                        status & 0x0f,
                        note,
                        current_tick,
                        &mut track.notes,
                    );
                } else {
                    open_notes
                        .entry((status & 0x0f, note))
                        .or_default()
                        .push_back((current_tick, velocity));
                }
            }
            0xa0..=0xbf | 0xe0..=0xef => {
                let _data_1 = read_data_byte(&mut cursor, "channel event data")?;
                let _data_2 = read_data_byte(&mut cursor, "channel event data")?;
            }
            0xc0..=0xdf => {
                let _data = read_data_byte(&mut cursor, "channel event data")?;
            }
            0xff => {
                running_status = None;
                let meta_type = cursor.read_u8("meta event type")?;
                let length = usize::try_from(cursor.read_vlq("meta event length")?)
                    .map_err(|_| invalid("meta event length cannot fit in memory"))?;
                let data = cursor.read_exact(length, "meta event data")?;
                match meta_type {
                    0x03 => {
                        if !data.is_empty() {
                            let name = String::from_utf8_lossy(data).trim().to_owned();
                            if !name.is_empty() {
                                track.name = Some(name);
                            }
                        }
                    }
                    0x2f => {
                        if !data.is_empty() {
                            return Err(invalid("end-of-track meta event must be empty"));
                        }
                        if cursor.remaining() != 0 {
                            return Err(invalid("events follow the end-of-track marker"));
                        }
                        end_of_track = true;
                    }
                    0x51 => {
                        if data.len() != 3 {
                            return Err(invalid("tempo meta event must contain three bytes"));
                        }
                        let microseconds_per_quarter =
                            u32::from_be_bytes([0, data[0], data[1], data[2]]);
                        if microseconds_per_quarter == 0 {
                            return Err(invalid("tempo cannot be zero"));
                        }
                        let bpm = 60_000_000.0 / f64::from(microseconds_per_quarter);
                        if !bpm.is_finite() || !(20.0..=400.0).contains(&bpm) {
                            return Err(MidiError::Unsupported(
                                "tempo is outside the project range of 20..=400 BPM".to_owned(),
                            ));
                        }
                        tempo_events.push((current_tick, bpm));
                    }
                    0x58 => {
                        if data.len() != 4 || data[0] == 0 || data[1] > 5 {
                            return Err(invalid("invalid time-signature meta event"));
                        }
                        let denominator = 1_u8 << data[1];
                        if !matches!(denominator, 1 | 2 | 4 | 8 | 16 | 32) || data[0] > 32 {
                            return Err(invalid("time signature is outside the project range"));
                        }
                        time_signature_events.push((
                            current_tick,
                            TimeSignature {
                                tick: current_tick,
                                numerator: data[0],
                                denominator,
                            },
                        ));
                    }
                    _ => {}
                }
                if end_of_track {
                    break;
                }
            }
            0xf0 | 0xf7 => {
                running_status = None;
                let length = usize::try_from(cursor.read_vlq("sysex length")?)
                    .map_err(|_| invalid("sysex length cannot fit in memory"))?;
                let _data = cursor.read_exact(length, "sysex data")?;
            }
            0xf1 | 0xf3 => {
                running_status = None;
                let _data = read_data_byte(&mut cursor, "system common data")?;
            }
            0xf2 => {
                running_status = None;
                let _data_1 = read_data_byte(&mut cursor, "song position data")?;
                let _data_2 = read_data_byte(&mut cursor, "song position data")?;
            }
            0xf6 | 0xf8..=0xfe => running_status = None,
            0xf4 | 0xf5 => return Err(invalid("reserved MIDI system status")),
            _ => return Err(invalid("invalid MIDI event status")),
        }
    }

    if !end_of_track {
        return Err(invalid("track is missing end-of-track marker"));
    }
    for ((channel, note), mut pending) in open_notes {
        while let Some((start_tick, velocity)) = pending.pop_front() {
            push_note(
                &mut track.notes,
                ImportedNote {
                    start_tick,
                    end_tick: current_tick,
                    midi_note: note,
                    velocity,
                },
                channel,
            );
        }
    }
    track.notes.sort_by_key(|note| {
        (
            note.start_tick,
            note.end_tick,
            note.midi_note,
            note.velocity,
        )
    });
    Ok(track)
}

fn read_data_byte(cursor: &mut Cursor<'_>, context: &str) -> Result<u8, MidiError> {
    let byte = cursor.read_u8(context)?;
    if byte & 0x80 != 0 {
        return Err(invalid(format!("{context} is not a MIDI data byte")));
    }
    Ok(byte)
}

fn close_note(
    open_notes: &mut BTreeMap<(u8, u8), VecDeque<(u64, u8)>>,
    channel: u8,
    note: u8,
    end_tick: u64,
    notes: &mut Vec<ImportedNote>,
) {
    if let Some(pending) = open_notes.get_mut(&(channel, note)) {
        if let Some((start_tick, velocity)) = pending.pop_front() {
            if end_tick > start_tick {
                push_note(
                    notes,
                    ImportedNote {
                        start_tick,
                        end_tick,
                        midi_note: note,
                        velocity,
                    },
                    channel,
                );
            }
        }
        if pending.is_empty() {
            open_notes.remove(&(channel, note));
        }
    }
}

fn push_note(notes: &mut Vec<ImportedNote>, note: ImportedNote, _channel: u8) {
    if note.end_tick > note.start_tick {
        notes.push(note);
    }
}

fn make_tempo_map(mut events: Vec<(u64, f64)>) -> Result<Vec<TempoPoint>, MidiError> {
    events.sort_by_key(|(tick, _)| *tick);
    let mut map = BTreeMap::new();
    map.insert(0, DEFAULT_BPM);
    for (tick, bpm) in events {
        if !bpm.is_finite() || !(20.0..=400.0).contains(&bpm) {
            return Err(MidiError::Unsupported(
                "tempo is outside the project range of 20..=400 BPM".to_owned(),
            ));
        }
        map.insert(tick, bpm);
    }
    Ok(map
        .into_iter()
        .map(|(tick, bpm)| TempoPoint { tick, bpm })
        .collect())
}

fn make_time_signature_map(
    events: Vec<(u64, TimeSignature)>,
) -> Result<Vec<TimeSignature>, MidiError> {
    let mut map = BTreeMap::new();
    map.insert(
        0,
        TimeSignature {
            tick: 0,
            numerator: 4,
            denominator: 4,
        },
    );
    for (tick, mut signature) in events {
        if !matches!(signature.denominator, 1 | 2 | 4 | 8 | 16 | 32)
            || !(1..=32).contains(&signature.numerator)
        {
            return Err(invalid("time signature is outside the project range"));
        }
        signature.tick = tick;
        map.insert(tick, signature);
    }
    Ok(map.into_values().collect())
}

fn make_project_track(index: usize, track: ParsedTrack, ppq: u32) -> Option<Track> {
    if track.notes.is_empty() {
        return None;
    }
    let notes = track
        .notes
        .iter()
        .map(|note| {
            NoteEvent::new(
                note.start_tick as f64 / f64::from(ppq),
                (note.end_tick - note.start_tick) as f64 / f64::from(ppq),
                note.midi_note,
                f32::from(note.velocity) / 127.0,
            )
        })
        .collect::<Vec<_>>();
    let last_tick = track
        .notes
        .iter()
        .map(|note| note.end_tick)
        .max()
        .unwrap_or(u64::from(ppq));
    let length_ticks = last_tick.max(u64::from(ppq));
    let pattern_id = format!("midi-pattern-{index:03}");
    Some(Track {
        id: format!("midi-track-{index:03}"),
        name: track
            .name
            .unwrap_or_else(|| format!("MIDI Track {}", index + 1)),
        kind: TrackKind::Instrument,
        color: palette_color(index),
        gain: 1.0,
        pan: 0.0,
        muted: false,
        solo: false,
        armed: false,
        pattern: Pattern {
            length_beats: length_ticks as f64 / f64::from(ppq),
            notes,
        },
        clips: vec![Clip {
            id: format!("midi-clip-{index:03}"),
            name: format!("MIDI Track {}", index + 1),
            start_tick: 0,
            length_ticks,
            pattern_id: Some(pattern_id),
            loop_enabled: false,
        }],
        waveform: Waveform::Sine,
    })
}

fn palette_color(index: usize) -> String {
    const COLORS: [&str; 6] = [
        "#f6b74a", "#59c3c3", "#e879a9", "#8f9cf4", "#70c58a", "#d58bff",
    ];
    COLORS[index % COLORS.len()].to_owned()
}

fn make_tempo_export_events(project: &Project) -> Result<Vec<ExportEvent>, MidiError> {
    let mut events = Vec::with_capacity(project.tempo_map.len() + project.time_signatures.len());
    for tempo in &project.tempo_map {
        let microseconds = (60_000_000.0 / tempo.bpm).round();
        if !microseconds.is_finite() || !(1.0..=f64::from(u32::MAX)).contains(&microseconds) {
            return Err(MidiError::Project(
                "tempo cannot be encoded as MIDI".to_owned(),
            ));
        }
        let microseconds = microseconds as u32;
        let bytes = microseconds.to_be_bytes();
        events.push(ExportEvent {
            tick: tempo.tick,
            priority: 0,
            channel: 0,
            note: 0,
            velocity: 0,
            kind: EventKind::Tempo([bytes[1], bytes[2], bytes[3]]),
        });
    }
    for signature in &project.time_signatures {
        let denominator = match signature.denominator {
            1 => 0,
            2 => 1,
            4 => 2,
            8 => 3,
            16 => 4,
            32 => 5,
            _ => return Err(MidiError::Project("invalid time signature".to_owned())),
        };
        events.push(ExportEvent {
            tick: signature.tick,
            priority: 1,
            channel: 0,
            note: 0,
            velocity: 0,
            kind: EventKind::TimeSignature([signature.numerator, denominator, 24, 8]),
        });
    }
    sort_events(&mut events);
    Ok(events)
}

fn track_export_events(
    track: &Track,
    track_index: usize,
    ppq: u32,
) -> Result<Vec<ExportEvent>, MidiError> {
    let channel = u8::try_from(track_index % 16).expect("track index modulo 16 always fits");
    let clips = if track.clips.is_empty() {
        vec![(0_u64, u64::MAX)]
    } else {
        track
            .clips
            .iter()
            .map(|clip| (clip.start_tick, clip.length_ticks))
            .collect()
    };
    let mut events = Vec::new();
    for (clip_start, clip_length) in clips {
        for note in &track.pattern.notes {
            let relative_start = beats_to_ticks(note.start_beat, ppq)?;
            let relative_length = beats_to_ticks(note.length_beats, ppq)?.max(1);
            let start_tick = clip_start
                .checked_add(relative_start)
                .ok_or_else(|| MidiError::Project("note start tick overflow".to_owned()))?;
            let unclamped_end = start_tick
                .checked_add(relative_length)
                .ok_or_else(|| MidiError::Project("note end tick overflow".to_owned()))?;
            let clip_end = clip_start
                .checked_add(clip_length)
                .ok_or_else(|| MidiError::Project("clip end tick overflow".to_owned()))?;
            let end_tick = unclamped_end.min(clip_end);
            if end_tick <= start_tick {
                continue;
            }
            if end_tick > MAX_MIDI_TICK || start_tick > MAX_MIDI_TICK {
                return Err(MidiError::Project(
                    "note tick exceeds the MIDI VLQ range".to_owned(),
                ));
            }
            let velocity = (note.velocity.clamp(0.0, 1.0) * 127.0).round() as u8;
            events.push(ExportEvent {
                tick: start_tick,
                priority: 3,
                channel,
                note: note.midi_note,
                velocity: velocity.max(1),
                kind: EventKind::NoteOn,
            });
            events.push(ExportEvent {
                tick: end_tick,
                priority: 2,
                channel,
                note: note.midi_note,
                velocity: 0,
                kind: EventKind::NoteOff,
            });
        }
    }
    sort_events(&mut events);
    Ok(events)
}

fn beats_to_ticks(beats: f64, ppq: u32) -> Result<u64, MidiError> {
    if !beats.is_finite() || beats < 0.0 {
        return Err(MidiError::Project("note timing is not finite".to_owned()));
    }
    let ticks = (beats * f64::from(ppq)).round();
    if !ticks.is_finite() || ticks > u64::MAX as f64 {
        return Err(MidiError::Project("note timing is too large".to_owned()));
    }
    Ok(ticks as u64)
}

fn sort_events(events: &mut [ExportEvent]) {
    events.sort_by_key(|event| {
        (
            event.tick,
            event.priority,
            event.channel,
            event.note,
            event.velocity,
        )
    });
}

fn write_track(mut events: Vec<ExportEvent>) -> Result<Vec<u8>, MidiError> {
    sort_events(&mut events);
    let mut data = Vec::new();
    let mut previous_tick = 0_u64;
    for event in events {
        let delta = event
            .tick
            .checked_sub(previous_tick)
            .ok_or_else(|| MidiError::Project("MIDI events are not ordered".to_owned()))?;
        if delta > MAX_MIDI_TICK {
            return Err(MidiError::Project(
                "MIDI event delta exceeds the VLQ range".to_owned(),
            ));
        }
        write_vlq(
            &mut data,
            u32::try_from(delta).expect("delta was range checked"),
        );
        match event.kind {
            EventKind::NoteOff => {
                data.push(0x80 | event.channel);
                data.push(event.note);
                data.push(0);
            }
            EventKind::NoteOn => {
                data.push(0x90 | event.channel);
                data.push(event.note);
                data.push(event.velocity);
            }
            EventKind::Tempo(bytes) => {
                data.extend_from_slice(&[0xff, 0x51, 0x03]);
                data.extend_from_slice(&bytes);
            }
            EventKind::TimeSignature(bytes) => {
                data.extend_from_slice(&[0xff, 0x58, 0x04]);
                data.extend_from_slice(&bytes);
            }
        }
        previous_tick = event.tick;
    }
    data.extend_from_slice(&[0, 0xff, 0x2f, 0]);
    Ok(data)
}

fn write_vlq(output: &mut Vec<u8>, mut value: u32) {
    let mut bytes = [0_u8; 4];
    let mut index = 3;
    bytes[index] = (value & 0x7f) as u8;
    value >>= 7;
    while value > 0 {
        index -= 1;
        bytes[index] = ((value & 0x7f) as u8) | 0x80;
        value >>= 7;
    }
    output.extend_from_slice(&bytes[index..]);
}

fn invalid(message: impl Into<String>) -> MidiError {
    MidiError::Invalid(message.into())
}

#[cfg(test)]
mod tests {
    use super::{export_midi, import_midi, MidiError, MidiFormat};

    fn golden(_name: &str) -> Vec<u8> {
        include_str!(concat!("../tests/golden/", "midi_type1.hex"))
            .split_whitespace()
            .filter(|token| !token.starts_with('#'))
            .map(|token| u8::from_str_radix(token, 16).expect("hex golden byte"))
            .collect::<Vec<_>>()
    }

    fn golden_type0() -> Vec<u8> {
        include_str!("../tests/golden/midi_type0.hex")
            .split_whitespace()
            .map(|token| u8::from_str_radix(token, 16).expect("hex golden byte"))
            .collect()
    }

    #[test]
    fn imports_type1_tempo_ppq_and_notes() {
        let project = import_midi(&golden("midi_type1")).expect("import type 1");
        assert_eq!(project.ppq, 480);
        assert_eq!(project.bpm, 120.0);
        assert_eq!(project.tempo_map.len(), 1);
        assert_eq!(project.time_signatures[0].denominator, 4);
        assert_eq!(project.tracks.len(), 1);
        assert_eq!(project.tracks[0].pattern.notes.len(), 2);
        assert_eq!(project.tracks[0].pattern.notes[0].midi_note, 60);
        assert_eq!(project.tracks[0].pattern.notes[0].start_beat, 0.0);
        assert_eq!(project.tracks[0].pattern.notes[0].length_beats, 0.5);
    }

    #[test]
    fn type1_and_type0_exports_are_golden_and_deterministic() {
        let project = import_midi(&golden("midi_type1")).expect("import type 1");
        let type1 = export_midi(&project, MidiFormat::Type1).expect("export type 1");
        let type0 = export_midi(&project, MidiFormat::Type0).expect("export type 0");
        assert_eq!(type1, golden("midi_type1"));
        assert_eq!(type0, golden_type0());
        assert_eq!(
            type1,
            export_midi(&project, MidiFormat::Type1).expect("second export")
        );
    }

    #[test]
    fn malformed_inputs_return_errors_without_panicking() {
        for bytes in [
            b"".as_slice(),
            b"MThd\0\0\0\x06\0".as_slice(),
            b"MThd\0\0\0\x06\0\0\0\x01\x01\xe0MTrk\0\0\0\x01\0".as_slice(),
        ] {
            assert!(matches!(import_midi(bytes), Err(MidiError::Invalid(_))));
        }
        let mut missing_eot = golden_type0();
        missing_eot.truncate(missing_eot.len() - 4);
        assert!(matches!(
            import_midi(&missing_eot),
            Err(MidiError::Invalid(_))
        ));
        let mut invalid_vlq = golden_type0();
        let last_track_data = invalid_vlq.len() - 1;
        invalid_vlq[last_track_data] = 0x80;
        assert!(matches!(
            import_midi(&invalid_vlq),
            Err(MidiError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_smpte_division_and_unsupported_format() {
        let mut smpte = golden_type0();
        smpte[12] = 0xe7;
        assert!(matches!(
            import_midi(&smpte),
            Err(MidiError::Unsupported(_))
        ));
        let mut format_two = golden_type0();
        format_two[9] = 2;
        assert!(matches!(
            import_midi(&format_two),
            Err(MidiError::Unsupported(_))
        ));
    }
}
