use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::sequence::Pattern;

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
const MAX_TRACKS: usize = 256;
const MAX_PATTERN_NOTES: usize = 100_000;
const MAX_ASSETS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub sample_rate: u32,
    pub ppq: u32,
    pub bpm: f64,
    pub tempo_map: Vec<TempoPoint>,
    pub time_signatures: Vec<TimeSignature>,
    pub tracks: Vec<Track>,
    pub devices: Vec<DeviceState>,
    pub automation: Vec<AutomationLane>,
    pub assets: Vec<AssetReference>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: TrackKind,
    pub color: String,
    pub gain: f32,
    pub pan: f32,
    pub muted: bool,
    pub solo: bool,
    pub armed: bool,
    pub pattern: Pattern,
    pub clips: Vec<Clip>,
    pub waveform: Waveform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    Instrument,
    Audio,
    Bus,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub start_tick: u64,
    pub length_ticks: u64,
    pub pattern_id: Option<String>,
    pub loop_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Waveform {
    Sine,
    Triangle,
    Saw,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoPoint {
    pub tick: u64,
    pub bpm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignature {
    pub tick: u64,
    pub numerator: u8,
    pub denominator: u8,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceState {
    pub id: String,
    pub kind: String,
    pub parameters: BTreeMap<String, f32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLane {
    pub target: String,
    pub points: Vec<AutomationPoint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPoint {
    pub tick: u64,
    pub value: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetReference {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

impl Project {
    #[must_use]
    pub fn demo() -> Self {
        use crate::sequence::NoteEvent;

        let melody = Pattern {
            length_beats: 8.0,
            notes: vec![
                NoteEvent::new(0.0, 1.0, 60, 0.80),
                NoteEvent::new(1.0, 1.0, 64, 0.75),
                NoteEvent::new(2.0, 1.0, 67, 0.78),
                NoteEvent::new(3.0, 1.0, 72, 0.82),
                NoteEvent::new(4.0, 1.0, 71, 0.76),
                NoteEvent::new(5.0, 1.0, 67, 0.74),
                NoteEvent::new(6.0, 1.0, 64, 0.72),
                NoteEvent::new(7.0, 1.0, 60, 0.80),
            ],
        };

        Self {
            schema_version: PROJECT_SCHEMA_VERSION,
            id: "sonicforge-demo".to_owned(),
            name: "SonicForge Demo".to_owned(),
            sample_rate: 48_000,
            ppq: 960,
            bpm: 120.0,
            tempo_map: vec![TempoPoint {
                tick: 0,
                bpm: 120.0,
            }],
            time_signatures: vec![TimeSignature {
                tick: 0,
                numerator: 4,
                denominator: 4,
            }],
            tracks: vec![Track {
                id: "lead".to_owned(),
                name: "Lead".to_owned(),
                kind: TrackKind::Instrument,
                color: "#f6b74a".to_owned(),
                gain: 0.36,
                pan: 0.0,
                muted: false,
                solo: false,
                armed: false,
                pattern: melody,
                clips: vec![Clip {
                    id: "lead-clip".to_owned(),
                    name: "Lead Pattern".to_owned(),
                    start_tick: 0,
                    length_ticks: 7_680,
                    pattern_id: Some("lead-pattern".to_owned()),
                    loop_enabled: true,
                }],
                waveform: Waveform::Saw,
            }],
            devices: Vec::new(),
            automation: Vec::new(),
            assets: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != PROJECT_SCHEMA_VERSION {
            return Err("unsupported project schema version");
        }
        if self.id.trim().is_empty() || self.name.trim().is_empty() {
            return Err("project id and name cannot be empty");
        }
        if !(8_000..=384_000).contains(&self.sample_rate) {
            return Err("sample rate must be between 8000 and 384000");
        }
        if !(24..=9_600).contains(&self.ppq) {
            return Err("ppq must be between 24 and 9600");
        }
        if !(20.0..=400.0).contains(&self.bpm) || !self.bpm.is_finite() {
            return Err("bpm must be finite and between 20 and 400");
        }
        if self.tempo_map.is_empty() || self.tempo_map[0].tick != 0 {
            return Err("tempo map must start at tick zero");
        }
        if self
            .tempo_map
            .windows(2)
            .any(|points| points[0].tick >= points[1].tick)
        {
            return Err("tempo map ticks must be strictly increasing");
        }
        for tempo in &self.tempo_map {
            if !tempo.bpm.is_finite() || !(20.0..=400.0).contains(&tempo.bpm) {
                return Err("tempo map bpm must be finite and between 20 and 400");
            }
        }
        if self.time_signatures.is_empty() || self.time_signatures[0].tick != 0 {
            return Err("time signature map must start at tick zero");
        }
        if self
            .time_signatures
            .windows(2)
            .any(|points| points[0].tick >= points[1].tick)
        {
            return Err("time signature ticks must be strictly increasing");
        }
        for signature in &self.time_signatures {
            if !(1..=32).contains(&signature.numerator)
                || !matches!(signature.denominator, 1 | 2 | 4 | 8 | 16 | 32)
            {
                return Err(
                    "time signature must use numerator 1..32 and denominator 1..32 power-of-two",
                );
            }
        }
        if self.tracks.len() > MAX_TRACKS {
            return Err("project cannot contain more than 256 tracks");
        }
        for track in &self.tracks {
            validate_track(track)?;
        }
        for device in &self.devices {
            if device.parameters.values().any(|value| !value.is_finite()) {
                return Err("device parameters must be finite");
            }
        }
        for lane in &self.automation {
            if lane
                .points
                .windows(2)
                .any(|points| points[0].tick > points[1].tick)
                || lane.points.iter().any(|point| !point.value.is_finite())
            {
                return Err("automation points must be finite and ordered");
            }
        }
        if self.assets.len() > MAX_ASSETS {
            return Err("project cannot contain more than 10000 assets");
        }
        for asset in &self.assets {
            validate_relative_path(&asset.path)?;
        }
        Ok(())
    }
}

fn validate_track(track: &Track) -> Result<(), &'static str> {
    if track.id.trim().is_empty() || track.name.trim().is_empty() {
        return Err("track id and name cannot be empty");
    }
    if !track.gain.is_finite() || !(0.0..=2.0).contains(&track.gain) {
        return Err("track gain must be finite and between 0 and 2");
    }
    if !track.pan.is_finite() || !(-1.0..=1.0).contains(&track.pan) {
        return Err("track pan must be finite and between -1 and 1");
    }
    if track.pattern.notes.len() > MAX_PATTERN_NOTES {
        return Err("pattern cannot contain more than 100000 notes");
    }
    if track.clips.iter().any(|clip| clip.length_ticks == 0) {
        return Err("clip length must be positive");
    }
    track.pattern.validate()
}

fn validate_relative_path(path: &str) -> Result<(), &'static str> {
    if path.trim().is_empty() {
        return Err("asset path cannot be empty");
    }
    if path.starts_with('/')
        || path.contains(['\\', ':', '\0'])
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err("asset path must be a safe portable package path");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AssetReference, Project, TempoPoint, TimeSignature};

    #[test]
    fn demo_is_valid() {
        assert_eq!(Project::demo().validate(), Ok(()));
    }

    #[test]
    fn invalid_bpm_is_rejected() {
        let mut project = Project::demo();
        project.bpm = f64::NAN;
        assert!(project.validate().is_err());
    }

    #[test]
    fn unsafe_asset_path_is_rejected() {
        for path in [
            "../outside.wav",
            "assets/../outside.wav",
            "assets/./kick.wav",
            "assets//kick.wav",
            "/absolute/kick.wav",
            "C:/samples/kick.wav",
            "C:\\samples\\kick.wav",
            "\\\\server\\share\\kick.wav",
            "//server/share/kick.wav",
        ] {
            let mut project = Project::demo();
            project.assets.push(AssetReference {
                id: "asset".to_owned(),
                kind: "audio".to_owned(),
                path: path.to_owned(),
                sha256: String::new(),
                size: 0,
            });
            assert_eq!(
                project.validate(),
                Err("asset path must be a safe portable package path"),
                "accepted unsafe package path: {path}"
            );
        }
    }

    #[test]
    fn portable_asset_path_is_accepted() {
        let mut project = Project::demo();
        project.assets.push(AssetReference {
            id: "asset".to_owned(),
            kind: "audio".to_owned(),
            path: "assets/audio/kick.wav".to_owned(),
            sha256: String::new(),
            size: 0,
        });
        assert_eq!(project.validate(), Ok(()));
    }

    #[test]
    fn tempo_map_must_start_at_zero_and_strictly_increase() {
        let mut project = Project::demo();
        project.tempo_map.clear();
        assert_eq!(project.validate(), Err("tempo map must start at tick zero"));

        project.tempo_map = vec![TempoPoint {
            tick: 1,
            bpm: 120.0,
        }];
        assert_eq!(project.validate(), Err("tempo map must start at tick zero"));

        project.tempo_map = vec![
            TempoPoint {
                tick: 0,
                bpm: 120.0,
            },
            TempoPoint {
                tick: 0,
                bpm: 140.0,
            },
        ];
        assert_eq!(
            project.validate(),
            Err("tempo map ticks must be strictly increasing")
        );
    }

    #[test]
    fn time_signature_map_enforces_order_and_spec_ranges() {
        let mut project = Project::demo();
        project.time_signatures.clear();
        assert_eq!(
            project.validate(),
            Err("time signature map must start at tick zero")
        );

        project.time_signatures = vec![TimeSignature {
            tick: 1,
            numerator: 4,
            denominator: 4,
        }];
        assert_eq!(
            project.validate(),
            Err("time signature map must start at tick zero")
        );

        project.time_signatures = vec![
            TimeSignature {
                tick: 0,
                numerator: 4,
                denominator: 4,
            },
            TimeSignature {
                tick: 0,
                numerator: 3,
                denominator: 4,
            },
        ];
        assert_eq!(
            project.validate(),
            Err("time signature ticks must be strictly increasing")
        );

        project.time_signatures = vec![TimeSignature {
            tick: 0,
            numerator: 33,
            denominator: 4,
        }];
        assert_eq!(
            project.validate(),
            Err("time signature must use numerator 1..32 and denominator 1..32 power-of-two")
        );

        project.time_signatures = vec![TimeSignature {
            tick: 0,
            numerator: 4,
            denominator: 64,
        }];
        assert_eq!(
            project.validate(),
            Err("time signature must use numerator 1..32 and denominator 1..32 power-of-two")
        );
    }

    #[test]
    fn invalid_track_pan_is_rejected() {
        let mut project = Project::demo();
        project.tracks[0].pan = 1.1;
        assert_eq!(
            project.validate(),
            Err("track pan must be finite and between -1 and 1")
        );
    }

    #[test]
    fn oversized_track_count_is_rejected() {
        let mut project = Project::demo();
        project.tracks.resize(257, project.tracks[0].clone());
        assert_eq!(
            project.validate(),
            Err("project cannot contain more than 256 tracks")
        );
    }
}
