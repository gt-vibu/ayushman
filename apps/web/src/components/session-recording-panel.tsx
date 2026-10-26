'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, CircleStop, LoaderCircle, Mic, Pause, Play, Share2 } from 'lucide-react';
import { api, API_BASE, practicePath } from '@/lib/api';

type Recording = { id: string; status: string; sharingStatus: string; durationSeconds: number | null; startedAt: string | null; retentionExpiresAt: string | null; sizeBytes: number; stopRequestedAt: string | null };

export function SessionRecordingPanel({ practiceId, appointmentId, appointmentStatus, enabled = false, retentionDays = 90 }: { practiceId: string; appointmentId: string; appointmentStatus: string; enabled?: boolean; retentionDays?: number }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [pendingSegmentCount, setPendingSegmentCount] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const sequence = useRef(0);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const elapsed = useRef(0);
  const started = useRef<number | null>(null);
  const meterCleanup = useRef<(() => void) | null>(null);
  const pendingSegments = useRef(new Map<number, Blob>());
  const completionDuration = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try { setRecordings(await api<Recording[]>(practicePath(practiceId, `/session-recordings/appointments/${appointmentId}?refresh=${Date.now()}`))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load session recordings.'); }
    finally { setLoading(false); }
  }, [practiceId, appointmentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (appointmentStatus === 'interrupted' && recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, [appointmentStatus]);

  // The customer responds from a separate account and browser session. Keep an
  // open practitioner panel in sync so consent does not look stuck until it is
  // closed and reopened.
  useEffect(() => {
    if (!recordings.some((item) => ['awaiting_customer_consent', 'ready_to_record'].includes(item.status))) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [recordings, refresh]);

  useEffect(() => {
    if (!recordingId) return;
    const timer = window.setInterval(() => {
      if (recorder.current?.state === 'recording' && started.current !== null) setSeconds(Math.floor(elapsed.current + (Date.now() - started.current) / 1000));
    }, 1000);
    const monitor = window.setInterval(() => {
      void api<{ status: string }>(practicePath(practiceId, `/session-recordings/${recordingId}/state?check=${Date.now()}`))
        .then((state) => { if (state.status === 'stop_requested') { setRecordings((current) => current.map((item) => item.id === recordingId ? { ...item, status: state.status, stopRequestedAt: new Date().toISOString() } : item)); if (recorder.current?.state === 'recording') recorder.current.stop(); } })
        .catch(() => undefined);
    }, 2500);
    return () => { window.clearInterval(timer); window.clearInterval(monitor); };
  }, [recordingId, practiceId]);

  async function requestConsent() {
    setBusy(true); setError('');
    try { await api(practicePath(practiceId, `/session-recordings/appointments/${appointmentId}`), { method: 'POST' }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not request consent.'); }
    finally { setBusy(false); }
  }

  async function uploadPart(id: string, index: number, part: Blob) {
    const form = new FormData(); form.append('chunk', part, `session-${index}.webm`);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await api(practicePath(practiceId, `/session-recordings/${id}/chunks/${index}`), { method: 'POST', body: form }); return; }
      catch (cause) { lastError = cause; await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1))); }
    }
    throw lastError;
  }

  async function start(recording: Recording) {
    setBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record audio. Try a current browser over HTTPS.');
      // This feature records an in-room session through the practitioner's mic.
      // Browser noise suppression/echo cancellation can remove a quieter voice
      // across the room, so leave those DSP filters off for this capture.
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
      stream.current = microphone;
      if (!microphone.getAudioTracks().some((track) => track.readyState === 'live')) throw new Error('No active microphone input was found. Check the selected microphone and its permission, then try again.');
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser does not support a compatible audio format.');
      // Construct before changing the server state, so unsupported encoder options
      // cannot leave an otherwise idle recording stuck in "recording".
      const media = new MediaRecorder(microphone, { mimeType });
      await api(practicePath(practiceId, `/session-recordings/${recording.id}/start`), { method: 'POST', body: JSON.stringify({ mimeType }) });
      setRecordings((current) => current.map((item) => item.id === recording.id ? { ...item, status: 'recording', startedAt: new Date().toISOString() } : item));
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
      audioContext.createMediaStreamSource(microphone).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      let lastMeterUpdate = 0;
      const measure = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) { const centered = (sample - 128) / 128; sumSquares += centered * centered; }
        if (now - lastMeterUpdate >= 100) {
          const rms = Math.sqrt(sumSquares / samples.length);
          setMicLevel(Math.min(100, Math.round(rms * 320)));
          lastMeterUpdate = now;
        }
        frame = requestAnimationFrame(measure);
      };
      frame = requestAnimationFrame(measure);
      meterCleanup.current = () => { cancelAnimationFrame(frame); setMicLevel(0); void audioContext.close(); meterCleanup.current = null; };
      recorder.current = media; sequence.current = 0; elapsed.current = 0; started.current = Date.now(); uploadQueue.current = Promise.resolve(); pendingSegments.current.clear(); completionDuration.current = null; setPendingSegmentCount(0);
      setSeconds(0); setRecordingId(recording.id); setPaused(false);
      media.ondataavailable = (event) => {
        if (!event.data.size) return;
        const index = sequence.current++;
        pendingSegments.current.set(index, event.data); setPendingSegmentCount(pendingSegments.current.size);
        uploadQueue.current = uploadQueue.current.catch(() => undefined).then(() => uploadPart(recording.id, index, event.data)).then(() => { pendingSegments.current.delete(index); setPendingSegmentCount(pendingSegments.current.size); });
        void uploadQueue.current.catch((cause) => { setError(cause instanceof Error ? `A recording segment needs retry: ${cause.message}` : 'A recording segment needs retry.'); if (recorder.current?.state === 'recording') recorder.current.stop(); });
      };
      media.onpause = () => { if (started.current !== null) { elapsed.current += (Date.now() - started.current) / 1000; started.current = null; } setPaused(true); };
      media.onresume = () => { started.current = Date.now(); setPaused(false); };
      media.onstop = () => {
        const durationSeconds = Math.max(1, Math.round(elapsed.current + (started.current === null ? 0 : (Date.now() - started.current) / 1000)));
        elapsed.current = durationSeconds;
        started.current = null;
        microphone.getTracks().forEach((track) => track.stop()); meterCleanup.current?.(); stream.current = null; recorder.current = null;
        setBusy(true);
        completionDuration.current = durationSeconds;
        void uploadQueue.current.then(async () => {
          if (pendingSegments.current.size) throw new Error(`${pendingSegments.current.size} segment${pendingSegments.current.size === 1 ? '' : 's'} need retrying before the recording can be finalized.`);
          await api(practicePath(practiceId, `/session-recordings/${recording.id}/complete`), { method: 'POST', body: JSON.stringify({ durationSeconds }) });
          completionDuration.current = null; setRecordingId(null); setSeconds(0); await refresh();
        }).catch((cause) => setError(cause instanceof Error ? `${cause.message} Your audio is still private until all segments are safely saved.` : 'Could not finish uploading this recording.')).finally(() => setBusy(false));
      };
      media.start(5_000);
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop()); meterCleanup.current?.(); stream.current = null;
      setError(cause instanceof Error ? cause.message : 'Could not start recording.');
    } finally { setBusy(false); }
  }

  function stop() { if (recorder.current && recorder.current.state !== 'inactive') { setBusy(true); recorder.current.stop(); } }
  async function retryUpload() {
    if (!recordingId || completionDuration.current === null) return;
    setBusy(true); setError('');
    try {
      for (const [index, part] of [...pendingSegments.current.entries()].sort(([a], [b]) => a - b)) {
        await uploadPart(recordingId, index, part);
        pendingSegments.current.delete(index); setPendingSegmentCount(pendingSegments.current.size);
      }
      await api(practicePath(practiceId, `/session-recordings/${recordingId}/complete`), { method: 'POST', body: JSON.stringify({ durationSeconds: completionDuration.current }) });
      completionDuration.current = null; setRecordingId(null); setSeconds(0); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retry the recording upload.'); }
    finally { setBusy(false); }
  }
  function togglePause() {
    const media = recorder.current;
    if (!media) return;
    if (media.state === 'recording') media.pause(); else if (media.state === 'paused') media.resume();
  }

  async function share(id: string) {
    setBusy(true); setError('');
    try { await api(practicePath(practiceId, `/session-recordings/${id}/share`), { method: 'POST' }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not share this recording.'); }
    finally { setBusy(false); }
  }

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const active = recordings.find((item) => item.id === recordingId);
  return <section className="session-recording-panel">
    <header><span className="session-recording-icon"><AudioLines size={16}/></span><div><h3>Session Replay</h3><p>Optional audio recording. Customer consent is required before capture.</p></div></header>
    {!enabled && <p className="session-recording-disabled">Recording is disabled by practice settings. Enable it in Settings before requesting customer consent.</p>}
    {loading ? <small>Loading recording history…</small> : <div className="session-recording-list">{recordings.map((item) => <article key={item.id}>
      <div className="session-recording-meta"><strong>{item.status === 'awaiting_customer_consent' ? 'Waiting for customer consent' : item.status === 'ready_to_record' ? 'Consent received · ready to record' : item.status === 'recording' || item.status === 'uploading' ? item.stopRequestedAt ? 'Customer requested recording stop' : 'Recording in progress' : item.status === 'ready_for_review' ? 'Private · ready for review' : item.status === 'shared' ? 'Shared with customer' : item.status === 'declined' ? 'Customer declined recording' : item.status === 'failed' ? 'Recording interrupted' : 'Recording ended'}</strong>{item.durationSeconds ? <small>{Math.floor(item.durationSeconds / 60)} min · deletes {item.retentionExpiresAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.retentionExpiresAt)) : 'under retention policy'}</small> : item.status === 'failed' ? <small>Upload did not finish. Its partial audio remains private; request consent to record again.</small> : <small>Session audio stays private until you review and share it.</small>}</div>
      {item.status === 'ready_for_review' || item.status === 'shared' ? <><audio className="session-audio-player" controls preload="metadata" src={`${API_BASE}${practicePath(practiceId, `/session-recordings/${item.id}/content`)}`}/>{item.status === 'ready_for_review' && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void share(item.id)}><Share2 size={14}/> Share with customer</button>}</> : null}
      {item.status === 'ready_to_record' && <><small>{['checked_in', 'in_progress'].includes(appointmentStatus) ? 'Both parties agreed. Start recording only when the session is under way.' : 'Consent is ready. Start the visit first, then start recording here when the session is under way.'}</small><button type="button" className="button button-primary" title={!['checked_in', 'in_progress'].includes(appointmentStatus) ? 'Start the visit before recording' : undefined} disabled={!enabled || busy || Boolean(recordingId) || !['checked_in', 'in_progress'].includes(appointmentStatus)} onClick={() => void start(item)}>{busy ? <><LoaderCircle size={14} className="ui-spin"/> Requesting microphone…</> : !['checked_in', 'in_progress'].includes(appointmentStatus) ? <><Mic size={14}/> Start visit first</> : <><Mic size={14}/> Start recording</>}</button></>}
    </article>)}</div>}
    {!loading && enabled && recordings.every((item) => ['declined','failed','expired','deleted'].includes(item.status)) && !recordingId && <><p className="session-recording-consent-note">Before requesting: both parties must agree. Capture the appointment conversation only; tell the customer if another person could be heard. Audio stays private, is shared only after your review, and is removed after {retentionDays} days. Transcription and AI processing are off.</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => void requestConsent()}><Mic size={14}/> Request recording consent</button></>}
    {active && recorder.current && <div className={`session-live-indicator${paused ? ' paused' : ''}`} role="status"><span className="session-live-dot"/><strong>{paused ? 'Recording paused' : active.stopRequestedAt ? 'Customer requested stop' : 'Recording'} · {time}</strong><span className="session-mic-meter" role="meter" aria-label="Microphone activity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={micLevel}><i style={{ width: `${micLevel}%` }}/></span><small className={`session-mic-label${micLevel < 2 ? ' silent' : ''}`}>{micLevel < 2 ? 'No voice detected — check mic position/selection' : 'Microphone audio detected'}</small><button type="button" className="button button-secondary" onClick={togglePause} aria-label={paused ? 'Resume recording' : 'Pause recording'}>{paused ? <Play size={14}/> : <Pause size={14}/>} {paused ? 'Resume' : 'Pause'}</button><button type="button" className="button button-danger" onClick={stop}><CircleStop size={14}/> Stop & save</button></div>}
    {active && completionDuration.current !== null && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void retryUpload()}><LoaderCircle size={13} className={busy ? 'ui-spin' : ''}/> {pendingSegmentCount ? `Retry ${pendingSegmentCount} pending audio segment${pendingSegmentCount === 1 ? '' : 's'}` : 'Retry saving recording'}</button>}
    {busy && !recordingId && <small className="session-recording-progress"><LoaderCircle size={13} className="ui-spin"/> Saving securely…</small>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <small className="session-recording-privacy"><Check size={13}/> Records sound picked up by this device's microphone only. It does not capture call or other app audio. Audio is private until practitioner review and sharing.</small>
  </section>;
}
