use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::project::Project;
use crate::synth::{envelope, midi_note_hz, oscillator, Pcg32};

#[derive(Debug, Clone, Copy)]
pub struct RenderSpec {
    pub sample_rate: u32,
    pub channels: u16,
    pub tail_seconds: f64,
    pub seed: u64,
}

impl Default for RenderSpec {
    fn default() -> Self {
        Self {
            sample_rate: 48_000,
            channels: 2,
            tail_seconds: 0.5,
            seed: 42,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderError {
    InvalidProject(&'static str),
    InvalidSpec(&'static str),
}

impl Display for RenderError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidProject(message) => write!(f, "invalid project: {message}"),
            Self::InvalidSpec(message) => write!(f, "invalid render spec: {message}"),
        }
    }
}

impl Error for RenderError {}

const MAX_OUTPUT_SAMPLES: usize = 100_000_000;

#[must_use]
pub fn equal_power_pan(pan: f32) -> (f32, f32) {
    let normalized = (pan.clamp(-1.0, 1.0) + 1.0) * 0.25 * std::f32::consts::PI;
    (normalized.cos(), normalized.sin())
}

pub fn render_project(project: &Project, spec: RenderSpec) -> Result<Vec<f32>, RenderError> {
    render_project_with_layers(project, spec, false)
}

pub fn render_demo(spec: RenderSpec) -> Result<Vec<f32>, RenderError> {
    let project = Project::demo();
    render_project_with_layers(&project, spec, true)
}

fn render_project_with_layers(
    project: &Project,
    spec: RenderSpec,
    include_demo_layers: bool,
) -> Result<Vec<f32>, RenderError> {
    project.validate().map_err(RenderError::InvalidProject)?;
    if !(8_000..=192_000).contains(&spec.sample_rate) {
        return Err(RenderError::InvalidSpec("sample rate must be 8000..192000"));
    }
    if spec.channels != 2 {
        return Err(RenderError::InvalidSpec(
            "prototype currently renders stereo only",
        ));
    }
    if !spec.tail_seconds.is_finite() || !(0.0..=30.0).contains(&spec.tail_seconds) {
        return Err(RenderError::InvalidSpec(
            "tail seconds must be finite and 0..30",
        ));
    }

    let longest_beats = project
        .tracks
        .iter()
        .map(|track| track.pattern.length_beats)
        .fold(0.0_f64, f64::max);
    let duration_seconds = longest_beats * 60.0 / project.bpm + spec.tail_seconds;
    let frame_count = (duration_seconds * f64::from(spec.sample_rate)).ceil();
    if !frame_count.is_finite() || frame_count > usize::MAX as f64 {
        return Err(RenderError::InvalidSpec("render duration is too large"));
    }
    let frames = frame_count as usize;
    let sample_count = frames
        .checked_mul(2)
        .ok_or(RenderError::InvalidSpec("render output is too large"))?;
    if sample_count > MAX_OUTPUT_SAMPLES {
        return Err(RenderError::InvalidSpec(
            "render output exceeds prototype allocation limit",
        ));
    }
    let mut output = vec![0.0_f32; sample_count];

    for track in &project.tracks {
        let (pan_l, pan_r) = equal_power_pan(track.pan);
        for note in &track.pattern.notes {
            let start_seconds = note.start_beat * 60.0 / project.bpm;
            let note_seconds = note.length_beats * 60.0 / project.bpm;
            let start_frame = (start_seconds * f64::from(spec.sample_rate)).round() as usize;
            let note_frames = (note_seconds * f64::from(spec.sample_rate)).round() as usize;
            let frequency = midi_note_hz(note.midi_note);

            for local in 0..note_frames {
                let frame = start_frame.saturating_add(local);
                if frame >= frames {
                    break;
                }
                let t = local as f32 / spec.sample_rate as f32;
                let position = local as f32 / note_frames.max(1) as f32;
                let phase = t * frequency;
                let sample = oscillator(track.waveform, phase)
                    * envelope(position)
                    * note.velocity
                    * track.gain;
                output[frame * 2] += sample * pan_l;
                output[frame * 2 + 1] += sample * pan_r;
            }
        }
    }

    if include_demo_layers {
        add_demo_drums(&mut output, spec.sample_rate, project.bpm);
        add_laser_layer(&mut output, spec.sample_rate, spec.seed);
    }

    for sample in &mut output {
        if !sample.is_finite() {
            *sample = 0.0;
        }
        *sample = soft_clip(*sample);
    }

    Ok(output)
}

fn add_demo_drums(output: &mut [f32], sample_rate: u32, bpm: f64) {
    let frames = output.len() / 2;
    let beat_seconds = 60.0 / bpm;
    for beat in 0..8 {
        let start = (beat as f64 * beat_seconds * f64::from(sample_rate)) as usize;
        let kick = beat % 2 == 0;
        let duration = if kick { 0.18 } else { 0.12 };
        let count = (duration * f64::from(sample_rate)) as usize;
        for local in 0..count {
            let frame = start + local;
            if frame >= frames {
                break;
            }
            let p = local as f32 / count.max(1) as f32;
            let t = local as f32 / sample_rate as f32;
            let sample = if kick {
                let hz = 140.0 * (55.0_f32 / 140.0).powf(p);
                (std::f32::consts::TAU * hz * t).sin() * (1.0 - p).powf(3.0) * 0.7
            } else {
                let n = hash_noise((beat * 100_000 + local) as u64);
                n * (1.0 - p).powf(5.0) * 0.30
            };
            output[frame * 2] += sample;
            output[frame * 2 + 1] += sample;
        }
    }
}

fn add_laser_layer(output: &mut [f32], sample_rate: u32, seed: u64) {
    let frames = output.len() / 2;
    let start = sample_rate as usize * 3;
    let count = (sample_rate as f32 * 0.65) as usize;
    let mut rng = Pcg32::new(seed);
    let mut phase = 0.0_f32;
    for local in 0..count {
        let frame = start + local;
        if frame >= frames {
            break;
        }
        let p = local as f32 / count.max(1) as f32;
        let hz = 2_400.0 * (120.0_f32 / 2_400.0).powf(p);
        phase += hz / sample_rate as f32;
        let tonal = oscillator(crate::project::Waveform::Square, phase) * 0.14;
        let noise = rng.next_bipolar() * 0.03;
        let amp = (1.0 - p).powf(1.4);
        let sample = (tonal + noise) * amp;
        output[frame * 2] += sample * (1.0 - p * 0.6);
        output[frame * 2 + 1] += sample * (0.4 + p * 0.6);
    }
}

fn hash_noise(mut value: u64) -> f32 {
    value ^= value >> 33;
    value = value.wrapping_mul(0xff51_afd7_ed55_8ccd);
    value ^= value >> 33;
    value = value.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    value ^= value >> 33;
    let unit = (value as u32) as f32 / u32::MAX as f32;
    unit.mul_add(2.0, -1.0)
}

fn soft_clip(value: f32) -> f32 {
    value / (1.0 + value.abs())
}

#[cfg(test)]
mod tests {
    use crate::Project;

    use super::{render_project, RenderSpec};

    #[test]
    fn render_is_deterministic() {
        let project = Project::demo();
        let a = render_project(&project, RenderSpec::default()).expect("render a");
        let b = render_project(&project, RenderSpec::default()).expect("render b");
        assert_eq!(a, b);
    }

    #[test]
    fn render_is_finite_and_not_silent() {
        let project = Project::demo();
        let audio = render_project(&project, RenderSpec::default()).expect("render");
        assert!(audio.iter().all(|sample| sample.is_finite()));
        assert!(audio.iter().any(|sample| sample.abs() > 0.01));
    }

    #[test]
    fn oversized_render_is_rejected_before_allocation() {
        let mut project = Project::demo();
        project.tracks[0].pattern.length_beats = 10_000.0;
        let error = render_project(
            &project,
            RenderSpec {
                sample_rate: 192_000,
                tail_seconds: 0.0,
                ..RenderSpec::default()
            },
        )
        .expect_err("oversized render should be rejected");
        assert_eq!(
            error,
            super::RenderError::InvalidSpec("render output exceeds prototype allocation limit")
        );
    }

    #[test]
    fn invalid_render_spec_is_rejected() {
        let project = Project::demo();

        let invalid_sample_rate = RenderSpec {
            sample_rate: 7_999,
            ..RenderSpec::default()
        };
        assert!(matches!(
            render_project(&project, invalid_sample_rate),
            Err(super::RenderError::InvalidSpec(
                "sample rate must be 8000..192000"
            ))
        ));

        let invalid_channels = RenderSpec {
            channels: 1,
            ..RenderSpec::default()
        };
        assert!(matches!(
            render_project(&project, invalid_channels),
            Err(super::RenderError::InvalidSpec(
                "prototype currently renders stereo only"
            ))
        ));

        let invalid_tail = RenderSpec {
            tail_seconds: f64::NAN,
            ..RenderSpec::default()
        };
        assert!(matches!(
            render_project(&project, invalid_tail),
            Err(super::RenderError::InvalidSpec(
                "tail seconds must be finite and 0..30"
            ))
        ));
    }
}
