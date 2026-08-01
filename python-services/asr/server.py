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
#
# API compatibility: `fastrtc-moonshine-onnx` (the package the user installed)
# exposes a simple `moonshine_onnx.transcribe(audio, model_name)` function
# that handles model loading + caching internally. We DON'T instantiate
# `MoonshineOnnxModel` directly because its constructor kwargs differ
# across package versions (`model_type` vs `model` vs `model_name`).
#
# By using the function API, we get:
#   - Automatic model caching (loaded once, reused across requests)
#   - Forward compatibility with any `moonshine_onnx` package version
#   - Simpler error handling (no class instantiation to fail on)

_MODEL_READY = False  # set True after first successful transcribe() call
_MODEL_NAME = os.environ.get('MOONSHINE_MODEL', 'moonshine/tiny')
_MODEL_PRECISION = os.environ.get('MOONSHINE_PRECISION', 'quantized')  # tiny+quantized = 28MB


def _import_moonshine():
    """Import moonshine_onnx lazily, with a clear error message if missing."""
    try:
        import moonshine_onnx
        return moonshine_onnx
    except ImportError as e:
        log.error(f'moonshine_onnx not installed: {e}')
        raise RuntimeError(
            'moonshine_onnx package not installed. Run: '
            'pip install onnxruntime soundfile fastrtc-moonshine-onnx librosa'
        )


def _normalize_transcript(result):
    """
    Normalize the return value of moonshine_onnx.transcribe() to a string.

    The function's return type varies across package versions:
      - fastrtc-moonshine-onnx: returns List[str] (list of token strings)
        e.g. ['Hello', ' world', '!']
      - useful-moonshine-onnx:  returns str directly
      - some versions:           returns List[List[str]] (batched)

    We handle all cases: join lists with empty string (tokens already include
    spaces where needed), and strip whitespace from the final result.
    """
    if result is None:
        return ''
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, list):
        # Could be List[str] (tokens) or List[List[str]] (batched tokens)
        if result and isinstance(result[0], list):
            # Batched — flatten
            flat = []
            for batch in result:
                if isinstance(batch, list):
                    flat.extend(str(x) for x in batch)
                else:
                    flat.append(str(batch))
            return ''.join(flat).strip()
        # List[str] — join with empty string (Moonshine tokens include
        # leading spaces where needed, e.g. ' world' not 'world')
        return ''.join(str(x) for x in result).strip()
    # Fallback: stringify
    return str(result).strip()


def _do_transcribe(audio_input, moonshine_onnx_module) -> str:
    """
    Call moonshine_onnx.transcribe() with the right arguments for the
    installed package version, and normalize the result to a string.

    The function signature has shifted across releases:
      - fastrtc-moonshine-onnx:  transcribe(audio, model_name)
      - useful-moonshine-onnx:   transcribe(audio, model="moonshine/tiny", precision="quantized")
      - older versions:          transcribe(audio)  (uses default model)

    We try them in order, then normalize the (possibly list-typed) result.
    """
    raw = None

    # Try the fastrtc signature first (what the user has installed)
    try:
        raw = moonshine_onnx_module.transcribe(audio_input, _MODEL_NAME)
    except TypeError:
        raw = None
    except Exception:
        raise  # non-signature errors propagate

    if raw is None:
        # Try the useful-moonshine-onnx signature
        try:
            raw = moonshine_onnx_module.transcribe(
                audio_input,
                model=_MODEL_NAME,
                precision=_MODEL_PRECISION,
            )
        except TypeError:
            raw = None

    if raw is None:
        # Last resort: default model
        raw = moonshine_onnx_module.transcribe(audio_input)

    return _normalize_transcript(raw)


def get_model_status() -> bool:
    """Returns True if the model has been successfully loaded at least once."""
    return _MODEL_READY


def warm_up_model():
    """
    Force the model to load by running a tiny silent transcription.
    Used by /preload to warm up the server after deploy.
    """
    global _MODEL_READY
    if _MODEL_READY:
        return

    import numpy as np
    moonshine_onnx_module = _import_moonshine()

    # Generate 1 second of silence at 16kHz
    silence = np.zeros(16000, dtype=np.float32)

    log.info(f'Loading Moonshine model: {_MODEL_NAME} ({_MODEL_PRECISION})...')
    log.info('  (first load downloads weights from Hugging Face — this can take a minute)')

    t0 = time.time()
    _do_transcribe(silence, moonshine_onnx_module)
    _MODEL_READY = True
    log.info(f'Model loaded in {time.time() - t0:.1f}s')
    return True


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


def transcribe_long(audio_path: str, moonshine_onnx_module) -> tuple[str, float]:
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

    # Short file — single call (pass the file path; moonshine_onnx loads it)
    if duration <= 60:
        text = _do_transcribe(audio_path, moonshine_onnx_module)
        # _do_transcribe already normalizes + strips, but call strip() again
        # for safety in case the return type changes in a future version
        return (text or '').strip(), duration

    # Long file — chunked
    log.info(f'Long file ({duration:.1f}s) — chunking into 60s segments')
    chunk_samples = 60 * sr
    overlap_samples = 2 * sr
    chunks = []
    i = 0
    chunk_idx = 0
    while i < len(audio):
        chunk = audio[i:i + chunk_samples]
        if len(chunk) < sr * 0.1:  # skip chunks < 0.1s
            break
        # Write chunk to a temp WAV file (moonshine_onnx accepts file paths)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            import soundfile as sf
            sf.write(tmp.name, chunk, sr, format='WAV', subtype='PCM_16')
            try:
                chunk_text = _do_transcribe(tmp.name, moonshine_onnx_module)
                chunks.append((chunk_text or '').strip())
            except Exception as e:
                log.warning(f'Chunk {chunk_idx} failed: {e}')
                chunks.append('')
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        i += chunk_samples - overlap_samples
        chunk_idx += 1

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
    return {
        'status': 'ok',
        'model': _MODEL_NAME,
        'precision': _MODEL_PRECISION,
        'loaded': _MODEL_READY,
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
def transcribe(
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
        # Sync read — the endpoint is now `def` (not `async def`) so
        # FastAPI runs it in a threadpool, freeing the event loop.
        content = audio.file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Validate file size (50MB max — anything bigger is suspicious)
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail='Audio file too large (max 50MB)')

        # Load moonshine_onnx module (lazy on first call)
        try:
            moonshine_onnx_module = _import_moonshine()
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))

        # Transcribe
        try:
            text, duration = transcribe_long(tmp_path, moonshine_onnx_module)
            # Mark the model as loaded after a successful transcription
            global _MODEL_READY
            _MODEL_READY = True
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
    if _MODEL_READY:
        return {'status': 'already_loaded', 'model': _MODEL_NAME}
    try:
        warm_up_model()
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
