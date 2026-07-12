use std::f32::consts::TAU;

use crate::project::Waveform;

#[must_use]
pub fn midi_note_hz(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((f32::from(note) - 69.0) / 12.0)
}

#[must_use]
pub fn oscillator(waveform: Waveform, phase: f32) -> f32 {
    let wrapped = phase - phase.floor();
    match waveform {
        Waveform::Sine => (TAU * wrapped).sin(),
        Waveform::Triangle => 1.0 - 4.0 * (wrapped - 0.5).abs(),
        Waveform::Saw => 2.0 * wrapped - 1.0,
        Waveform::Square => {
            if wrapped < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
    }
}

#[must_use]
pub fn envelope(position: f32) -> f32 {
    let p = position.clamp(0.0, 1.0);
    let attack = 0.04;
    let release = 0.18;
    if p < attack {
        p / attack
    } else if p > 1.0 - release {
        (1.0 - p) / release
    } else {
        1.0
    }
}

/// Deterministic small PRNG used only by the prototype recipe layer.
#[derive(Debug, Clone)]
pub struct Pcg32 {
    state: u64,
    increment: u64,
}

impl Pcg32 {
    #[must_use]
    pub const fn new(seed: u64) -> Self {
        Self {
            state: seed.wrapping_add(0x853c_49e6_748f_ea9b),
            increment: 0xda3e_39cb_94b9_5bdb,
        }
    }

    #[must_use]
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(self.increment | 1);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    #[must_use]
    pub fn next_bipolar(&mut self) -> f32 {
        let unit = self.next_u32() as f32 / u32::MAX as f32;
        unit.mul_add(2.0, -1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{midi_note_hz, Pcg32};

    #[test]
    fn a4_is_440_hz() {
        assert!((midi_note_hz(69) - 440.0).abs() < 0.001);
    }

    #[test]
    fn rng_is_deterministic() {
        let mut a = Pcg32::new(42);
        let mut b = Pcg32::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }
}
