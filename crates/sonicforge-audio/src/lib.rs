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

#[derive(Debug)]
struct TransportCommands {
    state: AtomicU8,
    seek_pending: AtomicBool,
    seek_sample: AtomicU64,
    loop_enabled: AtomicBool,
    loop_start: AtomicU64,
    loop_end: AtomicU64,
}

impl Default for TransportCommands {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(TransportState::Stopped as u8),
            seek_pending: AtomicBool::new(false),
            seek_sample: AtomicU64::new(0),
            loop_enabled: AtomicBool::new(false),
            loop_start: AtomicU64::new(0),
            loop_end: AtomicU64::new(0),
        }
    }
}

/// Control-side handle for the realtime transport.
///
/// Every method is a non-blocking atomic store. The audio callback consumes
/// the latest values at a block boundary; it never takes a mutex or waits for
/// the control thread.
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
        TransportState::from_raw(self.commands.state.load(Ordering::Acquire))
    }

    pub fn play(&self) {
        self.commands
            .state
            .store(TransportState::Playing as u8, Ordering::Release);
    }

    pub fn pause(&self) {
        self.commands
            .state
            .store(TransportState::Paused as u8, Ordering::Release);
    }

    pub fn stop(&self) {
        self.commands
            .state
            .store(TransportState::Stopped as u8, Ordering::Release);
    }

    pub fn seek_samples(&self, sample: u64) {
        self.commands.seek_sample.store(sample, Ordering::Relaxed);
        self.commands.seek_pending.store(true, Ordering::Release);
    }

    pub fn set_loop_samples(&self, start_sample: u64, end_sample: u64) -> Result<(), AudioError> {
        if start_sample >= end_sample {
            return Err(AudioError::new("loop end must be greater than loop start"));
        }

        // Disable while publishing the pair so the callback cannot elect to
        // use a partially updated region. The next block observes the new
        // region after the final Release store.
        self.commands.loop_enabled.store(false, Ordering::Release);
        self.commands
            .loop_start
            .store(start_sample, Ordering::Relaxed);
        self.commands.loop_end.store(end_sample, Ordering::Relaxed);
        self.commands.loop_enabled.store(true, Ordering::Release);
        Ok(())
    }

    pub fn clear_loop(&self) {
        self.commands.loop_enabled.store(false, Ordering::Release);
    }

    #[must_use]
    fn loop_region(&self) -> Option<LoopRegion> {
        if !self.commands.loop_enabled.load(Ordering::Acquire) {
            return None;
        }
        let region = LoopRegion {
            start_sample: self.commands.loop_start.load(Ordering::Relaxed),
            end_sample: self.commands.loop_end.load(Ordering::Relaxed),
        };
        (region.start_sample < region.end_sample).then_some(region)
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
    pub left_gain: f32,
    pub right_gain: f32,
}

/// Immutable, precomputed DSP graph input for a realtime callback.
#[derive(Debug, Clone)]
pub struct GraphSnapshot {
    sample_rate: u32,
    notes: Box<[ScheduledNote]>,
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
                    left_gain: track.gain * pan_l,
                    right_gain: track.gain * pan_r,
                });
            }
        }

        notes.sort_unstable_by_key(|note| (note.start_sample, note.end_sample));
        let duration_samples = notes.iter().map(|note| note.end_sample).max().unwrap_or(0);

        Ok(Arc::new(Self {
            sample_rate,
            notes: notes.into_boxed_slice(),
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
}

#[derive(Debug, Clone, Copy)]
struct VoiceState {
    active: bool,
    start_sample: u64,
    end_sample: u64,
    phase: f32,
    phase_step: f32,
    velocity: f32,
    waveform: Waveform,
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
            velocity: 0.0,
            waveform: Waveform::Sine,
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
        self.sync_commands();
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
    }

    pub fn render_stereo(&mut self, output: &mut [f32]) {
        self.render_interleaved(output, 2);
    }

    fn sync_commands(&mut self) {
        let did_seek = if self
            .controller
            .commands
            .seek_pending
            .swap(false, Ordering::AcqRel)
        {
            let position = self.controller.commands.seek_sample.load(Ordering::Acquire);
            self.reset_to(position);
            true
        } else {
            false
        };

        let commanded_state = self.controller.state();
        if commanded_state == TransportState::Stopped {
            if !did_seek
                && (self.state.transport_state != TransportState::Stopped
                    || self.state.position != 0
                    || self.state.voices.iter().any(|voice| voice.active))
            {
                self.reset_to(0);
            }
            self.state.transport_state = TransportState::Stopped;
        } else {
            self.state.transport_state = commanded_state;
        }
        self.state.loop_region = self.controller.loop_region();
    }

    fn reset_to(&mut self, position: u64) {
        self.state.position = position;
        self.state.next_note_index = 0;
        self.state.limiter.reset();
        for voice in &mut self.state.voices {
            *voice = VoiceState::default();
        }

        while let Some(note) = self.snapshot.notes.get(self.state.next_note_index).copied() {
            if note.start_sample >= position {
                break;
            }
            self.state.next_note_index += 1;
            if note.end_sample > position {
                self.note_on(note, position);
            }
        }
    }

    fn render_frame(&mut self) -> (f32, f32) {
        if self.state.transport_state != TransportState::Playing {
            return (0.0, 0.0);
        }

        if let Some(region) = self.state.loop_region {
            if self.state.position >= region.end_sample {
                self.reset_to(region.start_sample);
            }
        }

        while let Some(note) = self.snapshot.notes.get(self.state.next_note_index).copied() {
            if note.start_sample > self.state.position {
                break;
            }
            self.state.next_note_index += 1;
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
            if self.state.position >= voice.end_sample {
                voice.active = false;
                continue;
            }
            let duration = voice.end_sample.saturating_sub(voice.start_sample).max(1);
            let elapsed = self.state.position.saturating_sub(voice.start_sample);
            let envelope_position = elapsed as f32 / duration as f32;
            let sample = oscillator(voice.waveform, voice.phase)
                * envelope(envelope_position)
                * voice.velocity;
            left += sample * voice.left_gain;
            right += sample * voice.right_gain;
            voice.phase += voice.phase_step;
            if voice.phase >= 1.0 || voice.phase < 0.0 {
                voice.phase -= voice.phase.floor();
            }
        }

        let output = self.state.limiter.process(left, right);
        self.state.position = self.state.position.saturating_add(1);
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

        let elapsed = position.saturating_sub(note.start_sample) as f32;
        let frequency = midi_note_hz(note.midi_note);
        let phase = (elapsed * frequency / self.snapshot.sample_rate as f32).fract();
        if let Some(voice) = self.state.voices.get_mut(selected) {
            *voice = VoiceState {
                active: true,
                start_sample: note.start_sample,
                end_sample: note.end_sample,
                phase: if phase.is_finite() { phase } else { 0.0 },
                phase_step: frequency / self.snapshot.sample_rate as f32,
                velocity: note.velocity,
                waveform: note.waveform,
                left_gain: note.left_gain,
                right_gain: note.right_gain,
            };
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
    engine.controller.play();
    let mut output = vec![0.0; sample_count];
    engine.render_stereo(&mut output);
    Ok(output)
}

pub struct AudioDeviceManager {
    status: AudioStatus,
    xruns: Arc<AtomicU64>,
    stream_failed: Arc<AtomicBool>,
    playback: Option<PlaybackController>,
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
    for frame in data.chunks_mut(channels) {
        let mut stereo = [0.0_f32; 2];
        engine.render_stereo(&mut stereo);
        for (channel, sample) in frame.iter_mut().enumerate() {
            let value = if channel == 0 { stereo[0] } else { stereo[1] };
            *sample = (value.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16;
        }
    }
}

#[cfg(windows)]
#[inline]
fn render_playback_u16(data: &mut [u16], channels: usize, engine: &mut PlaybackEngine) {
    if channels == 0 {
        return;
    }
    for frame in data.chunks_mut(channels) {
        let mut stereo = [0.0_f32; 2];
        engine.render_stereo(&mut stereo);
        for (channel, sample) in frame.iter_mut().enumerate() {
            let value = if channel == 0 { stereo[0] } else { stereo[1] };
            let normalized = value.clamp(-1.0, 1.0) * 0.5 + 0.5;
            *sample = (normalized * f32::from(u16::MAX)) as u16;
        }
    }
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
    use std::sync::Arc;

    use sonicforge_core::{
        project::{Project, TempoPoint},
        sequence::NoteEvent,
    };

    use super::{
        render_offline, AudioDeviceManager, GraphSnapshot, PlaybackEngine, TempoClock,
        TransportState,
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
        controller.seek_samples(3_999);
        controller.play();

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

        controller.play();
        let mut output = [0.0_f32; 16];
        engine.render_stereo(&mut output);
        assert_eq!(engine.state(), TransportState::Playing);
        assert_eq!(engine.position(), 8);

        controller.pause();
        output.fill(1.0);
        engine.render_stereo(&mut output);
        assert_eq!(engine.position(), 8);
        assert!(output.iter().all(|sample| *sample == 0.0));

        controller.seek_samples(2);
        controller.play();
        engine.render_stereo(&mut output[..2]);
        assert_eq!(engine.position(), 3);

        controller.stop();
        output.fill(1.0);
        engine.render_stereo(&mut output[..2]);
        assert_eq!(engine.position(), 0);
        assert!(output[..2].iter().all(|sample| *sample == 0.0));

        controller.seek_samples(4);
        engine.render_stereo(&mut output[..0]);
        assert_eq!(engine.position(), 4);
        controller.stop();
        engine.render_stereo(&mut output[..0]);
        assert_eq!(engine.position(), 0);

        controller.set_loop_samples(0, 3).expect("loop");
        controller.play();
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
        realtime_like.controller().play();
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
    fn callback_render_boundary_has_no_lock_or_allocation_primitives() {
        let source = include_str!("lib.rs");
        let body = source
            .split("pub fn render_interleaved")
            .nth(1)
            .and_then(|rest| rest.split("pub fn render_stereo").next())
            .expect("render body");
        for forbidden in [
            "Mutex",
            "RwLock",
            "lock(",
            "Vec::",
            "Box::",
            "format!(",
            "println!(",
            "eprintln!(",
        ] {
            assert!(!body.contains(forbidden), "callback contains {forbidden}");
        }
    }

    #[test]
    fn loop_validation_rejects_empty_region() {
        let controller = super::PlaybackController::default();
        assert!(controller.set_loop_samples(4, 4).is_err());
        controller.clear_loop();
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
}
