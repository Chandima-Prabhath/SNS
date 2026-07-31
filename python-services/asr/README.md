# Adoo ASR Server

Moonshine ONNX speech-to-text sidecar for the Adoo app.

## Why this exists

The main Adoo app is Node.js / Next.js, but Moonshine ASR runs on `onnxruntime` which is Python-only. This tiny FastAPI sidecar loads the Moonshine model once and exposes a `/asr` HTTP endpoint that the Next.js app calls.

## Setup

### 1. Install Python dependencies

```bash
cd python-services/asr
pip install -r requirements.txt
```

### 2. Install ffmpeg (required for non-WAV audio)

```bash
# Ubuntu / Debian / Linux Mint
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

### 3. Run the server

```bash
python server.py
# or:
uvicorn server:app --host 0.0.0.0 --port 8001
```

On first request, the server downloads Moonshine weights from Hugging Face (~28MB for `tiny+quantized`). To pre-download:

```bash
python -c "from moonshine_onnx import MoonshineOnnxModel; MoonshineOnnxModel('moonshine/tiny', model_precision='quantized')"
```

Or warm up the running server:

```bash
curl -X POST http://localhost:8001/preload
```

## Configuration

Environment variables (all optional):

| Var | Default | Description |
|-----|---------|-------------|
| `MOONSHINE_MODEL` | `moonshine/tiny` | Model variant (`moonshine/tiny` or `moonshine/base`) |
| `MOONSHINE_PRECISION` | `quantized` | `float` (more accurate, 4× larger) or `quantized` (smaller, ~3% WER penalty) |
| `ASR_HOST` | `0.0.0.0` | Bind host |
| `ASR_PORT` | `8001` | Bind port |
| `OMP_NUM_THREADS` | unset | Recommended `2-4` to avoid CPU contention with the Node.js server |

### Recommended config for a CPU laptop

```bash
export MOONSHINE_MODEL=moonshine/tiny
export MOONSHINE_PRECISION=quantized
export OMP_NUM_THREADS=2
python server.py
```

This uses ~28MB of model weights and runs in real-time or faster on a modern CPU.

## API

### `GET /health`

```json
{ "status": "ok", "model": "moonshine/tiny", "precision": "quantized", "loaded": true, "version": "1.0.0" }
```

### `POST /asr`

Multipart form:
- `audio` (file): WAV / MP3 / OGG / WebM/Opus / M4A / FLAC
- `language` (string, optional, default `en`): Currently ignored — Moonshine v1 is English-only

Response:
```json
{
  "text": "hello world",
  "duration_sec": 3.42,
  "model": "moonshine/tiny",
  "precision": "quantized",
  "language": "en",
  "processing_ms": 412
}
```

### `GET /models`

Lists available model variants with size estimates.

### `POST /preload`

Force model preloading. Useful after a deploy to warm up before the first user request.

## Long audio handling

Moonshine's hard limit is 64 seconds per call. For longer files, the server:
1. Loads the file at 16kHz mono via librosa
2. Splits into 60s chunks with 2s overlap
3. Transcribes each chunk separately
4. Concatenates transcripts with spaces

This is a simple approach — for production-quality long-form transcription, consider implementing VAD (voice activity detection) to split on natural pauses.

## Integration with Adoo

The Next.js app calls this server via the `ASR_URL` environment variable (default `http://localhost:8001`). Configure it in `.env`:

```bash
ASR_URL=http://localhost:8001
```

The integration has three layers:
1. **Bot builder node** (`asr_transcribe`) — drag into any visual bot flow to transcribe the incoming voice message URL into a variable
2. **Auto-transcription** — every voice message uploaded to a channel is auto-transcribed in the background; users see a "Show transcript" button
3. **Manual /api/asr route** — proxy endpoint for client-triggered transcription

## Troubleshooting

**`moonshine_onnx package not installed`** — Run `pip install -r requirements.txt` again. The `fastrtc-moonshine-onnx` package imports as `moonshine_onnx` (no `fastrtc_` prefix).

**First request is slow** — Weights download from Hugging Face on first use. Pre-download with the `curl -X POST /preload` command above.

**`librosa.load` fails on MP3/WebM** — ffmpeg isn't installed. Install it system-wide (see Setup step 2).

**Out of memory** — Switch from `float` to `quantized` precision, or from `base` to `tiny`.

**CPU contention with Node.js** — Set `OMP_NUM_THREADS=2` so onnxruntime doesn't try to use all cores.
