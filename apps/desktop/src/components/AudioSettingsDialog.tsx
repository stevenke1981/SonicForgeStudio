import { useEffect, useRef, useState } from "react";
import { listAudioDevices, startAudioDevice, stopAudioDevice } from "../lib/tauri";
import type { AudioDeviceInfo, AudioStatus } from "../lib/tauri";
import { useTranslation } from "../i18n";

interface AudioSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  currentStatus: AudioStatus;
  onApplied: (status: AudioStatus) => void;
  onAnnounce: (message: string) => void;
}

export function AudioSettingsDialog({ open, onClose, currentStatus, onApplied, onAnnounce }: AudioSettingsDialogProps) {
  const t = useTranslation();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState(currentStatus.sampleRate);
  const [bufferSize, setBufferSize] = useState(currentStatus.bufferSize);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    listAudioDevices()
      .then((nextDevices) => {
        if (!cancelled) {
          setDevices(nextDevices);
          const active = nextDevices.find((device) => device.name === currentStatus.deviceName);
          const preferred = active ?? nextDevices.find((device) => device.isDefault) ?? nextDevices[0];
          setDeviceId(preferred?.id ?? null);
          setSampleRate(currentStatus.sampleRate || preferred?.sampleRate || 48_000);
          setBufferSize(currentStatus.bufferSize || 256);
        }
      })
      .catch((error: unknown) => onAnnounce(error instanceof Error ? error.message : t("status.audioLoadFailed")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentStatus.bufferSize, currentStatus.deviceName, currentStatus.sampleRate, onAnnounce, open, t]);

  if (!open) return null;

  const apply = async () => {
    setLoading(true);
    try {
      const status = await startAudioDevice(deviceId, sampleRate, bufferSize);
      onApplied(status);
      onAnnounce(status.engineAvailable ? t("status.audioStarted") : t("status.audioUnavailable"));
    } catch (error) {
      onAnnounce(error instanceof Error ? error.message : t("status.audioConfigFailed"));
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    try {
      const status = await stopAudioDevice();
      onApplied(status);
      onAnnounce(t("status.audioStopped"));
    } catch (error) {
      onAnnounce(error instanceof Error ? error.message : t("status.audioStopFailed"));
    } finally {
      setLoading(false);
    }
  };

  const selectedDevice = devices.find((device) => device.id === deviceId);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-settings-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        <div className="settings-heading">
          <div><span className="eyebrow">{t("audio.engine")}</span><h2 id="audio-settings-title">{t("audio.settings")}</h2></div>
          <button type="button" className="icon-button" aria-label={t("audio.closeSettings")} onClick={onClose}>×</button>
        </div>
        <p className="settings-copy">{t("audio.description")}</p>
        <div className="settings-grid">
          <label>{t("audio.host")}<input aria-label={t("audio.hostLabel")} readOnly value={selectedDevice?.host ?? t("audio.notReported")} /></label>
          <label>{t("audio.outputDevice")}<select aria-label={t("audio.outputDeviceLabel")} value={deviceId ?? ""} onChange={(event) => setDeviceId(event.target.value || null)}>{devices.length ? devices.map((device) => <option value={device.id} key={device.id}>{t("template.deviceOption", { name: device.name, channels: device.channels, defaultSuffix: device.isDefault ? ` (${t("audio.default")})` : "" })}</option>) : <option value="">{t("audio.noDevice")}</option>}</select></label>
          <label>{t("audio.sampleRate")}<select aria-label={t("audio.sampleRateLabel")} value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value))}><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option></select></label>
          <label>{t("audio.bufferSize")}<select aria-label={t("audio.bufferSizeLabel")} value={bufferSize} onChange={(event) => setBufferSize(Number(event.target.value))}>{[64, 128, 256, 512, 1024].map((size) => <option value={size} key={size}>{size} {t("audio.frames")}</option>)}</select></label>
        </div>
        <div className="latency-readout"><span>{t("audio.estimatedLatency")}</span><strong>{((bufferSize / sampleRate) * 1000).toFixed(1)} ms</strong><small>{t("template.audioSummary", { sampleRate: sampleRate.toLocaleString(), bufferSize, state: currentStatus.state })}</small></div>
        <div className="settings-actions"><button type="button" className="ghost-button danger-button" disabled={loading || !currentStatus.engineAvailable} onClick={() => void stop()}>{t("audio.stop")}</button><div className="toolbar-spacer" /><button type="button" className="ghost-button" onClick={onClose}>{t("audio.close")}</button><button type="button" className="primary-button" disabled={loading || devices.length === 0} onClick={() => void apply()}>{loading ? t("audio.starting") : t("audio.applyStart")}</button></div>
      </section>
    </div>
  );
}
