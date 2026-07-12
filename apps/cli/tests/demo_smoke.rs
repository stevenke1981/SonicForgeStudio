use std::fs;
use std::path::Path;
use std::process::Command;

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().expect("u16"))
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32"))
}

fn run_demo(path: &Path) -> Vec<u8> {
    let status = Command::new(env!("CARGO_BIN_EXE_sonicforge-cli"))
        .args(["demo", path.to_str().expect("UTF-8 temp path")])
        .status()
        .expect("run CLI demo");
    assert!(status.success(), "CLI demo failed: {status}");
    fs::read(path).expect("read generated WAV")
}

#[test]
fn demo_wav_is_valid_non_silent_and_byte_deterministic() {
    let directory =
        std::env::temp_dir().join(format!("sonicforge-cli-smoke-{}", std::process::id()));
    fs::create_dir_all(&directory).expect("create smoke directory");
    let first_path = directory.join("first.wav");
    let second_path = directory.join("second.wav");
    let first = run_demo(&first_path);
    let second = run_demo(&second_path);

    assert_eq!(first, second);
    assert!(first.len() > 44);
    assert_eq!(&first[0..4], b"RIFF");
    assert_eq!(&first[8..12], b"WAVE");
    assert_eq!(&first[12..16], b"fmt ");
    assert_eq!(read_u32(&first, 16), 16);
    assert_eq!(read_u16(&first, 20), 1);
    assert_eq!(read_u16(&first, 22), 2);
    assert_eq!(read_u32(&first, 24), 48_000);
    assert_eq!(read_u32(&first, 28), 192_000);
    assert_eq!(read_u16(&first, 32), 4);
    assert_eq!(read_u16(&first, 34), 16);
    assert_eq!(&first[36..40], b"data");
    assert_eq!(read_u32(&first, 40) as usize, first.len() - 44);
    assert_eq!(first.len() % 4, 0);

    let samples: Vec<i16> = first[44..]
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes(chunk.try_into().expect("i16")))
        .collect();
    assert!(samples.iter().any(|&sample| sample != 0));
    let peak = samples
        .iter()
        .map(|sample| sample.abs())
        .max()
        .expect("samples");
    assert!(peak > 0);
}
