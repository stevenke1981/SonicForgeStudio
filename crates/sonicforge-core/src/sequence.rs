use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEvent {
    pub start_beat: f64,
    pub length_beats: f64,
    pub midi_note: u8,
    pub velocity: f32,
}

impl NoteEvent {
    #[must_use]
    pub const fn new(start_beat: f64, length_beats: f64, midi_note: u8, velocity: f32) -> Self {
        Self {
            start_beat,
            length_beats,
            midi_note,
            velocity,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub length_beats: f64,
    pub notes: Vec<NoteEvent>,
}

impl Pattern {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.length_beats.is_finite() || self.length_beats <= 0.0 {
            return Err("pattern length must be finite and positive");
        }
        for note in &self.notes {
            if !note.start_beat.is_finite() || note.start_beat < 0.0 {
                return Err("note start must be finite and non-negative");
            }
            if !note.length_beats.is_finite() || note.length_beats <= 0.0 {
                return Err("note length must be finite and positive");
            }
            let end_beat = note.start_beat + note.length_beats;
            if !end_beat.is_finite() || end_beat > self.length_beats {
                return Err("note must fit within pattern length");
            }
            if note.midi_note > 127 {
                return Err("midi note must be 0..127");
            }
            if !note.velocity.is_finite() || !(0.0..=1.0).contains(&note.velocity) {
                return Err("velocity must be finite and 0..1");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{NoteEvent, Pattern};

    #[test]
    fn rejects_zero_length_note() {
        let pattern = Pattern {
            length_beats: 4.0,
            notes: vec![NoteEvent::new(0.0, 0.0, 60, 1.0)],
        };
        assert!(pattern.validate().is_err());
    }

    #[test]
    fn rejects_note_past_pattern_end() {
        let pattern = Pattern {
            length_beats: 4.0,
            notes: vec![NoteEvent::new(3.5, 1.0, 60, 1.0)],
        };
        assert_eq!(
            pattern.validate(),
            Err("note must fit within pattern length")
        );
    }
}
