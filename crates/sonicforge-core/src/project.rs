use crate::sequence::Pattern;

const MAX_TRACKS: usize = 256;
const MAX_PATTERN_NOTES: usize = 100_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub name: String,
    pub bpm: f64,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub name: String,
    pub gain: f32,
    pub pan: f32,
    pub pattern: Pattern,
    pub waveform: Waveform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Triangle,
    Saw,
    Square,
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
            name: "SonicForge Demo".to_owned(),
            bpm: 120.0,
            tracks: vec![Track {
                name: "Lead".to_owned(),
                gain: 0.36,
                pan: 0.0,
                pattern: melody,
                waveform: Waveform::Saw,
            }],
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.name.trim().is_empty() {
            return Err("project name cannot be empty");
        }
        if !(20.0..=400.0).contains(&self.bpm) || !self.bpm.is_finite() {
            return Err("bpm must be finite and between 20 and 400");
        }
        if self.tracks.len() > MAX_TRACKS {
            return Err("project cannot contain more than 256 tracks");
        }
        for track in &self.tracks {
            if !track.gain.is_finite() || !(0.0..=2.0).contains(&track.gain) {
                return Err("track gain must be finite and between 0 and 2");
            }
            if !track.pan.is_finite() || !(-1.0..=1.0).contains(&track.pan) {
                return Err("track pan must be finite and between -1 and 1");
            }
            if track.pattern.notes.len() > MAX_PATTERN_NOTES {
                return Err("pattern cannot contain more than 100000 notes");
            }
            track.pattern.validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Project;

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
