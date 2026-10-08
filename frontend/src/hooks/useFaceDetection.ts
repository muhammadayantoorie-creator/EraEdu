/**
 * useFaceDetection – Standalone face-detection hook for EraEdu.
 *
 * Uses face-api.js (TinyFaceDetector + 68-point landmarks) running entirely
 * in the browser. No backend calls are needed for detection itself.
 *
 * Green is shown only after a successful, sufficiently confident detector
 * result. Camera/model failures are operational states, not violations.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';

/* ---------- configurable constants --------- */
const DETECTION_INTERVAL_MS  = 500;
// Face-api's detection score must meet this threshold before the UI can turn green.
const DETECTION_CONFIDENCE_THRESHOLD = 0.6;
const YAW_THRESHOLD           = 30;
const PITCH_THRESHOLD         = 25;
const SMOOTHING_WINDOW        = 5;
const SMOOTHING_MAJORITY      = 3;
const GRACE_PERIOD_MS         = 2_000;
const AWAY_LIMIT_SEC          = 60;
const MODEL_URL = `${import.meta.env.BASE_URL}models`;

/* ---------- types ---------- */
export type FaceStatus =
  | 'model_loading'
  | 'model_load_failed'
  | 'camera_starting'
  | 'camera_ready'
  | 'camera_unavailable'
  | 'permission_denied'
  | 'inference_error'
  | 'looking'
  | 'away'
  | 'no_face';

type DetectionKind = 'valid' | 'away' | 'no_face';

export interface FaceDetectionCallbacks {
  onViolation?: (kind: 'face_away' | 'no_face') => void;
  onAutoSubmit?: () => void;
}

export interface FaceDetectionState {
  status: FaceStatus;
  awaySeconds: number;
  violationCount: number;
  modelsLoaded: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  retryCamera: () => void;
}

/* ---- lightweight head-pose from 68 landmarks ---- */
function estimateHeadPose(landmarks: faceapi.FaceLandmarks68) {
  const pts = landmarks.positions;

  const noseTip    = pts[30];
  const chin       = pts[8];
  const leftEye    = pts[36];
  const rightEye   = pts[45];
  const leftMouth  = pts[48];
  const rightMouth = pts[54];

  const faceWidth  = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const faceHeight = Math.hypot(chin.x - noseTip.x, chin.y - noseTip.y);

  if (faceWidth === 0 || faceHeight === 0) return { yaw: 0, pitch: 0 };

  const faceCenterX = (leftEye.x + rightEye.x) / 2;
  const noseOffsetX = noseTip.x - faceCenterX;
  const yaw = (noseOffsetX / (faceWidth / 2)) * 45;

  const mouthCenterY = (leftMouth.y + rightMouth.y) / 2;
  const eyeCenterY   = (leftEye.y + rightEye.y) / 2;
  const vertRef      = mouthCenterY - eyeCenterY;
  const noseOffsetY  = noseTip.y - eyeCenterY;
  const pitch = vertRef === 0 ? 0 : ((noseOffsetY / vertRef) - 0.55) * 80;

  return { yaw, pitch };
}

/* ---- the hook ---- */
export function useFaceDetection(
  enabled: boolean,
  callbacks: FaceDetectionCallbacks = {},
): FaceDetectionState {
  const videoRef        = useRef<HTMLVideoElement>(null!);
  const streamRef       = useRef<MediaStream | null>(null);
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validFaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidDetectionRef = useRef<number | null>(null);
  const episodeStartRef = useRef<number | null>(null);
  const episodeKindRef = useRef<Exclude<DetectionKind, 'valid'> | null>(null);
  const violationEmittedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const smoothingBuffer = useRef<DetectionKind[]>([]);
  const isDetecting     = useRef(false); // prevents concurrent ML calls

  const [status,        setStatus]        = useState<FaceStatus>('model_loading');
  const [awaySeconds,   setAwaySeconds]   = useState(0);
  const [violationCount,setViolationCount]= useState(0);
  const [modelsLoaded,  setModelsLoaded]  = useState(false);
  const [cameraRetryCount, setCameraRetryCount] = useState(0);

  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const clearDetectionState = useCallback((nextStatus: FaceStatus = 'camera_ready') => {
    if (validFaceTimerRef.current) clearTimeout(validFaceTimerRef.current);
    validFaceTimerRef.current = null;
    lastValidDetectionRef.current = null;
    smoothingBuffer.current = [];
    episodeStartRef.current = null;
    episodeKindRef.current = null;
    violationEmittedRef.current = false;
    autoSubmittedRef.current = false;
    setAwaySeconds(0);
    setStatus(nextStatus);
  }, []);

  /* ---- 1. Load face-api models ---- */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('model_loading');
    setModelsLoaded(false);

    (async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        if (!cancelled) setModelsLoaded(true);
      } catch {
        if (!cancelled) setStatus('model_load_failed');
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  /* ---- 2. Start camera ---- */
  const startCamera = useCallback(async () => {
    clearDetectionState('camera_starting');
    try {
      if (navigator.permissions?.query) {
        const permResult = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (permResult.state === 'denied') {
          clearDetectionState('permission_denied');
          return null;
        }
      }
    } catch { /* permissions.query may not support 'camera' — continue */ }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (streamRef.current === stream) {
            streamRef.current = null;
            clearDetectionState('camera_unavailable');
          }
        });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // A stream is merely ready; only detector evidence may mark it "looking".
      clearDetectionState('camera_ready');
      return stream;
    } catch (err: unknown) {
      const errorName = err instanceof DOMException ? err.name : '';
      clearDetectionState(errorName === 'NotAllowedError' || errorName === 'SecurityError'
        ? 'permission_denied'
        : 'camera_unavailable');
      return null;
    }
  }, [clearDetectionState]);

  const retryCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    clearDetectionState(modelsLoaded ? 'camera_starting' : 'model_loading');
    setCameraRetryCount(c => c + 1);
  }, [clearDetectionState, modelsLoaded]);

  useEffect(() => {
    if (!enabled || !modelsLoaded) return;
    let cancelled = false;

    (async () => {
      const stream = await startCamera();
      if (cancelled && stream) stream.getTracks().forEach(t => t.stop());
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      clearDetectionState('camera_unavailable');
    };
  }, [enabled, modelsLoaded, cameraRetryCount, startCamera, clearDetectionState]);

  /* ---- helper: process a single detection result ---- */
  const processDetection = useCallback((kind: DetectionKind) => {
    const now = Date.now();
    if (kind === 'valid') {
      const buffer = smoothingBuffer.current;
      buffer.push(kind);
      if (buffer.length > SMOOTHING_WINDOW) buffer.shift();
      if (buffer.filter(value => value === 'valid').length >= SMOOTHING_MAJORITY) {
        episodeStartRef.current = null;
        episodeKindRef.current = null;
        violationEmittedRef.current = false;
        autoSubmittedRef.current = false;
        setAwaySeconds(0);
        setStatus('looking');
        lastValidDetectionRef.current = now;
        if (validFaceTimerRef.current) clearTimeout(validFaceTimerRef.current);
        // Do not leave a green badge visible when detection is paused or throttled.
        validFaceTimerRef.current = setTimeout(() => {
          if (lastValidDetectionRef.current && Date.now() - lastValidDetectionRef.current >= GRACE_PERIOD_MS) {
            smoothingBuffer.current = [];
            setStatus('camera_ready');
          }
        }, GRACE_PERIOD_MS);
      } else {
        setStatus('camera_ready');
      }
      return;
    }

    // Empty frames clear earlier successes immediately; no stale green state.
    if (validFaceTimerRef.current) clearTimeout(validFaceTimerRef.current);
    validFaceTimerRef.current = null;
    lastValidDetectionRef.current = null;
    smoothingBuffer.current = [];
    if (episodeKindRef.current !== kind) {
      episodeKindRef.current = kind;
      episodeStartRef.current = now;
      violationEmittedRef.current = false;
      autoSubmittedRef.current = false;
    }
    const elapsedMs = now - (episodeStartRef.current ?? now);
    if (elapsedMs < GRACE_PERIOD_MS) {
      setAwaySeconds(0);
      setStatus('camera_ready');
      return;
    }

    const elapsedSec = Math.floor(elapsedMs / 1000);
    setAwaySeconds(elapsedSec);
    setStatus(kind === 'away' ? 'away' : 'no_face');
    if (!violationEmittedRef.current) {
      violationEmittedRef.current = true;
      setViolationCount(c => c + 1);
      cbRef.current.onViolation?.(kind === 'away' ? 'face_away' : 'no_face');
    }
    if (elapsedSec >= AWAY_LIMIT_SEC && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      cbRef.current.onAutoSubmit?.();
    }
  }, []);

  /* ---- 3. Detection loop — recursive setTimeout prevents queued-up calls ---- */
  useEffect(() => {
    if (!enabled || !modelsLoaded || status === 'model_loading' || status === 'camera_starting' || status === 'permission_denied' || status === 'camera_unavailable' || status === 'model_load_failed') return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const runDetection = async () => {
      if (cancelled) return;

      const streamIsLive = streamRef.current?.getVideoTracks().some(track => track.readyState === 'live');
      if (!streamIsLive) {
        clearDetectionState('camera_unavailable');
      } else if (!isDetecting.current && !video.paused && !video.ended && video.readyState >= 2) {
        isDetecting.current = true;
        try {
          const detection = await faceapi
            .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: DETECTION_CONFIDENCE_THRESHOLD }))
            .withFaceLandmarks();

          if (!cancelled) {
            if (!detection || detection.detection.score < DETECTION_CONFIDENCE_THRESHOLD) {
              processDetection('no_face');
            } else {
              const { yaw, pitch } = estimateHeadPose(detection.landmarks);
              processDetection(Math.abs(yaw) <= YAW_THRESHOLD && Math.abs(pitch) <= PITCH_THRESHOLD ? 'valid' : 'away');
            }
          }
        } catch {
          if (!cancelled) clearDetectionState('inference_error');
        } finally {
          isDetecting.current = false;
        }
      }

      if (!cancelled) {
        timerRef.current = setTimeout(runDetection, DETECTION_INTERVAL_MS);
      }
    };

    runDetection();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, modelsLoaded, status, processDetection, clearDetectionState]);

  /* ---- 4. Camera-blocked ping — fire no_face violations so students cannot
            bypass proctoring by denying camera access mid-quiz ---- */
  /* ---- Cleanup on unmount ---- */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (validFaceTimerRef.current) clearTimeout(validFaceTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return { status, awaySeconds, violationCount, modelsLoaded, videoRef, retryCamera };
}

export default useFaceDetection;
