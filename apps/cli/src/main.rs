use std::env;
use std::error::Error;
use std::fs;
use std::path::PathBuf;

use sonicforge_core::render::{render_demo, RenderSpec};
use sonicforge_core::wav::write_pcm16_stereo;

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".to_owned());
    match command.as_str() {
        "demo" => {
            let output = args
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("artifacts/demo.wav"));
            if let Some(parent) = output
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
            let spec = RenderSpec::default();
            let samples = render_demo(spec)?;
            write_pcm16_stereo(&output, spec.sample_rate, &samples)?;
            println!(
                "Generated {} stereo frames at {} Hz",
                samples.len() / 2,
                spec.sample_rate
            );
            println!("Output: {}", output.display());
        }
        "help" | "--help" | "-h" => print_help(),
        other => {
            eprintln!("Unknown command: {other}");
            print_help();
            std::process::exit(2);
        }
    }
    Ok(())
}

fn print_help() {
    println!("SonicForge Studio prototype CLI");
    println!();
    println!("Usage:");
    println!("  sonicforge-cli demo [output.wav]");
}
