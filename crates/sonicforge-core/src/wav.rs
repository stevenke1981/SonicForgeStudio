use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

pub fn write_pcm16_stereo(
    path: impl AsRef<Path>,
    sample_rate: u32,
    interleaved_samples: &[f32],
) -> io::Result<()> {
    if sample_rate == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "sample rate must be positive",
        ));
    }
    if !interleaved_samples.len().is_multiple_of(2) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "stereo samples must have an even length",
        ));
    }

    let data_bytes = u32::try_from(interleaved_samples.len().saturating_mul(2))
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "WAV is too large"))?;
    let riff_size = 36_u32
        .checked_add(data_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "WAV is too large"))?;

    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    writer.write_all(b"RIFF")?;
    writer.write_all(&riff_size.to_le_bytes())?;
    writer.write_all(b"WAVE")?;
    writer.write_all(b"fmt ")?;
    writer.write_all(&16_u32.to_le_bytes())?;
    writer.write_all(&1_u16.to_le_bytes())?;
    writer.write_all(&2_u16.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    let byte_rate = sample_rate
        .checked_mul(4)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "sample rate is too large"))?;
    writer.write_all(&byte_rate.to_le_bytes())?;
    writer.write_all(&4_u16.to_le_bytes())?;
    writer.write_all(&16_u16.to_le_bytes())?;
    writer.write_all(b"data")?;
    writer.write_all(&data_bytes.to_le_bytes())?;

    for &sample in interleaved_samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = (clamped * f32::from(i16::MAX)).round() as i16;
        writer.write_all(&value.to_le_bytes())?;
    }
    writer.flush()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::write_pcm16_stereo;

    #[test]
    fn writes_valid_header() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("sonicforge-{unique}.wav"));
        write_pcm16_stereo(&path, 48_000, &[0.0, 0.0, 0.5, -0.5]).expect("write wav");
        let bytes = fs::read(&path).expect("read wav");
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn rejects_odd_stereo_sample_count() {
        let error = write_pcm16_stereo(
            std::env::temp_dir().join("sonicforge-invalid.wav"),
            48_000,
            &[0.0],
        )
        .expect_err("odd sample count should fail");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn rejects_zero_sample_rate() {
        let error = write_pcm16_stereo(std::env::temp_dir().join("sonicforge-invalid.wav"), 0, &[])
            .expect_err("zero sample rate should fail");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}
