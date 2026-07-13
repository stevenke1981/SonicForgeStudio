//! Realtime-safe audio transport and the first SonicForge DSP graph slice.
//!
//! Graph construction and tempo conversion happen before the audio callback.
//! The callback owns a preallocated [`PlaybackEngine`] and communicates with
//! the control side only through atomics. The same engine is used by
//! [`render_offline`] so offline and realtime playback share one DSP path.

use std::{
    error::Error,
    fmt,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc,
    },
};

use serde::Serialize;
use sonicforge_core::{
    project::{Project, TempoPoint, Waveform},
    render::equal_power_pan,
    synth::{envelope, midi_note_hz, oscillator},
};

#[cfg(windows)]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const MASTER_CEILING: f32 = 0.98;
const MAX_VOICES: usize = 64;
const MAX_OFFLINE_SAMPLES: usize = 100_000_000;
const MAX_TRANSPORT_COMMANDS_PER_CALLBACK: usize = 16;
const MAX_NOTE_EVENTS_PER_QUANTUM: usize = 256;
const OFFLINE_CALLBACK_FRAMES: usize = 256;
const NOTE_EVENT_QUANTUM_FRAMES: u64 = OFFLINE_CALLBACK_FRAMES as u64;
const VOICE_CHECKPOINT_STRIDE: usize = MAX_VOICES;
const EMPTY_NOTE_INDEX: usize = usize::MAX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub state: &'static str,
    pub device_name: Option<String>,
    pub sample_rate: u32,
    pub buffer_size: u32,
    pub xrun_count: u64,
    pub engine_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportPoll {
    pub position_samples: u64,
    pub transport_state: &'static str,
    pub device_state: &'static str,
    pub duration_samples: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioError(String);

impl AudioError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for AudioError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TransportState {
    Stopped = 0,
    Playing = 1,
    Paused = 2,
}

impl TransportState {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Playing => "playing",
            Self::Paused => "paused",
        }
    }
}

/// Built-in instruments resolved from `builtin.instrument.<preset>` devices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactoryInstrument {
    AnalogLead,
    WarmPad,
    ElectricBass,
    SoftKeys,
    Bell,
    Pluck,
    Kick,
    Snare,
    HiHat,
    DrumKit,
}

impl FactoryInstrument {
    /// The nine single-voice factory sounds. DrumKit is a composite preset
    /// resolved per MIDI note with [`Self::resolve_midi_note`].
    pub const ALL: [Self; 9] = [
        Self::AnalogLead,
        Self::WarmPad,
        Self::ElectricBass,
        Self::SoftKeys,
        Self::Bell,
        Self::Pluck,
        Self::Kick,
        Self::Snare,
        Self::HiHat,
    ];

    #[must_use]
    pub fn from_preset(preset: &str) -> Option<Self> {
        Some(match preset {
            "analog-lead" => Self::AnalogLead,
            "warm-pad" => Self::WarmPad,
            "electric-bass" => Self::ElectricBass,
            "soft-keys" => Self::SoftKeys,
            "bell" => Self::Bell,
            "pluck" => Self::Pluck,
            "kick" => Self::Kick,
            "snare" => Self::Snare,
            "hi-hat" => Self::HiHat,
            "drum-kit" => Self::DrumKit,
            _ => return None,
        })
    }

    #[must_use]
    pub const fn preset(self) -> &'static str {
        match self {
            Self::AnalogLead => "analog-lead",
            Self::WarmPad => "warm-pad",
            Self::ElectricBass => "electric-bass",
            Self::SoftKeys => "soft-keys",
            Self::Bell => "bell",
            Self::Pluck => "pluck",
            Self::Kick => "kick",
            Self::Snare => "snare",
            Self::HiHat => "hi-hat",
            Self::DrumKit => "drum-kit",
        }
    }

    /// Resolve a drum-kit MIDI note without allocating or touching shared state.
    /// Unmapped notes use the melodic analog-lead fallback rather than silence.
    #[must_use]
    pub const fn resolve_midi_note(self, midi_note: u8) -> Self {
        match self {
            Self::DrumKit => match midi_note {
                36 => Self::Kick,
                38 | 40 => Self::Snare,
                42 | 44 | 46 => Self::HiHat,
                _ => Self::AnalogLead,
            },
            instrument => instrument,
        }
    }
}

impl TransportState {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Playing,
            2 => Self::Paused,
            _ => Self::Stopped,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoopRegion {
    pub start_sample: u64,
    pub end_sample: u64,
}

const TRANSPORT_COMMAND_CAPACITY: usize = 64;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportCommandKind {
    Play = 1,
    Pause = 2,
    Stop = 3,
    SeekSamples = 4,
    SetLoop = 5,
    ClearLoop = 6,
}

impl TransportCommandKind {
    #[must_use]
    fn from_raw(raw: u8) -> Option<Self> {
        Some(match raw {
            1 => Self::Play,
            2 => Self::Pause,
            3 => Self::Stop,
            4 => Self::SeekSamples,
            5 => Self::SetLoop,
            6 => Self::ClearLoop,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct TransportCommand {
    kind: TransportCommandKind,
    arg0: u64,
    arg1: u64,
}

#[derive(Debug)]
struct TransportCommandSlot {
    sequence: AtomicU64,
    kind: AtomicU8,
    arg0: AtomicU64,
    arg1: AtomicU64,
}

impl TransportCommandSlot {
    const fn new(sequence: u64) -> Self {
        Self {
            sequence: AtomicU64::new(sequence),
            kind: AtomicU8::new(0),
            arg0: AtomicU64::new(0),
            arg1: AtomicU64::new(0),
        }
    }
}

#[derive(Debug)]
struct TransportCommands {
    published_state: AtomicU8,
    published_revision: AtomicU64,
    dequeue_index: AtomicU64,
    enqueue_index: AtomicU64,
    slots: [TransportCommandSlot; TRANSPORT_COMMAND_CAPACITY],
    position_samples: AtomicU64,
}

impl Default for TransportCommands {
    fn default() -> Self {
        Self {
            published_state: AtomicU8::new(TransportState::Stopped as u8),
            published_revision: AtomicU64::new(0),
            dequeue_index: AtomicU64::new(0),
            enqueue_index: AtomicU64::new(0),
            slots: std::array::from_fn(|index| TransportCommandSlot::new(index as u64)),
            position_samples: AtomicU64::new(0),
        }
    }
}

impl TransportCommands {
    /// Multi-producer (control) / single-consumer (audio callback) queue.
    ///
    /// Each producer reserves a unique position with CAS. The per-slot
    /// sequence is published only after all payload atomics are written, so
    /// the callback never observes a partially written command.
    fn enqueue(&self, command: TransportCommand) -> Result<(), AudioError> {
        let mut enqueue_index = self.enqueue_index.load(Ordering::Relaxed);
        loop {
            let slot = &self.slots[(enqueue_index % TRANSPORT_COMMAND_CAPACITY as u64) as usize];
            let sequence = slot.sequence.load(Ordering::Acquire);
            let difference = sequence.wrapping_sub(enqueue_index) as i64;
            if difference == 0 {
                if self
                    .enqueue_index
                    .compare_exchange_weak(
                        enqueue_index,
                        enqueue_index.wrapping_add(1),
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                    )
                    .is_ok()
                {
                    slot.arg0.store(command.arg0, Ordering::Relaxed);
                    slot.arg1.store(command.arg1, Ordering::Relaxed);
                    slot.kind.store(command.kind as u8, Ordering::Relaxed);
                    slot.sequence
                        .store(enqueue_index.wrapping_add(1), Ordering::Release);
                    return Ok(());
                }
            } else if difference < 0 {
                return Err(AudioError::new("transport command queue is full"));
            } else {
                enqueue_index = self.enqueue_index.load(Ordering::Relaxed);
            }
        }
    }

    #[must_use]
    fn dequeue(&self) -> Option<TransportCommand> {
        let dequeue_index = self.dequeue_index.load(Ordering::Relaxed);
        let slot = &self.slots[(dequeue_index % TRANSPORT_COMMAND_CAPACITY as u64) as usize];
        let sequence = slot.sequence.load(Ordering::Acquire);
        let difference = sequence.wrapping_sub(dequeue_index.wrapping_add(1)) as i64;
        if difference != 0 {
            return None;
        }

        let command =
            TransportCommandKind::from_raw(slot.kind.load(Ordering::Relaxed)).map(|kind| {
                TransportCommand {
                    kind,
                    arg0: slot.arg0.load(Ordering::Relaxed),
                    arg1: slot.arg1.load(Ordering::Relaxed),
                }
            });
        slot.sequence.store(
            dequeue_index.wrapping_add(TRANSPORT_COMMAND_CAPACITY as u64),
            Ordering::Release,
        );
        self.dequeue_index
            .store(dequeue_index.wrapping_add(1), Ordering::Relaxed);
        command
    }
}

/// Control-side handle for the realtime transport.
///
/// Commands are published to a bounded MPSC queue. The audio callback consumes
/// them in reservation order at a block boundary; it never takes a mutex or
/// waits for the control thread.
#[derive(Debug, Clone)]
pub struct PlaybackController {
    commands: Arc<TransportCommands>,
}

impl Default for PlaybackController {
    fn default() -> Self {
        Self {
            commands: Arc::new(TransportCommands::default()),
        }
    }
}

impl PlaybackController {
    #[must_use]
    pub fn state(&self) -> TransportState {
        TransportState::from_raw(self.commands.published_state.load(Ordering::Acquire))
    }

    /// Last callback-block position published by the audio engine.
    #[must_use]
    pub fn position_samples(&self) -> u64 {
        self.commands.position_samples.load(Ordering::Acquire)
    }

    #[must_use]
    fn published_snapshot(&self) -> (TransportState, u64) {
        loop {
            let revision = self.commands.published_revision.load(Ordering::Acquire);
            if revision & 1 != 0 {
                std::hint::spin_loop();
                continue;
            }
            let position = self.commands.position_samples.load(Ordering::Relaxed);
            let state =
                TransportState::from_raw(self.commands.published_state.load(Ordering::Relaxed));
            if self.commands.published_revision.load(Ordering::Acquire) == revision {
                return (state, position);
            }
        }
    }

    pub fn play(&self) -> Result<(), AudioError> {
        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::Play,
            arg0: 0,
            arg1: 0,
        })
    }

    pub fn pause(&self) -> Result<(), AudioError> {
        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::Pause,
            arg0: 0,
            arg1: 0,
        })
    }

    pub fn stop(&self) -> Result<(), AudioError> {
        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::Stop,
            arg0: 0,
            arg1: 0,
        })
    }

    pub fn seek_samples(&self, sample: u64) -> Result<(), AudioError> {
        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::SeekSamples,
            arg0: sample,
            arg1: 0,
        })
    }

    pub fn set_loop_samples(&self, start_sample: u64, end_sample: u64) -> Result<(), AudioError> {
        if start_sample >= end_sample {
            return Err(AudioError::new("loop end must be greater than loop start"));
        }

        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::SetLoop,
            arg0: start_sample,
            arg1: end_sample,
        })
    }

    pub fn clear_loop(&self) -> Result<(), AudioError> {
        self.commands.enqueue(TransportCommand {
            kind: TransportCommandKind::ClearLoop,
            arg0: 0,
            arg1: 0,
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct TempoSegment {
    start_tick: u64,
    start_seconds: f64,
    bpm: f64,
}

/// Precomputed piecewise-constant tempo conversion used while building a graph.
#[derive(Debug, Clone)]
pub struct TempoClock {
    sample_rate: u32,
    ppq: u32,
    segments: Box<[TempoSegment]>,
}

impl TempoClock {
    pub fn from_project(project: &Project, sample_rate: u32) -> Result<Self, AudioError> {
        project
            .validate()
            .map_err(|message| AudioError::new(format!("invalid project: {message}")))?;
        Self::new(sample_rate, project.ppq, &project.tempo_map)
    }

    pub fn new(sample_rate: u32, ppq: u32, tempo_map: &[TempoPoint]) -> Result<Self, AudioError> {
        if !(8_000..=384_000).contains(&sample_rate) {
            return Err(AudioError::new(
                "sample rate must be between 8000 and 384000",
            ));
        }
        if !(24..=9_600).contains(&ppq) {
            return Err(AudioError::new("ppq must be between 24 and 9600"));
        }
        let first = tempo_map
            .first()
            .ok_or_else(|| AudioError::new("tempo map cannot be empty"))?;
        if first.tick != 0 {
            return Err(AudioError::new("tempo map must start at tick zero"));
        }
        if tempo_map
            .windows(2)
            .any(|points| points[0].tick >= points[1].tick)
        {
            return Err(AudioError::new(
                "tempo map ticks must be strictly increasing",
            ));
        }
        if tempo_map
            .iter()
            .any(|point| !point.bpm.is_finite() || !(20.0..=400.0).contains(&point.bpm))
        {
            return Err(AudioError::new(
                "tempo map bpm must be finite and between 20 and 400",
            ));
        }

        let mut segments = Vec::with_capacity(tempo_map.len());
        let mut start_seconds = 0.0;
        for (index, point) in tempo_map.iter().enumerate() {
            if let Some(previous) = tempo_map.get(index.wrapping_sub(1)) {
                let ticks = point.tick.saturating_sub(previous.tick) as f64;
                start_seconds += ticks * 60.0 / (previous.bpm * f64::from(ppq));
            }
            segments.push(TempoSegment {
                start_tick: point.tick,
                start_seconds,
                bpm: point.bpm,
            });
        }

        Ok(Self {
            sample_rate,
            ppq,
            segments: segments.into_boxed_slice(),
        })
    }

    #[must_use]
    pub const fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[must_use]
    pub const fn ppq(&self) -> u32 {
        self.ppq
    }

    #[must_use]
    pub fn tick_to_seconds(&self, tick: f64) -> f64 {
        let Some(first) = self.segments.first() else {
            return 0.0;
        };
        let target = tick.max(0.0);
        let mut selected = *first;
        for segment in &self.segments {
            if target < segment.start_tick as f64 {
                break;
            }
            selected = *segment;
        }
        selected.start_seconds
            + (target - selected.start_tick as f64) * 60.0 / (selected.bpm * f64::from(self.ppq))
    }

    #[must_use]
    pub fn tick_to_samples(&self, tick: u64) -> Option<u64> {
        self.seconds_to_samples(self.tick_to_seconds(tick as f64))
    }

    #[must_use]
    pub fn beat_to_samples(&self, beat: f64) -> Option<u64> {
        if !beat.is_finite() || beat < 0.0 {
            return None;
        }
        self.seconds_to_samples(self.tick_to_seconds(beat * f64::from(self.ppq)))
    }

    fn seconds_to_samples(&self, seconds: f64) -> Option<u64> {
        let samples = seconds * f64::from(self.sample_rate);
        (samples.is_finite() && samples >= 0.0 && samples <= u64::MAX as f64)
            .then_some(samples.round() as u64)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ScheduledNote {
    pub start_sample: u64,
    pub end_sample: u64,
    pub midi_note: u8,
    pub velocity: f32,
    pub waveform: Waveform,
    pub instrument: FactoryInstrument,
    pub left_gain: f32,
    pub right_gain: f32,
}

#[derive(Debug, Clone, Copy)]
struct VoiceCheckpoint {
    note_indices: [usize; MAX_VOICES],
}

fn simulate_note_on(slots: &mut [usize; MAX_VOICES], notes: &[ScheduledNote], note_index: usize) {
    let Some(note) = notes.get(note_index).copied() else {
        return;
    };
    for slot in slots.iter_mut() {
        if *slot != EMPTY_NOTE_INDEX
            && notes
                .get(*slot)
                .is_none_or(|active| active.end_sample <= note.start_sample)
        {
            *slot = EMPTY_NOTE_INDEX;
        }
    }

    let mut selected = 0;
    let mut oldest_start = u64::MAX;
    for (index, slot) in slots.iter().enumerate() {
        if *slot == EMPTY_NOTE_INDEX {
            selected = index;
            break;
        }
        if let Some(active) = notes.get(*slot) {
            if active.start_sample < oldest_start {
                oldest_start = active.start_sample;
                selected = index;
            }
        } else {
            selected = index;
            break;
        }
    }
    slots[selected] = note_index;
}

fn resolve_factory_instrument(
    project: &Project,
    track_id: &str,
) -> Result<FactoryInstrument, AudioError> {
    let safe_device_id = format!("instrument-{track_id}");
    let legacy_device_id = format!("instrument:{track_id}");
    let Some(device) = project
        .devices
        .iter()
        .find(|device| device.id == safe_device_id)
        .or_else(|| {
            project
                .devices
                .iter()
                .find(|device| device.id == legacy_device_id)
        })
    else {
        // Preserve the original prototype's audible default for projects that
        // predate instrument devices, without changing the Project schema.
        return Ok(FactoryInstrument::AnalogLead);
    };
    let Some(preset) = device.kind.strip_prefix("builtin.instrument.") else {
        return Err(AudioError::new(format!(
            "instrument device {} must use builtin.instrument.<preset>",
            device.id
        )));
    };
    FactoryInstrument::from_preset(preset)
        .ok_or_else(|| AudioError::new(format!("unsupported factory instrument preset: {preset}")))
}

/// Immutable, precomputed DSP graph input for a realtime callback.
#[derive(Debug, Clone)]
pub struct GraphSnapshot {
    sample_rate: u32,
    notes: Box<[ScheduledNote]>,
    voice_checkpoints: Box<[VoiceCheckpoint]>,
    duration_samples: u64,
}

impl GraphSnapshot {
    pub fn from_project(project: &Project, sample_rate: u32) -> Result<Arc<Self>, AudioError> {
        let clock = TempoClock::from_project(project, sample_rate)?;
        let any_solo = project.tracks.iter().any(|track| track.solo);
        let mut notes = Vec::new();

        for track in &project.tracks {
            if track.muted || (any_solo && !track.solo) {
                continue;
            }
            let instrument = resolve_factory_instrument(project, &track.id)?;
            let (pan_l, pan_r) = equal_power_pan(track.pan);
            for note in &track.pattern.notes {
                let end_beat = note.start_beat + note.length_beats;
                let start_sample = clock.beat_to_samples(note.start_beat).ok_or_else(|| {
                    AudioError::new("note start cannot be represented as samples")
                })?;
                let requested_end = clock
                    .beat_to_samples(end_beat)
                    .ok_or_else(|| AudioError::new("note end cannot be represented as samples"))?;
                let end_sample = requested_end.max(start_sample.saturating_add(1));
                notes.push(ScheduledNote {
                    start_sample,
                    end_sample,
                    midi_note: note.midi_note,
                    velocity: note.velocity,
                    waveform: track.waveform,
                    instrument,
                    left_gain: track.gain * pan_l,
                    right_gain: track.gain * pan_r,
                });
            }
        }

        notes.sort_unstable_by_key(|note| (note.start_sample, note.end_sample));
        let duration_samples = notes.iter().map(|note| note.end_sample).max().unwrap_or(0);
        let mut slots = [EMPTY_NOTE_INDEX; MAX_VOICES];
        let mut voice_checkpoints = Vec::with_capacity(
            notes
                .len()
                .checked_div(VOICE_CHECKPOINT_STRIDE)
                .unwrap_or(0)
                .saturating_add(1),
        );
        voice_checkpoints.push(VoiceCheckpoint {
            note_indices: slots,
        });
        for (note_index, _) in notes.iter().enumerate() {
            if note_index != 0 && note_index % VOICE_CHECKPOINT_STRIDE == 0 {
                voice_checkpoints.push(VoiceCheckpoint {
                    note_indices: slots,
                });
            }
            simulate_note_on(&mut slots, &notes, note_index);
        }
        if !notes.is_empty() && notes.len() % VOICE_CHECKPOINT_STRIDE == 0 {
            voice_checkpoints.push(VoiceCheckpoint {
                note_indices: slots,
            });
        }

        Ok(Arc::new(Self {
            sample_rate,
            notes: notes.into_boxed_slice(),
            voice_checkpoints: voice_checkpoints.into_boxed_slice(),
            duration_samples,
        }))
    }

    #[must_use]
    pub const fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[must_use]
    pub const fn duration_samples(&self) -> u64 {
        self.duration_samples
    }

    #[must_use]
    pub fn notes(&self) -> &[ScheduledNote] {
        &self.notes
    }

    #[inline]
    fn first_note_at_or_after(&self, position: u64) -> usize {
        let mut low = 0;
        let mut high = self.notes.len();
        while low < high {
            let middle = low + (high - low) / 2;
            if self.notes[middle].start_sample < position {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low
    }
}

#[derive(Debug, Clone, Copy)]
struct VoiceState {
    active: bool,
    start_sample: u64,
    end_sample: u64,
    phase: f32,
    phase_step: f32,
    frequency: f32,
    velocity: f32,
    waveform: Waveform,
    instrument: FactoryInstrument,
    noise_seed: u32,
    left_gain: f32,
    right_gain: f32,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            active: false,
            start_sample: 0,
            end_sample: 0,
            phase: 0.0,
            phase_step: 0.0,
            frequency: 440.0,
            velocity: 0.0,
            waveform: Waveform::Sine,
            instrument: FactoryInstrument::AnalogLead,
            noise_seed: 0x6d2b_79f5,
            left_gain: 0.0,
            right_gain: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct SafetyLimiter {
    gain: f32,
    release: f32,
    fault_count: u64,
}

impl Default for SafetyLimiter {
    fn default() -> Self {
        Self {
            gain: 1.0,
            release: 0.001,
            fault_count: 0,
        }
    }
}

impl SafetyLimiter {
    fn reset(&mut self) {
        self.gain = 1.0;
    }

    fn process(&mut self, mut left: f32, mut right: f32) -> (f32, f32) {
        if !left.is_finite() {
            left = 0.0;
            self.fault_count = self.fault_count.saturating_add(1);
        }
        if !right.is_finite() {
            right = 0.0;
            self.fault_count = self.fault_count.saturating_add(1);
        }

        let peak = left.abs().max(right.abs());
        let target_gain = if peak > MASTER_CEILING {
            MASTER_CEILING / peak
        } else {
            1.0
        };
        if target_gain < self.gain {
            self.gain = target_gain;
        } else {
            self.gain += (1.0 - self.gain) * self.release;
        }

        (
            (left * self.gain).clamp(-MASTER_CEILING, MASTER_CEILING),
            (right * self.gain).clamp(-MASTER_CEILING, MASTER_CEILING),
        )
    }
}

#[inline]
fn noise_at_sample(seed: u32, absolute_sample: u64) -> f32 {
    let mut value = seed
        ^ (absolute_sample as u32).wrapping_mul(0x9e37_79b9)
        ^ ((absolute_sample >> 32) as u32).rotate_left(16);
    if value == 0 {
        value = 0x6d2b_79f5;
    }
    value ^= value << 13;
    value ^= value >> 17;
    value ^= value << 5;
    (value as f32 / u32::MAX as f32).mul_add(2.0, -1.0)
}

#[must_use]
fn factory_envelope(instrument: FactoryInstrument, position: f32) -> f32 {
    let p = position.clamp(0.0, 1.0);
    let base = envelope(p);
    match instrument {
        FactoryInstrument::AnalogLead
        | FactoryInstrument::ElectricBass
        | FactoryInstrument::SoftKeys => base,
        FactoryInstrument::DrumKit => base,
        FactoryInstrument::WarmPad => {
            let attack = (p / 0.20).min(1.0);
            let release = if p > 0.78 { (1.0 - p) / 0.22 } else { 1.0 };
            attack * release
        }
        FactoryInstrument::Bell => {
            let decay = (1.0 - p).max(0.0);
            base * decay * decay * decay
        }
        FactoryInstrument::Pluck => {
            let decay = (1.0 - p).max(0.0);
            base * decay * decay
        }
        FactoryInstrument::Kick => {
            let decay = (1.0 - p).max(0.0);
            decay * decay * decay
        }
        FactoryInstrument::Snare => {
            let decay = (1.0 - p).max(0.0);
            let squared = decay * decay;
            squared * squared
        }
        FactoryInstrument::HiHat => {
            let decay = (1.0 - p).max(0.0);
            let squared = decay * decay;
            squared * squared * squared
        }
    }
}

#[must_use]
const fn is_percussion(instrument: FactoryInstrument) -> bool {
    matches!(
        instrument,
        FactoryInstrument::Kick | FactoryInstrument::Snare | FactoryInstrument::HiHat
    )
}

#[inline]
fn render_factory_sample(
    voice: &mut VoiceState,
    position: u64,
    duration: u64,
    sample_rate: u32,
) -> f32 {
    let elapsed = position.saturating_sub(voice.start_sample);
    let normalized = elapsed as f32 / duration.max(1) as f32;
    let phase = if is_percussion(voice.instrument) {
        (elapsed as f32 * voice.frequency / sample_rate as f32).fract()
    } else {
        voice.phase
    };
    let tonal = match voice.instrument {
        FactoryInstrument::AnalogLead => {
            oscillator(voice.waveform, phase) * 0.72
                + oscillator(Waveform::Sine, phase * 2.0) * 0.28
        }
        FactoryInstrument::WarmPad => {
            oscillator(Waveform::Sine, phase) * 0.68
                + oscillator(Waveform::Triangle, phase * 0.997) * 0.32
        }
        FactoryInstrument::ElectricBass => {
            oscillator(Waveform::Triangle, phase) * 0.82
                + oscillator(Waveform::Square, phase) * 0.18
        }
        FactoryInstrument::SoftKeys => {
            oscillator(Waveform::Sine, phase) * 0.78
                + oscillator(Waveform::Triangle, phase * 2.0) * 0.22
        }
        FactoryInstrument::Bell => {
            oscillator(Waveform::Sine, phase) * 0.62
                + oscillator(Waveform::Sine, phase * 2.01) * 0.25
                + oscillator(Waveform::Sine, phase * 3.97) * 0.13
        }
        FactoryInstrument::Pluck => {
            oscillator(Waveform::Saw, phase) * 0.62 + oscillator(Waveform::Sine, phase * 2.0) * 0.38
        }
        FactoryInstrument::Kick => oscillator(Waveform::Sine, phase),
        FactoryInstrument::Snare => {
            oscillator(Waveform::Sine, phase) * 0.24
                + noise_at_sample(voice.noise_seed, position) * 0.76
        }
        FactoryInstrument::HiHat => {
            oscillator(Waveform::Square, phase * 17.0) * 0.15
                + noise_at_sample(voice.noise_seed, position) * 0.85
        }
        // `note_on` resolves DrumKit before a voice is created. Keep a
        // finite tonal fallback here as a defensive last line of safety.
        FactoryInstrument::DrumKit => oscillator(Waveform::Sine, phase),
    };
    if !is_percussion(voice.instrument) {
        voice.phase += voice.phase_step;
        if voice.phase >= 1.0 || voice.phase < 0.0 {
            voice.phase -= voice.phase.floor();
        }
    }
    tonal * factory_envelope(voice.instrument, normalized)
}

#[derive(Debug)]
struct RenderState {
    transport_state: TransportState,
    position: u64,
    next_note_index: usize,
    loop_region: Option<LoopRegion>,
    voices: Box<[VoiceState]>,
    limiter: SafetyLimiter,
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            transport_state: TransportState::Stopped,
            position: 0,
            next_note_index: 0,
            loop_region: None,
            voices: vec![VoiceState::default(); MAX_VOICES].into_boxed_slice(),
            limiter: SafetyLimiter::default(),
        }
    }
}

/// Shared realtime/offline renderer for one immutable graph snapshot.
pub struct PlaybackEngine {
    snapshot: Arc<GraphSnapshot>,
    controller: PlaybackController,
    state: RenderState,
    note_events_remaining: usize,
}

impl fmt::Debug for PlaybackEngine {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PlaybackEngine")
            .field("sample_rate", &self.snapshot.sample_rate)
            .field("position", &self.state.position)
            .field("transport_state", &self.state.transport_state)
            .finish_non_exhaustive()
    }
}

impl PlaybackEngine {
    pub fn new(snapshot: Arc<GraphSnapshot>) -> Result<Self, AudioError> {
        if snapshot.sample_rate == 0 {
            return Err(AudioError::new("graph snapshot sample rate cannot be zero"));
        }
        Ok(Self {
            snapshot,
            controller: PlaybackController::default(),
            state: RenderState::default(),
            note_events_remaining: 0,
        })
    }

    #[must_use]
    pub fn controller(&self) -> PlaybackController {
        self.controller.clone()
    }

    #[must_use]
    pub const fn position(&self) -> u64 {
        self.state.position
    }

    #[must_use]
    pub const fn state(&self) -> TransportState {
        self.state.transport_state
    }

    /// Render interleaved output without allocating, locking, or performing I/O.
    /// This is the only render entry point used by the CPAL callback.
    pub fn render_interleaved(&mut self, output: &mut [f32], channels: usize) {
        if channels == 0 {
            return;
        }
        self.begin_callback_block();
        for frame in output.chunks_mut(channels) {
            let (left, right) = self.render_frame();
            let center = (left + right) * 0.5;
            for (channel, sample) in frame.iter_mut().enumerate() {
                *sample = if channel == 0 {
                    left
                } else if channel == 1 {
                    right
                } else {
                    center
                };
            }
        }
        self.finish_callback_block();
    }

    #[inline]
    fn begin_callback_block(&mut self) {
        self.sync_commands();
    }

    #[inline]
    fn finish_callback_block(&self) {
        self.controller
            .commands
            .published_revision
            .fetch_add(1, Ordering::AcqRel);
        self.controller
            .commands
            .position_samples
            .store(self.state.position, Ordering::Relaxed);
        self.controller
            .commands
            .published_state
            .store(self.state.transport_state as u8, Ordering::Relaxed);
        self.controller
            .commands
            .published_revision
            .fetch_add(1, Ordering::Release);
    }

    pub fn render_stereo(&mut self, output: &mut [f32]) {
        self.render_interleaved(output, 2);
    }

    fn sync_commands(&mut self) {
        let mut pending_reset = None;
        let mut last_play_index = None;
        let mut last_position_index = None;
        for command_index in 0..MAX_TRANSPORT_COMMANDS_PER_CALLBACK {
            let Some(command) = self.controller.commands.dequeue() else {
                break;
            };
            match command.kind {
                TransportCommandKind::Play => {
                    last_play_index = Some(command_index);
                    self.state.transport_state = TransportState::Playing;
                }
                TransportCommandKind::Pause => {
                    self.state.transport_state = TransportState::Paused;
                }
                TransportCommandKind::Stop => {
                    last_position_index = Some(command_index);
                    pending_reset = Some(0);
                    self.state.transport_state = TransportState::Stopped;
                }
                TransportCommandKind::SeekSamples => {
                    last_position_index = Some(command_index);
                    pending_reset = Some(command.arg0);
                }
                TransportCommandKind::SetLoop => {
                    let end_sample = command.arg1.min(self.snapshot.duration_samples);
                    self.state.loop_region = (command.arg0 < end_sample).then_some(LoopRegion {
                        start_sample: command.arg0,
                        end_sample,
                    });
                }
                TransportCommandKind::ClearLoop => {
                    self.state.loop_region = None;
                }
            }
        }
        if let Some(position) = pending_reset {
            self.reset_to(position);
        }
        if self.state.transport_state == TransportState::Playing
            && last_play_index > last_position_index
            && self.state.position >= self.snapshot.duration_samples
            && self.state.loop_region.is_none()
            && self.snapshot.duration_samples > 0
        {
            self.reset_to(0);
        }
        self.finish_at_project_end();
    }

    /// Stop a non-looping graph at its exact end without sending a command
    /// back through the control queue. This runs on the callback consumer.
    #[inline]
    fn finish_at_project_end(&mut self) {
        let at_empty_end = self.snapshot.duration_samples == 0;
        let at_non_loop_end = self.state.loop_region.is_none()
            && self.state.position >= self.snapshot.duration_samples;
        if !at_empty_end && !at_non_loop_end {
            return;
        }

        self.state.position = self.snapshot.duration_samples;
        self.state.transport_state = TransportState::Stopped;
        for voice in &mut self.state.voices {
            voice.active = false;
        }
    }

    fn reset_to(&mut self, position: u64) {
        self.state.position = position;
        self.note_events_remaining = MAX_NOTE_EVENTS_PER_QUANTUM;
        self.state.next_note_index = self.snapshot.first_note_at_or_after(position);
        self.state.limiter.reset();

        let checkpoint_index = self.state.next_note_index / VOICE_CHECKPOINT_STRIDE;
        let checkpoint_start = checkpoint_index * VOICE_CHECKPOINT_STRIDE;
        let mut note_indices = self
            .snapshot
            .voice_checkpoints
            .get(checkpoint_index)
            .map_or([EMPTY_NOTE_INDEX; MAX_VOICES], |checkpoint| {
                checkpoint.note_indices
            });
        for note_index in checkpoint_start..self.state.next_note_index {
            simulate_note_on(&mut note_indices, &self.snapshot.notes, note_index);
        }
        for note_index in &mut note_indices {
            if *note_index != EMPTY_NOTE_INDEX
                && self
                    .snapshot
                    .notes
                    .get(*note_index)
                    .is_none_or(|note| note.end_sample <= position)
            {
                *note_index = EMPTY_NOTE_INDEX;
            }
        }

        for voice in &mut self.state.voices {
            *voice = VoiceState::default();
        }
        for (voice, note_index) in self.state.voices.iter_mut().zip(note_indices) {
            if let Some(note) = self.snapshot.notes.get(note_index).copied() {
                *voice = Self::voice_state_for_note(note, position, self.snapshot.sample_rate);
            }
        }
    }

    fn render_frame(&mut self) -> (f32, f32) {
        if self.state.transport_state != TransportState::Playing {
            return (0.0, 0.0);
        }

        if self.snapshot.duration_samples == 0
            || (self.state.loop_region.is_none()
                && self.state.position >= self.snapshot.duration_samples)
        {
            self.finish_at_project_end();
            return (0.0, 0.0);
        }

        if let Some(region) = self.state.loop_region {
            if self.state.position >= region.end_sample {
                self.reset_to(region.start_sample);
            }
        }

        if self
            .state
            .position
            .is_multiple_of(NOTE_EVENT_QUANTUM_FRAMES)
        {
            self.note_events_remaining = MAX_NOTE_EVENTS_PER_QUANTUM;
        }

        for voice in &mut self.state.voices {
            if voice.active && self.state.position >= voice.end_sample {
                voice.active = false;
            }
        }

        while self.note_events_remaining > 0 {
            let Some(note) = self.snapshot.notes.get(self.state.next_note_index).copied() else {
                break;
            };
            if note.start_sample > self.state.position {
                break;
            }
            self.state.next_note_index += 1;
            self.note_events_remaining -= 1;
            if note.end_sample > self.state.position {
                self.note_on(note, self.state.position);
            }
        }

        let mut left = 0.0;
        let mut right = 0.0;
        for voice in &mut self.state.voices {
            if !voice.active {
                continue;
            }
            let duration = voice.end_sample.saturating_sub(voice.start_sample).max(1);
            let sample = render_factory_sample(
                voice,
                self.state.position,
                duration,
                self.snapshot.sample_rate,
            ) * voice.velocity;
            left += sample * voice.left_gain;
            right += sample * voice.right_gain;
        }

        let output = self.state.limiter.process(left, right);
        self.state.position = self.state.position.saturating_add(1);
        self.finish_at_project_end();
        output
    }

    fn note_on(&mut self, note: ScheduledNote, position: u64) {
        let mut selected = 0;
        let mut oldest_start = u64::MAX;
        for (index, voice) in self.state.voices.iter().enumerate() {
            if !voice.active {
                selected = index;
                break;
            }
            if voice.start_sample < oldest_start {
                oldest_start = voice.start_sample;
                selected = index;
            }
        }

        if let Some(voice) = self.state.voices.get_mut(selected) {
            *voice = Self::voice_state_for_note(note, position, self.snapshot.sample_rate);
        }
    }

    fn voice_state_for_note(note: ScheduledNote, position: u64, sample_rate: u32) -> VoiceState {
        let elapsed = position.saturating_sub(note.start_sample) as f32;
        let instrument = note.instrument.resolve_midi_note(note.midi_note);
        let midi_frequency = midi_note_hz(note.midi_note);
        let frequency = match instrument {
            FactoryInstrument::ElectricBass => midi_frequency * 0.5,
            FactoryInstrument::Kick => 60.0,
            FactoryInstrument::Snare => 185.0,
            FactoryInstrument::HiHat => 6_500.0,
            _ => midi_frequency,
        };
        let phase = (elapsed * frequency / sample_rate as f32).fract();
        let seed = (note.start_sample as u32)
            .wrapping_add(u32::from(note.midi_note).wrapping_mul(0x9e37_79b9))
            .wrapping_add(instrument as u32)
            .max(1);
        VoiceState {
            active: true,
            start_sample: note.start_sample,
            end_sample: note.end_sample,
            phase: if phase.is_finite() { phase } else { 0.0 },
            phase_step: frequency / sample_rate as f32,
            frequency,
            velocity: note.velocity,
            waveform: note.waveform,
            instrument,
            noise_seed: seed,
            left_gain: note.left_gain,
            right_gain: note.right_gain,
        }
    }
}

/// Render a fixed number of stereo frames through the same engine used by CPAL.
pub fn render_offline(snapshot: &GraphSnapshot, frames: usize) -> Result<Vec<f32>, AudioError> {
    let sample_count = frames
        .checked_mul(2)
        .ok_or_else(|| AudioError::new("offline render output is too large"))?;
    if sample_count > MAX_OFFLINE_SAMPLES {
        return Err(AudioError::new("offline render output is too large"));
    }

    let snapshot = Arc::new(snapshot.clone());
    let mut engine = PlaybackEngine::new(snapshot)?;
    engine.controller.play()?;
    let mut output = vec![0.0; sample_count];
    for block in output.chunks_mut(OFFLINE_CALLBACK_FRAMES * 2) {
        engine.render_stereo(block);
    }
    Ok(output)
}

pub struct AudioDeviceManager {
    status: AudioStatus,
    xruns: Arc<AtomicU64>,
    stream_failed: Arc<AtomicBool>,
    playback: Option<PlaybackController>,
    playback_duration_samples: u64,
    #[cfg(windows)]
    stream: Option<cpal::Stream>,
}

impl Default for AudioDeviceManager {
    fn default() -> Self {
        Self {
            status: AudioStatus {
                state: "stopped",
                device_name: None,
                sample_rate: 48_000,
                buffer_size: 256,
                xrun_count: 0,
                engine_available: cfg!(windows),
            },
            xruns: Arc::new(AtomicU64::new(0)),
            stream_failed: Arc::new(AtomicBool::new(false)),
            playback: None,
            playback_duration_samples: 0,
            #[cfg(windows)]
            stream: None,
        }
    }
}

impl AudioDeviceManager {
    pub fn status(&mut self) -> AudioStatus {
        if self.stream_failed.load(Ordering::Acquire) {
            #[cfg(windows)]
            {
                self.stream = None;
            }
            self.playback = None;
            self.playback_duration_samples = 0;
            self.status.state = "deviceLost";
        }
        let mut status = self.status.clone();
        status.xrun_count = self.xruns.load(Ordering::Relaxed);
        status
    }

    #[must_use]
    pub fn playback_controller(&self) -> Option<PlaybackController> {
        self.playback.clone()
    }

    /// Consume stream failure state and return a coherent transport/device
    /// snapshot for the polling boundary.
    pub fn poll_transport_position(&mut self) -> TransportPoll {
        let status = self.status();
        let (transport_state, position_samples, duration_samples) = self
            .playback_controller()
            .map_or((TransportState::Stopped, 0, 0), |controller| {
                let (state, position) = controller.published_snapshot();
                (state, position, self.playback_duration_samples)
            });
        TransportPoll {
            position_samples,
            transport_state: transport_state.as_str(),
            device_state: status.state,
            duration_samples,
        }
    }

    #[cfg(windows)]
    pub fn list_output_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioError> {
        let host = cpal::default_host();
        let default_id = host
            .default_output_device()
            .and_then(|device| device.id().ok())
            .map(|id| id.to_string());
        let devices = host.output_devices().map_err(|error| {
            AudioError::new(format!("cannot enumerate output devices: {error}"))
        })?;

        devices
            .map(|device| {
                let name = device.to_string();
                let id = device
                    .id()
                    .map_err(|error| AudioError::new(format!("cannot read device id: {error}")))?
                    .to_string();
                let config = device.default_output_config().map_err(|error| {
                    AudioError::new(format!("cannot read default output config: {error}"))
                })?;
                Ok(AudioDeviceInfo {
                    is_default: default_id.as_deref() == Some(id.as_str()),
                    id,
                    name,
                    host: "WASAPI".to_owned(),
                    sample_rate: config.sample_rate(),
                    channels: config.channels(),
                })
            })
            .collect()
    }

    #[cfg(not(windows))]
    pub fn list_output_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioError> {
        Ok(Vec::new())
    }

    #[cfg(windows)]
    pub fn start_playback(
        &mut self,
        snapshot: Arc<GraphSnapshot>,
        device_id: Option<&str>,
        requested_sample_rate: u32,
        requested_buffer_size: u32,
    ) -> Result<AudioStatus, AudioError> {
        let host = cpal::default_host();
        let mut devices = host.output_devices().map_err(|error| {
            AudioError::new(format!("cannot enumerate output devices: {error}"))
        })?;
        let device = if let Some(id) = device_id {
            devices
                .find(|device| {
                    device
                        .id()
                        .is_ok_and(|candidate| candidate.to_string() == id)
                })
                .ok_or_else(|| AudioError::new("selected output device is unavailable"))?
        } else {
            host.default_output_device()
                .ok_or_else(|| AudioError::new("no default output device is available"))?
        };

        let supported = device.default_output_config().map_err(|error| {
            AudioError::new(format!("cannot read default output config: {error}"))
        })?;
        let sample_rate = if requested_sample_rate == 0 {
            supported.sample_rate()
        } else {
            requested_sample_rate
        };
        if snapshot.sample_rate() != sample_rate {
            return Err(AudioError::new(
                "graph sample rate must match the realtime stream sample rate",
            ));
        }
        let buffer_size = requested_buffer_size.clamp(32, 4_096);
        let config = cpal::StreamConfig {
            channels: supported.channels(),
            sample_rate,
            buffer_size: cpal::BufferSize::Fixed(buffer_size),
        };
        let channels = usize::from(config.channels);
        let name = device.to_string();
        let xruns = Arc::new(AtomicU64::new(0));
        let callback_xruns = Arc::clone(&xruns);
        let stream_failed = Arc::new(AtomicBool::new(false));
        let callback_stream_failed = Arc::clone(&stream_failed);
        let error_callback = move |_error| {
            callback_xruns.fetch_add(1, Ordering::Relaxed);
            callback_stream_failed.store(true, Ordering::Release);
        };
        let duration_samples = snapshot.duration_samples();
        let engine = PlaybackEngine::new(snapshot)?;
        let controller = engine.controller();

        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => {
                let mut engine = engine;
                device.build_output_stream(
                    config,
                    move |data: &mut [f32], _| render_playback_f32(data, channels, &mut engine),
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let mut engine = engine;
                device.build_output_stream(
                    config,
                    move |data: &mut [i16], _| render_playback_i16(data, channels, &mut engine),
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let mut engine = engine;
                device.build_output_stream(
                    config,
                    move |data: &mut [u16], _| render_playback_u16(data, channels, &mut engine),
                    error_callback,
                    None,
                )
            }
            format => {
                return Err(AudioError::new(format!(
                    "unsupported sample format: {format:?}"
                )))
            }
        }
        .map_err(|error| AudioError::new(format!("cannot build output stream: {error}")))?;

        stream
            .play()
            .map_err(|error| AudioError::new(format!("cannot start output stream: {error}")))?;
        self.stream = Some(stream);
        self.playback = Some(controller);
        self.playback_duration_samples = duration_samples;
        self.xruns = xruns;
        self.stream_failed = stream_failed;
        self.status = AudioStatus {
            state: "running",
            device_name: Some(name),
            sample_rate,
            buffer_size,
            xrun_count: 0,
            engine_available: true,
        };
        Ok(self.status())
    }

    #[cfg(not(windows))]
    pub fn start_playback(
        &mut self,
        _snapshot: Arc<GraphSnapshot>,
        _device_id: Option<&str>,
        _requested_sample_rate: u32,
        _requested_buffer_size: u32,
    ) -> Result<AudioStatus, AudioError> {
        Err(AudioError::new(
            "real-time device output is currently available on Windows/WASAPI",
        ))
    }

    /// Compatibility path retained for the existing device smoke test.
    #[cfg(windows)]
    pub fn start_test_tone(
        &mut self,
        device_id: Option<&str>,
        requested_sample_rate: u32,
        requested_buffer_size: u32,
    ) -> Result<AudioStatus, AudioError> {
        let host = cpal::default_host();
        let mut devices = host.output_devices().map_err(|error| {
            AudioError::new(format!("cannot enumerate output devices: {error}"))
        })?;
        let device = if let Some(id) = device_id {
            devices
                .find(|device| {
                    device
                        .id()
                        .is_ok_and(|candidate| candidate.to_string() == id)
                })
                .ok_or_else(|| AudioError::new("selected output device is unavailable"))?
        } else {
            host.default_output_device()
                .ok_or_else(|| AudioError::new("no default output device is available"))?
        };

        let supported = device.default_output_config().map_err(|error| {
            AudioError::new(format!("cannot read default output config: {error}"))
        })?;
        let sample_rate = if requested_sample_rate == 0 {
            supported.sample_rate()
        } else {
            requested_sample_rate
        };
        let buffer_size = requested_buffer_size.clamp(32, 4_096);
        let config = cpal::StreamConfig {
            channels: supported.channels(),
            sample_rate,
            buffer_size: cpal::BufferSize::Fixed(buffer_size),
        };
        let channels = usize::from(config.channels);
        let name = device.to_string();
        let xruns = Arc::new(AtomicU64::new(0));
        let callback_xruns = Arc::clone(&xruns);
        let stream_failed = Arc::new(AtomicBool::new(false));
        let callback_stream_failed = Arc::clone(&stream_failed);
        let error_callback = move |_error| {
            callback_xruns.fetch_add(1, Ordering::Relaxed);
            callback_stream_failed.store(true, Ordering::Release);
        };

        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => {
                let mut phase = 0.0_f32;
                device.build_output_stream(
                    config,
                    move |data: &mut [f32], _| {
                        render_test_tone_f32(data, channels, sample_rate, &mut phase)
                    },
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let mut phase = 0.0_f32;
                device.build_output_stream(
                    config,
                    move |data: &mut [i16], _| {
                        render_test_tone_i16(data, channels, sample_rate, &mut phase)
                    },
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let mut phase = 0.0_f32;
                device.build_output_stream(
                    config,
                    move |data: &mut [u16], _| {
                        render_test_tone_u16(data, channels, sample_rate, &mut phase)
                    },
                    error_callback,
                    None,
                )
            }
            format => {
                return Err(AudioError::new(format!(
                    "unsupported sample format: {format:?}"
                )))
            }
        }
        .map_err(|error| AudioError::new(format!("cannot build output stream: {error}")))?;

        stream
            .play()
            .map_err(|error| AudioError::new(format!("cannot start output stream: {error}")))?;
        self.stream = Some(stream);
        self.playback = None;
        self.playback_duration_samples = 0;
        self.xruns = xruns;
        self.stream_failed = stream_failed;
        self.status = AudioStatus {
            state: "running",
            device_name: Some(name),
            sample_rate,
            buffer_size,
            xrun_count: 0,
            engine_available: true,
        };
        Ok(self.status())
    }

    #[cfg(not(windows))]
    pub fn start_test_tone(
        &mut self,
        _device_id: Option<&str>,
        _requested_sample_rate: u32,
        _requested_buffer_size: u32,
    ) -> Result<AudioStatus, AudioError> {
        Err(AudioError::new(
            "real-time device output is currently available on Windows/WASAPI",
        ))
    }

    pub fn stop(&mut self) -> AudioStatus {
        self.playback = None;
        self.playback_duration_samples = 0;
        self.stream_failed = Arc::new(AtomicBool::new(false));
        #[cfg(windows)]
        {
            self.stream = None;
        }
        self.status.state = "stopped";
        self.status.device_name = None;
        self.status()
    }
}

#[cfg(windows)]
#[inline]
fn render_playback_f32(data: &mut [f32], channels: usize, engine: &mut PlaybackEngine) {
    engine.render_interleaved(data, channels);
}

#[cfg(windows)]
#[inline]
fn render_playback_i16(data: &mut [i16], channels: usize, engine: &mut PlaybackEngine) {
    if channels == 0 {
        return;
    }
    engine.begin_callback_block();
    for frame in data.chunks_mut(channels) {
        let (left, right) = engine.render_frame();
        let center = (left + right) * 0.5;
        for (channel, sample) in frame.iter_mut().enumerate() {
            let value = if channel == 0 {
                left
            } else if channel == 1 {
                right
            } else {
                center
            };
            *sample = (value.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16;
        }
    }
    engine.finish_callback_block();
}

#[cfg(windows)]
#[inline]
fn render_playback_u16(data: &mut [u16], channels: usize, engine: &mut PlaybackEngine) {
    if channels == 0 {
        return;
    }
    engine.begin_callback_block();
    for frame in data.chunks_mut(channels) {
        let (left, right) = engine.render_frame();
        let center = (left + right) * 0.5;
        for (channel, sample) in frame.iter_mut().enumerate() {
            let value = if channel == 0 {
                left
            } else if channel == 1 {
                right
            } else {
                center
            };
            let normalized = value.clamp(-1.0, 1.0) * 0.5 + 0.5;
            *sample = (normalized * f32::from(u16::MAX)) as u16;
        }
    }
    engine.finish_callback_block();
}

#[cfg(windows)]
#[inline]
fn next_test_sample(sample_rate: u32, phase: &mut f32) -> f32 {
    let sample = (*phase * std::f32::consts::TAU).sin() * 0.08;
    *phase += 440.0 / sample_rate as f32;
    if *phase >= 1.0 {
        *phase -= 1.0;
    }
    sample
}

#[cfg(windows)]
fn render_test_tone_f32(data: &mut [f32], channels: usize, sample_rate: u32, phase: &mut f32) {
    if channels == 0 {
        return;
    }
    for frame in data.chunks_mut(channels) {
        let sample = next_test_sample(sample_rate, phase);
        frame.fill(sample);
    }
}

#[cfg(windows)]
fn render_test_tone_i16(data: &mut [i16], channels: usize, sample_rate: u32, phase: &mut f32) {
    if channels == 0 {
        return;
    }
    for frame in data.chunks_mut(channels) {
        let sample = (next_test_sample(sample_rate, phase) * f32::from(i16::MAX)) as i16;
        frame.fill(sample);
    }
}

#[cfg(windows)]
fn render_test_tone_u16(data: &mut [u16], channels: usize, sample_rate: u32, phase: &mut f32) {
    if channels == 0 {
        return;
    }
    for frame in data.chunks_mut(channels) {
        let normalized = next_test_sample(sample_rate, phase) * 0.5 + 0.5;
        let sample = (normalized * f32::from(u16::MAX)) as u16;
        frame.fill(sample);
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Arc};

    use sonicforge_core::{
        project::{DeviceState, Project, TempoPoint},
        sequence::NoteEvent,
    };

    use super::{
        render_offline, AudioDeviceManager, FactoryInstrument, GraphSnapshot, PlaybackEngine,
        TempoClock, TransportState,
    };

    fn note_project(notes: Vec<NoteEvent>) -> Project {
        let mut project = Project::demo();
        project.tracks[0].pattern.length_beats = 8.0;
        project.tracks[0].pattern.notes = notes;
        project
    }

    #[test]
    fn tempo_clock_maps_beats_and_tempo_changes_to_samples() {
        let mut project = Project::demo();
        project.tempo_map = vec![
            TempoPoint {
                tick: 0,
                bpm: 120.0,
            },
            TempoPoint {
                tick: 960,
                bpm: 60.0,
            },
        ];
        let clock = TempoClock::from_project(&project, 48_000).expect("clock");
        assert_eq!(clock.beat_to_samples(1.0), Some(24_000));
        assert_eq!(clock.tick_to_samples(1_920), Some(72_000));
    }

    #[test]
    fn note_on_is_scheduled_at_the_exact_sample_inside_a_block() {
        let project = note_project(vec![NoteEvent::new(1.0, 2.0, 69, 1.0)]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();
        controller.seek_samples(3_999).expect("seek");
        controller.play().expect("play");

        let mut output = [0.0_f32; 8];
        engine.render_stereo(&mut output);

        assert_eq!(output[0], 0.0);
        assert_eq!(output[2], 0.0);
        assert!(output[4].abs() > 0.0001);
    }

    #[test]
    fn transport_play_pause_stop_seek_and_loop_are_atomic_commands() {
        let project = note_project(vec![NoteEvent::new(0.0, 8.0, 60, 0.5)]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();

        controller.play().expect("play");
        let mut output = [0.0_f32; 16];
        engine.render_stereo(&mut output);
        assert_eq!(engine.state(), TransportState::Playing);
        assert_eq!(engine.position(), 8);

        controller.pause().expect("pause");
        output.fill(1.0);
        engine.render_stereo(&mut output);
        assert_eq!(engine.position(), 8);
        assert!(output.iter().all(|sample| *sample == 0.0));

        controller.seek_samples(2).expect("seek");
        controller.play().expect("play");
        engine.render_stereo(&mut output[..2]);
        assert_eq!(engine.position(), 3);

        controller.stop().expect("stop");
        output.fill(1.0);
        engine.render_stereo(&mut output[..2]);
        assert_eq!(engine.position(), 0);
        assert!(output[..2].iter().all(|sample| *sample == 0.0));

        controller.seek_samples(4).expect("seek");
        engine.render_stereo(&mut output[..0]);
        assert_eq!(engine.position(), 4);
        controller.stop().expect("stop");
        engine.render_stereo(&mut output[..0]);
        assert_eq!(engine.position(), 0);

        controller.set_loop_samples(0, 3).expect("loop");
        controller.play().expect("play");
        engine.render_stereo(&mut output[..10]);
        assert_eq!(engine.position(), 2);
    }

    #[test]
    fn offline_render_is_finite_limited_and_uses_the_realtime_path() {
        let project = note_project(vec![
            NoteEvent::new(0.0, 2.0, 60, 1.0),
            NoteEvent::new(0.0, 2.0, 60, 1.0),
        ]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let offline = render_offline(snapshot.as_ref(), 512).expect("offline render");

        let mut realtime_like = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
        realtime_like.controller().play().expect("play");
        let mut rendered = vec![0.0_f32; 512 * 2];
        realtime_like.render_stereo(&mut rendered);

        assert_eq!(offline, rendered);
        assert!(offline.iter().all(|sample| sample.is_finite()));
        assert!(offline
            .iter()
            .all(|sample| sample.abs() <= 0.98 + f32::EPSILON));
        assert!(offline.iter().any(|sample| sample.abs() > 0.1));
    }

    #[test]
    fn every_factory_instrument_maps_from_device_and_renders_distinct_audio() {
        let mut renders = Vec::new();
        for instrument in FactoryInstrument::ALL {
            let mut project = note_project(vec![NoteEvent::new(0.0, 2.0, 60, 0.9)]);
            project.devices = vec![DeviceState {
                id: "instrument-lead".to_owned(),
                kind: format!("builtin.instrument.{}", instrument.preset()),
                parameters: BTreeMap::new(),
            }];
            let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
            assert_eq!(snapshot.notes()[0].instrument, instrument);
            let audio = render_offline(snapshot.as_ref(), 2_048).expect("render");
            assert!(
                audio.iter().any(|sample| sample.abs() > 0.0001),
                "{} rendered silence",
                instrument.preset()
            );
            assert!(audio.iter().all(|sample| sample.is_finite()));
            assert!(renders.iter().all(|other| other != &audio));
            renders.push(audio);
        }
    }

    #[test]
    fn legacy_colon_instrument_id_remains_compatible() {
        let mut project = note_project(vec![NoteEvent::new(0.0, 1.0, 60, 0.8)]);
        project.devices = vec![DeviceState {
            id: "instrument:lead".to_owned(),
            kind: "builtin.instrument.bell".to_owned(),
            parameters: BTreeMap::new(),
        }];
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        assert_eq!(snapshot.notes()[0].instrument, FactoryInstrument::Bell);
    }

    #[test]
    fn drum_kit_dispatches_midi_notes_and_falls_back_safely() {
        let cases = [
            (36, FactoryInstrument::Kick),
            (38, FactoryInstrument::Snare),
            (40, FactoryInstrument::Snare),
            (42, FactoryInstrument::HiHat),
            (44, FactoryInstrument::HiHat),
            (46, FactoryInstrument::HiHat),
            (60, FactoryInstrument::AnalogLead),
        ];
        let mut renders = Vec::new();

        for (midi_note, expected) in cases {
            assert_eq!(
                FactoryInstrument::DrumKit.resolve_midi_note(midi_note),
                expected
            );
            let mut project = note_project(vec![NoteEvent::new(0.0, 2.0, midi_note, 0.9)]);
            project.devices = vec![DeviceState {
                id: "instrument-lead".to_owned(),
                kind: "builtin.instrument.drum-kit".to_owned(),
                parameters: BTreeMap::new(),
            }];
            let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
            assert_eq!(snapshot.notes()[0].instrument, FactoryInstrument::DrumKit);
            let audio = render_offline(snapshot.as_ref(), 2_048).expect("render");
            assert!(audio.iter().any(|sample| sample.abs() > 0.0001));
            assert!(audio.iter().all(|sample| sample.is_finite()));
            renders.push(audio);
        }

        assert!(renders.windows(2).all(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn active_percussion_seek_matches_continuous_render() {
        for midi_note in [36, 38, 42] {
            let mut project = note_project(vec![NoteEvent::new(0.0, 2.0, midi_note, 0.5)]);
            project.devices = vec![DeviceState {
                id: "instrument-lead".to_owned(),
                kind: "builtin.instrument.drum-kit".to_owned(),
                parameters: BTreeMap::new(),
            }];
            let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
            let seek_sample = 1_024_usize;
            let frame_count = 256_usize;

            let mut continuous = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
            continuous.controller().play().expect("play");
            let mut continuous_output = vec![0.0_f32; (seek_sample + frame_count) * 2];
            continuous.render_stereo(&mut continuous_output);

            let mut sought = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
            let sought_controller = sought.controller();
            sought_controller
                .seek_samples(seek_sample as u64)
                .expect("seek");
            sought_controller.play().expect("play");
            let mut sought_output = vec![0.0_f32; frame_count * 2];
            sought.render_stereo(&mut sought_output);

            assert_eq!(
                &continuous_output[seek_sample * 2..],
                sought_output.as_slice(),
                "MIDI {midi_note} differs after seek"
            );
        }
    }

    #[test]
    fn transport_edge_commands_preserve_enqueue_order() {
        let snapshot = GraphSnapshot::from_project(
            &note_project(vec![NoteEvent::new(0.0, 1.0, 60, 0.5)]),
            8_000,
        )
        .expect("snapshot");

        let mut stop_play = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
        let stop_play_controller = stop_play.controller();
        stop_play_controller.stop().expect("stop");
        stop_play_controller.play().expect("play");
        stop_play.render_stereo(&mut []);
        assert_eq!(stop_play.state(), TransportState::Playing);
        assert_eq!(stop_play.position(), 0);

        let mut play_stop = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
        let play_stop_controller = play_stop.controller();
        play_stop_controller.play().expect("play");
        play_stop_controller.stop().expect("stop");
        play_stop.render_stereo(&mut []);
        assert_eq!(play_stop.state(), TransportState::Stopped);
        assert_eq!(play_stop.position(), 0);

        let mut seek_stop = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
        let seek_stop_controller = seek_stop.controller();
        seek_stop_controller.seek_samples(123).expect("seek");
        seek_stop_controller.stop().expect("stop");
        seek_stop.render_stereo(&mut []);
        assert_eq!(seek_stop.state(), TransportState::Stopped);
        assert_eq!(seek_stop.position(), 0);

        let mut stop_seek = PlaybackEngine::new(snapshot).expect("engine");
        let stop_seek_controller = stop_seek.controller();
        stop_seek_controller.stop().expect("stop");
        stop_seek_controller.seek_samples(123).expect("seek");
        stop_seek.render_stereo(&mut []);
        assert_eq!(stop_seek.state(), TransportState::Stopped);
        assert_eq!(stop_seek.position(), 123);
    }

    #[test]
    fn transport_command_batch_is_bounded_and_collapses_resets() {
        let snapshot = GraphSnapshot::from_project(
            &note_project(vec![NoteEvent::new(0.0, 1.0, 60, 0.5)]),
            8_000,
        )
        .expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();
        let command_count = super::MAX_TRANSPORT_COMMANDS_PER_CALLBACK * 2 + 1;

        for sample in 0..command_count {
            controller.seek_samples(sample as u64).expect("seek");
        }

        engine.render_stereo(&mut []);
        assert_eq!(
            engine.position(),
            (super::MAX_TRANSPORT_COMMANDS_PER_CALLBACK - 1) as u64
        );

        engine.render_stereo(&mut []);
        assert_eq!(
            engine.position(),
            (super::MAX_TRANSPORT_COMMANDS_PER_CALLBACK * 2 - 1) as u64
        );

        engine.render_stereo(&mut []);
        assert_eq!(engine.position(), (command_count - 1) as u64);

        controller.stop().expect("stop");
        controller.seek_samples(123).expect("seek");
        controller.play().expect("play");
        engine.render_stereo(&mut []);
        assert_eq!(engine.position(), 123);
        assert_eq!(engine.state(), TransportState::Playing);
    }

    #[test]
    fn controller_state_is_published_by_the_callback_consumer() {
        let snapshot = GraphSnapshot::from_project(
            &note_project(vec![NoteEvent::new(0.0, 1.0, 60, 0.5)]),
            8_000,
        )
        .expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();

        assert_eq!(controller.state(), TransportState::Stopped);
        controller.play().expect("play");
        assert_eq!(controller.state(), TransportState::Stopped);
        engine.render_stereo(&mut []);
        assert_eq!(controller.state(), TransportState::Playing);

        controller.pause().expect("pause");
        assert_eq!(controller.state(), TransportState::Playing);
        engine.render_stereo(&mut []);
        assert_eq!(controller.state(), TransportState::Paused);

        controller.stop().expect("stop");
        assert_eq!(controller.state(), TransportState::Paused);
        engine.render_stereo(&mut []);
        assert_eq!(controller.state(), TransportState::Stopped);
    }

    #[test]
    fn transport_command_queue_is_bounded_and_reports_full() {
        let controller = super::PlaybackController::default();
        for _ in 0..super::TRANSPORT_COMMAND_CAPACITY {
            controller.pause().expect("queue capacity");
        }
        assert!(controller.pause().is_err());
    }

    #[test]
    fn concurrent_controller_producers_do_not_lose_or_mix_commands() {
        use std::sync::{Arc, Barrier};

        const PRODUCER_COUNT: u64 = 8;
        const COMMANDS_PER_PRODUCER: u64 = 8;

        let controller = Arc::new(super::PlaybackController::default());
        let start = Arc::new(Barrier::new(PRODUCER_COUNT as usize));
        let mut producers = Vec::new();

        for producer in 0..PRODUCER_COUNT {
            let controller = Arc::clone(&controller);
            let start = Arc::clone(&start);
            producers.push(std::thread::spawn(move || {
                start.wait();
                for command in 0..COMMANDS_PER_PRODUCER {
                    let value = producer * 10_000 + command;
                    controller
                        .set_loop_samples(value, value + 123)
                        .expect("enqueue");
                    std::thread::yield_now();
                }
            }));
        }

        for producer in producers {
            producer.join().expect("producer thread");
        }

        let mut observed = Vec::new();
        while let Some(command) = controller.commands.dequeue() {
            assert_eq!(command.kind, super::TransportCommandKind::SetLoop);
            observed.push((command.arg0, command.arg1));
        }
        observed.sort_unstable();

        let mut expected = Vec::new();
        for producer in 0..PRODUCER_COUNT {
            for command in 0..COMMANDS_PER_PRODUCER {
                let value = producer * 10_000 + command;
                expected.push((value, value + 123));
            }
        }
        assert_eq!(observed, expected);
    }

    #[test]
    fn controller_reports_position_once_per_rendered_block_and_syncs_seek_stop() {
        let project = note_project(vec![NoteEvent::new(0.0, 4.0, 60, 0.5)]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();

        controller.play().expect("play");
        let mut output = [0.0_f32; 16];
        engine.render_stereo(&mut output);
        assert_eq!(controller.position_samples(), 8);

        controller.seek_samples(123).expect("seek");
        engine.render_stereo(&mut output[..0]);
        assert_eq!(controller.position_samples(), 123);
        assert_eq!(engine.position(), 123);

        controller.stop().expect("stop");
        engine.render_stereo(&mut output[..0]);
        assert_eq!(controller.position_samples(), 0);
        assert_eq!(engine.position(), 0);
    }

    #[test]
    fn non_loop_playback_stops_at_graph_duration_and_publishes_state() {
        let project = note_project(vec![NoteEvent::new(0.0, 0.01, 60, 0.5)]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let duration = snapshot.duration_samples();
        assert!(duration > 0);

        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();
        controller.play().expect("play");
        assert_eq!(controller.state(), TransportState::Stopped);

        let mut output = vec![0.0_f32; duration as usize * 2];
        engine.render_stereo(&mut output);

        assert_eq!(engine.position(), duration);
        assert_eq!(controller.position_samples(), duration);
        assert_eq!(engine.state(), TransportState::Stopped);
        assert_eq!(controller.state(), TransportState::Stopped);

        engine.render_stereo(&mut [0.0_f32; 8]);
        assert_eq!(engine.position(), duration);
        assert_eq!(controller.position_samples(), duration);
        assert_eq!(controller.state(), TransportState::Stopped);

        controller.play().expect("replay");
        engine.render_stereo(&mut []);
        assert_eq!(engine.position(), 0);
        assert_eq!(controller.state(), TransportState::Playing);
    }

    #[test]
    fn empty_graph_is_explicitly_stopped() {
        let mut project = note_project(Vec::new());
        project.tracks.clear();
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        assert_eq!(snapshot.duration_samples(), 0);

        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();
        controller.play().expect("play");
        engine.render_stereo(&mut []);

        assert_eq!(engine.position(), 0);
        assert_eq!(controller.position_samples(), 0);
        assert_eq!(engine.state(), TransportState::Stopped);
        assert_eq!(controller.state(), TransportState::Stopped);
    }

    #[test]
    fn large_sparse_seek_uses_bounded_active_note_query() {
        const NOTE_COUNT: usize = 100_000;

        let notes = (0..NOTE_COUNT)
            .map(|index| NoteEvent::new(index as f64 * 2.0, 1.0, 60 + (index % 12) as u8, 0.5))
            .collect();
        let mut project = note_project(notes);
        project.tracks[0].pattern.length_beats = NOTE_COUNT as f64 * 2.0 + 1.0;
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        assert_eq!(snapshot.notes().len(), NOTE_COUNT);

        let last_note = snapshot.notes()[NOTE_COUNT - 1];
        let seek_position = last_note.start_sample + 1_000;
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();
        controller.seek_samples(seek_position).expect("seek");
        controller.play().expect("play");
        engine.render_stereo(&mut []);

        assert_eq!(engine.state.next_note_index, NOTE_COUNT);
        let active_voices = engine
            .state
            .voices
            .iter()
            .filter(|voice| voice.active)
            .count();
        assert_eq!(active_voices, 1);
        let active_voice = engine
            .state
            .voices
            .iter()
            .find(|voice| voice.active)
            .expect("active sparse note");
        assert_eq!(active_voice.start_sample, last_note.start_sample);

        let mut output = [0.0_f32; 2];
        engine.render_stereo(&mut output);
        assert!(output.iter().any(|sample| sample.abs() > 0.0001));
    }

    #[test]
    fn dense_same_sample_notes_are_bounded_per_engine_quantum() {
        let notes = (0..100_000)
            .map(|index| NoteEvent::new(0.0, 1.0, 48 + (index % 24) as u8, 0.2))
            .collect();
        let project = note_project(notes);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        engine.controller().play().expect("play");

        engine.render_stereo(&mut [0.0_f32; 512]);

        assert_eq!(
            engine.state.next_note_index,
            super::MAX_NOTE_EVENTS_PER_QUANTUM
        );
        assert_eq!(engine.position(), 256);
    }

    #[test]
    fn dense_event_output_does_not_depend_on_callback_buffer_boundaries() {
        let notes = (0..1_000)
            .map(|index| NoteEvent::new(0.0, 1.0, 48 + (index % 24) as u8, 0.2))
            .collect();
        let snapshot = GraphSnapshot::from_project(&note_project(notes), 8_000).expect("snapshot");
        let mut single_callback = PlaybackEngine::new(Arc::clone(&snapshot)).expect("engine");
        let mut split_callbacks = PlaybackEngine::new(snapshot).expect("engine");
        single_callback.controller().play().expect("play");
        split_callbacks.controller().play().expect("play");
        let mut single_output = [0.0_f32; 1_024];
        let mut split_output = [0.0_f32; 1_024];

        single_callback.render_stereo(&mut single_output);
        for block in split_output.chunks_mut(512) {
            split_callbacks.render_stereo(block);
        }

        assert_eq!(single_output, split_output);
    }

    #[test]
    fn loop_region_is_clamped_to_graph_duration() {
        let project = note_project(vec![NoteEvent::new(0.0, 0.01, 60, 0.5)]);
        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let duration = snapshot.duration_samples();
        let mut engine = PlaybackEngine::new(snapshot).expect("engine");
        let controller = engine.controller();

        controller
            .set_loop_samples(0, duration.saturating_add(10_000))
            .expect("loop");
        engine.render_stereo(&mut []);

        assert_eq!(engine.state.loop_region.expect("loop").end_sample, duration);
    }

    #[test]
    fn seek_preserves_voice_stealing_history_without_resurrecting_long_notes() {
        let mut notes = (0..64)
            .map(|_| NoteEvent::new(0.0, 4.0, 36, 0.2))
            .collect::<Vec<_>>();
        notes.push(NoteEvent::new(1.0, 0.25, 38, 0.2));
        let mut project = note_project(notes);
        project.tracks[0].gain = 0.001;
        let track_id = project.tracks[0].id.clone();
        project.devices.retain(|device| {
            device.id != format!("instrument-{track_id}")
                && device.id != format!("instrument:{track_id}")
        });
        project.devices.push(DeviceState {
            id: format!("instrument-{track_id}"),
            kind: "builtin.instrument.drum-kit".to_owned(),
            parameters: BTreeMap::new(),
        });

        let snapshot = GraphSnapshot::from_project(&project, 8_000).expect("snapshot");
        let seek_position = TempoClock::from_project(&project, 8_000)
            .expect("clock")
            .beat_to_samples(2.0)
            .expect("seek position");

        let mut continuous = PlaybackEngine::new(Arc::clone(&snapshot)).expect("continuous");
        continuous.controller().play().expect("play continuous");
        let mut prefix = vec![0.0_f32; seek_position as usize * 2];
        continuous.render_stereo(&mut prefix);

        let mut seeked = PlaybackEngine::new(snapshot).expect("seeked");
        let seek_controller = seeked.controller();
        seek_controller
            .seek_samples(seek_position)
            .expect("seek command");
        seek_controller.play().expect("play seeked");
        seeked.render_stereo(&mut []);

        let continuous_mask = continuous
            .state
            .voices
            .iter()
            .map(|voice| voice.active)
            .collect::<Vec<_>>();
        let seeked_mask = seeked
            .state
            .voices
            .iter()
            .map(|voice| voice.active)
            .collect::<Vec<_>>();
        assert_eq!(continuous_mask, seeked_mask);
        assert_eq!(continuous_mask.iter().filter(|active| **active).count(), 63);

        let mut continuous_output = [0.0_f32; 128];
        let mut seeked_output = [0.0_f32; 128];
        continuous.render_stereo(&mut continuous_output);
        seeked.render_stereo(&mut seeked_output);
        assert_eq!(continuous_output, seeked_output);
    }

    #[test]
    fn callback_render_boundary_has_no_lock_or_allocation_primitives() {
        let source = include_str!("lib.rs");
        let body = source
            .split("pub fn render_interleaved")
            .nth(1)
            .and_then(|rest| rest.split("pub fn render_offline").next())
            .expect("render body");
        for forbidden in [
            "Mutex",
            "RwLock",
            ".lock(",
            ".read(",
            ".write(",
            "Vec::",
            "Box::",
            "format!(",
            "println!(",
            "eprintln!(",
        ] {
            assert!(!body.contains(forbidden), "callback contains {forbidden}");
        }

        let queue_body = source
            .split("impl TransportCommands")
            .nth(1)
            .and_then(|rest| rest.split("/// Control-side handle").next())
            .expect("queue body");
        for forbidden in ["Mutex", "RwLock", ".lock(", "Vec::", "Box::", "format!"] {
            assert!(
                !queue_body.contains(forbidden),
                "queue contains {forbidden}"
            );
        }

        let cpal_body = source
            .split("fn render_playback_f32")
            .nth(1)
            .and_then(|rest| rest.split("fn next_test_sample").next())
            .expect("CPAL callback body");
        for forbidden in ["Mutex", "RwLock", ".lock(", "Vec::", "Box::", "format!"] {
            assert!(
                !cpal_body.contains(forbidden),
                "CPAL callback contains {forbidden}"
            );
        }
    }

    #[test]
    fn loop_validation_rejects_empty_region() {
        let controller = super::PlaybackController::default();
        assert!(controller.set_loop_samples(4, 4).is_err());
        controller.clear_loop().expect("clear loop");
        assert_eq!(controller.state(), TransportState::Stopped);
    }

    #[test]
    fn stopped_status_is_consistent() {
        let mut manager = AudioDeviceManager::default();
        let status = manager.status();
        assert_eq!(status.state, "stopped");
        assert_eq!(status.xrun_count, 0);
    }

    #[test]
    fn callback_failure_transitions_to_device_lost_without_locking() {
        use std::sync::atomic::Ordering;

        let mut manager = AudioDeviceManager::default();
        manager.status.state = "running";
        manager.xruns.fetch_add(1, Ordering::Relaxed);
        manager.stream_failed.store(true, Ordering::Release);

        let status = manager.status();

        assert_eq!(status.state, "deviceLost");
        assert_eq!(status.xrun_count, 1);
        assert!(manager.playback_controller().is_none());
        let stale_callback_flag = Arc::clone(&manager.stream_failed);
        assert_eq!(manager.stop().state, "stopped");
        stale_callback_flag.store(true, Ordering::Release);
        assert_eq!(manager.status().state, "stopped");
    }

    #[test]
    fn transport_position_poll_consumes_device_lost_and_returns_state() {
        use std::sync::atomic::Ordering;

        let mut manager = AudioDeviceManager::default();
        manager.status.state = "running";
        manager.stream_failed.store(true, Ordering::Release);

        let poll = manager.poll_transport_position();

        assert_eq!(poll.transport_state, "stopped");
        assert_eq!(poll.device_state, "deviceLost");
        assert_eq!(poll.position_samples, 0);
        assert_eq!(poll.duration_samples, 0);
        assert!(manager.playback_controller().is_none());
    }
}
