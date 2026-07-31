"""
Moonshine ASR (Automatic Speech Recognition) Server
====================================================

A FastAPI sidecar that loads Moonshine ONNX models once at startup and
exposes a /asr endpoint for transcribing audio files.

Why a separate Python server?
-----------------------------
The Next.js app is Node.js, but Moonshine runs on `onnxruntime` which is a
Python library. We can't load the model in Node. So we run this tiny
sidecar on a separate port (default 8001) and call it from Next.js.

Setup
-----
    pip install fastapi uvicorn python-multipart onnxruntime soundfile \
                fastrtc-moonshine-onnx librosa numpy

    # optional: pre-download weights so the first request is fast
    python -c "import moonshine_onnx; moonshine_onnx.MoonshineOnnxModel('moonshine/tiny', model_precision='quantized')"

Run
---
    python server.py
    # or: uvicorn server:app --host 0.0.0.0 --port 8001

Endpoints
---------
- GET  /health       → { status, model, precision, loaded }
- POST /asr          → multipart form (audio file) → { text, duration_sec, model }
- GET  /models       → list available model variants

Audio requirements
------------------
Any format librosa/ffmpeg can read: WAV, MP3, OGG, WebM/Opus, M4A, FLAC.
The server resamples to 16kHz mono internally. Max single-clip length is
64 seconds (Moonshine hard limit) — longer files are chunked with 2s
overlap and stitched together.

Environment variables
---------------------
- MOONSHINE_MODEL       — 'moonshine/tiny' (default) or 'moonshine/base'
- MOONSHINE_PRECISION   — 'float' (default) or 'quantized' (smaller, ~3% WER penalty)
- ASR_HOST              — default '0.0.0.0'
- ASR_PORT              — default '8001'
- OMP_NUM_THREADS       — recommended set to 2-4 to avoid CPU contention with Node
"""

import os
import sys
import logging
import tempfile
import time
from pathlib import Path
from typing import Optional

# Configure logging before anything else
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('asr-server')

# ─── Model lazy-loading ────────────────────────────────────────────────────
# We load the model on first /asr request, not at import time, so:
#   - `python server.py` starts fast even if weights aren't downloaded yet
#   - health checks work before the model is ready
#   - memory is only consumed when actually needed

_MODEL = None
_MODEL_NAME = os.environ.get('MOONSHINE_MODEL', 'moonshine/tiny')
_MODEL_PRECISION = os.environ.get('MOONSHINE_PRECISION', 'quantized')  # tiny+quantized = 28MB


def get_model():
    """Lazily load the Moonshine ONNX model. Cached for the lifetime of the process."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    try:
        # Import here so the server starts even if moonshine_onnx isn't installed
        # yet — /health will report not-loaded, /asr will return a clear error.
        from moonshine_onnx import MoonshineOnnxModel
    except ImportError as e:
        log.error(f'moonshine_onnx not installed: {e}')
        raise RuntimeError(
            'moonshine_onnx package not installed. Run: '
            'pip install onnxruntime soundfile fastrtc-moonshine-onnx librosa'
        )

    log.info(f'Loading Moonshine model: {_MODEL_NAME} ({_MODEL_PRECISION})...')
    log.info('  (first load downloads weights from Hugging Face — this can take a minute)')

    t0 = time.time()
    _MODEL = MoonshineOnnxModel(
        model_type=_MODEL_NAME,
        model_precision=_MODEL_PRECISION,
    )
    log.info(f'Model loaded in {time.time() - t0:.1f}s')
    return _MODEL


# ─── Audio handling ────────────────────────────────────────────────────────

def load_audio_16k_mono(audio_path: str):
    """
    Load any audio file as a 16kHz mono numpy array using librosa.
    Resamples and downmixes automatically. Requires ffmpeg for non-WAV formats.
    """
    import librosa
    import numpy as np

    # librosa.load handles resampling + mono downmix. sr=16000 is what Moonshine expects.
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    log.debug(f'Loaded {audio_path}: {len(audio)/sr:.2f}s @ {sr}Hz, dtype={audio.dtype}')
    return audio, sr


def transcribe_long(audio_path: str, model) -> tuple[str, float]:
    """
    Transcribe an audio file of arbitrary length.

    Moonshine's hard limit is 64 seconds per call. For longer files we:
      1. Split into 60-second chunks with 2-second overlap
      2. Transcribe each chunk
      3. Concatenate the transcripts

    Returns (transcript, duration_seconds).
    """
    import numpy as np

    audio, sr = load_audio_16k_mono(audio_path)
    duration = len(audio) / sr

    # Short file — single call
    if duration <= 60:
        text = model.transcribe(audio_path, _MODEL_NAME)
        return text.strip(), duration

    # Long file — chunked
    log.info(f'Long file ({duration:.1f}s) — chunking into 60s segments')
    chunk_samples = 60 * sr
    overlap_samples = 2 * sr
    chunks = []
    i = 0
    while i < len(audio):
        chunk = audio[i:i + chunk_samples]
        if len(chunk) < sr * 0.1:  # skip chunks < 0.1s
            break
        # Write chunk to a temp WAV file (Moonshine accepts file paths)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            import soundfile as sf
            sf.write(tmp.name, chunk, sr, format='WAV', subtype='PCM_16')
            try:
                chunk_text = model.transcribe(tmp.name, _MODEL_NAME)
                chunks.append(chunk_text.strip())
            except Exception as e:
                log.warning(f'Chunk {i//chunk_samples} failed: {e}')
                chunks.append('')
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        i += chunk_samples - overlap_samples

    return ' '.join(c for c in chunks if c), duration


# ─── FastAPI app ───────────────────────────────────────────────────────────

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title='Adoo ASR Server',
    description='Moonshine ONNX speech-to-text sidecar for the Adoo app',
    version='1.0.0',
)

# Allow the Next.js server (and dev tools) to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # We're behind a private network; auth happens at Next.js layer
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)


@app.get('/health')
async def health():
    """Report server + model status."""
    loaded = _MODEL is not None
    return {
        'status': 'ok',
        'model': _MODEL_NAME,
        'precision': _MODEL_PRECISION,
        'loaded': loaded,
        'version': '1.0.0',
    }


@app.get('/models')
async def models():
    """List available Moonshine model variants."""
    return {
        'current': {
            'model': _MODEL_NAME,
            'precision': _MODEL_PRECISION,
        },
        'available': [
            {'name': 'moonshine/tiny',  'precision': 'float',     'size_mb': 109, 'notes': 'Most accurate tiny'},
            {'name': 'moonshine/tiny',  'precision': 'quantized', 'size_mb': 28,  'notes': 'Fastest, smallest — recommended for CPU'},
            {'name': 'moonshine/base',  'precision': 'float',     'size_mb': 247, 'notes': 'Best accuracy, slower'},
            {'name': 'moonshine/base',  'precision': 'quantized', 'size_mb': 63,  'notes': 'Balanced accuracy/speed'},
        ],
    }


@app.post('/asr')
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default='en'),
):
    """
    Transcribe an audio file.

    Multipart form:
        audio:    the audio file (wav/mp3/ogg/webm/m4a/flac)
        language: optional language code (currently ignored — Moonshine v1 is English-only)

    Returns:
        { text: str, duration_sec: float, model: str, processing_ms: int }
    """
    t0 = time.time()

    # Read uploaded file to a temp file on disk — Moonshine needs a path
    suffix = Path(audio.filename or 'audio.wav').suffix or '.wav'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Validate file size (50MB max — anything bigger is suspicious)
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail='Audio file too large (max 50MB)')

        # Load the model (lazy on first call)
        try:
            model = get_model()
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))

        # Transcribe
        try:
            text, duration = transcribe_long(tmp_path, model)
        except Exception as e:
            log.exception(f'Transcription failed for {audio.filename}: {e}')
            raise HTTPException(status_code=500, detail=f'Transcription failed: {e}')

        processing_ms = int((time.time() - t0) * 1000)
        log.info(
            f'Transcribed {audio.filename} ({duration:.1f}s audio) '
            f'in {processing_ms}ms → "{text[:80]}..."'
        )

        return JSONResponse({
            'text': text,
            'duration_sec': round(duration, 2),
            'model': _MODEL_NAME,
            'precision': _MODEL_PRECISION,
            'language': language or 'en',
            'processing_ms': processing_ms,
        })

    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post('/preload')
async def preload():
    """Force model preloading. Useful for warming up the server after deploy."""
    if _MODEL is not None:
        return {'status': 'already_loaded', 'model': _MODEL_NAME}
    try:
        get_model()
        return {'status': 'loaded', 'model': _MODEL_NAME}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/')
async def root():
    return {
        'name': 'Adoo ASR Server',
        'docs': '/docs',
        'health': '/health',
        'endpoints': ['/health', '/asr', '/models', '/preload'],
    }


if __name__ == '__main__':
    import uvicorn

    host = os.environ.get('ASR_HOST', '0.0.0.0')
    port = int(os.environ.get('ASR_PORT', '8001'))

    log.info(f'━' * 60)
    log.info(f'  Adoo ASR Server — Moonshine ONNX')
    log.info(f'  Model:    {_MODEL_NAME} ({_MODEL_PRECISION})')
    log.info(f'  Listen:   http://{host}:{port}')
    log.info(f'  Docs:     http://{host}:{port}/docs')
    log.info(f'  OMP_NUM_THREADS = {os.environ.get("OMP_NUM_THREADS", "unset")}')
    log.info(f'━' * 60)
    log.info('  Model will load lazily on first /asr request.')
    log.info('  To preload: curl -X POST http://localhost:8001/preload')

    uvicorn.run(app, host=host, port=port, log_level='info')
