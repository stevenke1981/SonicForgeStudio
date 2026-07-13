use std::{
    error::Error,
    fmt,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use serde::Serialize;

#[cfg(windows)]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
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

pub struct AudioDeviceManager {
    status: AudioStatus,
    xruns: Arc<AtomicU64>,
    stream_failed: Arc<AtomicBool>,
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
            self.status.state = "deviceLost";
        }
        let mut status = self.status.clone();
        status.xrun_count = self.xruns.load(Ordering::Relaxed);
        status
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
                    move |data: &mut [f32], _| render_f32(data, channels, sample_rate, &mut phase),
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let mut phase = 0.0_f32;
                device.build_output_stream(
                    config,
                    move |data: &mut [i16], _| render_i16(data, channels, sample_rate, &mut phase),
                    error_callback,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let mut phase = 0.0_f32;
                device.build_output_stream(
                    config,
                    move |data: &mut [u16], _| render_u16(data, channels, sample_rate, &mut phase),
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
fn next_sample(sample_rate: u32, phase: &mut f32) -> f32 {
    let sample = (*phase * std::f32::consts::TAU).sin() * 0.08;
    *phase += 440.0 / sample_rate as f32;
    if *phase >= 1.0 {
        *phase -= 1.0;
    }
    sample
}

#[cfg(windows)]
fn render_f32(data: &mut [f32], channels: usize, sample_rate: u32, phase: &mut f32) {
    for frame in data.chunks_mut(channels) {
        let sample = next_sample(sample_rate, phase);
        frame.fill(sample);
    }
}

#[cfg(windows)]
fn render_i16(data: &mut [i16], channels: usize, sample_rate: u32, phase: &mut f32) {
    for frame in data.chunks_mut(channels) {
        let sample = (next_sample(sample_rate, phase) * f32::from(i16::MAX)) as i16;
        frame.fill(sample);
    }
}

#[cfg(windows)]
fn render_u16(data: &mut [u16], channels: usize, sample_rate: u32, phase: &mut f32) {
    for frame in data.chunks_mut(channels) {
        let normalized = next_sample(sample_rate, phase) * 0.5 + 0.5;
        let sample = (normalized * f32::from(u16::MAX)) as u16;
        frame.fill(sample);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{atomic::Ordering, Arc};

    use super::AudioDeviceManager;

    #[test]
    fn stopped_status_is_consistent() {
        let mut manager = AudioDeviceManager::default();
        let status = manager.status();
        assert_eq!(status.state, "stopped");
        assert_eq!(status.xrun_count, 0);
    }

    #[test]
    fn callback_failure_transitions_to_device_lost_without_locking() {
        let mut manager = AudioDeviceManager::default();
        manager.status.state = "running";
        manager.xruns.fetch_add(1, Ordering::Relaxed);
        manager.stream_failed.store(true, Ordering::Release);

        let status = manager.status();

        assert_eq!(status.state, "deviceLost");
        assert_eq!(status.xrun_count, 1);
        let stale_callback_flag = Arc::clone(&manager.stream_failed);
        assert_eq!(manager.stop().state, "stopped");
        stale_callback_flag.store(true, Ordering::Release);
        assert_eq!(manager.status().state, "stopped");
    }
}
