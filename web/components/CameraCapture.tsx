'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * In-page camera capture for the estimator.
 *
 * Uses getUserMedia rather than an `<input capture>` because that attribute is
 * ignored on desktop — it would silently open a plain file dialog on the exact
 * platform that has no other way to take a photo. This path works the same on
 * desktop and mobile. It needs `camera=(self)` in the Permissions-Policy header
 * (see next.config.mjs); a blanket `camera=()` blocks it with no useful error.
 *
 * Callers keep the library file input as the fallback: hardware varies,
 * permission gets denied, and on mobile some people simply prefer the native
 * camera app.
 */
export function CameraCapture({
  onCapture, onClose,
}: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Rear camera on phones; desktops ignore this and use their only one.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        // The user can close this while getUserMedia is still resolving —
        // without this the stream would be orphaned and the camera light
        // would stay on.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. You can allow it in your browser’s site settings, or add a photo from your library instead.'
            : 'We couldn’t reach a camera on this device. Add a photo from your library instead.',
        );
      }
    })();

    return () => { cancelled = true; stop(); };
  }, [stop]);

  // Escape closes, matching the dialog role.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function shoot() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    // Native resolution of the stream, not the on-screen size — the estimator
    // reads materials and condition off these, so detail matters.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        stop();
        onClose();
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="camera-frame">
        {error ? (
          <p className="camera-error">{error}</p>
        ) : (
          <video ref={videoRef} className="camera-video" playsInline muted />
        )}
      </div>

      <div className="camera-controls">
        <button type="button" className="btn btn-secondary" onClick={() => { stop(); onClose(); }}>
          Cancel
        </button>
        {!error ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={shoot}
            disabled={!ready}
          >
            {ready ? 'Capture' : 'Starting camera…'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
