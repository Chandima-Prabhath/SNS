# Moonshine ASR — Technical Integration Brief

> A research brief for integrating Moonshine speech-to-text via the `fastrtc-moonshine-onnx` Python package.
> Compiled from the official model card, the v1/v2 papers, the extracted wheel source, PyPI metadata, Hugging Face Hub file listings, and third‑party benchmarks (Picovoice, Northflank).
> All sources are cited inline with URLs.

---

## TL;DR (read this first)

- **Moonshine** is an English-first ASR model family from **Useful Sensors** (rebranded **Moonshine AI**, moonshine.ai — founded by Pete Warden, ex-TensorFlow lead at Google). **MIT-licensed.** ([HF model card](https://huggingface.co/UsefulSensors/moonshine), [GitHub](https://github.com/moonshine-ai/moonshine))
- There are **two generations**. The package the user installed (`fastrtc-moonshine-onnx`) is the **v1** (Oct 2024) ONNX runtime — it only exposes `tiny` (27M params) and `base` (61M params), English-only, full-segment transcription. The newer **v2 "Moonshine Voice"** (streaming, multilingual, TTS, intent recognition) uses a *different* package (`moonshine-voice`) and a *different* C++ core — **it is not what `fastrtc-moonshine-onnx` ships.** ([arXiv v1](https://arxiv.org/abs/2410.15608), [arXiv v2](https://arxiv.org/abs/2602.12241))
- `fastrtc-moonshine-onnx` is a **fork of `moonshine_onnx`**, published by Useful Sensors, that the [FastRTC](https://fastrtc.org) library (Gradio/Hugging Face team) depends on as its default STT backend. It is pinned to the Oct 2024 v1 code. ([PyPI](https://pypi.org/project/fastrtc-moonshine-onnx), [fastrtc PyPI deps](https://pypi.org/project/fastrtc/))
- The Python API is trivial: `import moonshine_onnx; moonshine_onnx.transcribe("file.wav", "moonshine/tiny")`. Weights (~109 MB tiny / ~247 MB base in float32, or ~28 MB / ~63 MB quantized) are **downloaded from `UsefulSensors/moonshine` on Hugging Face on first use** — not bundled. ([extracted wheel source](#4-python-packages--api))
- Audio must end up as **16 kHz mono float32**, shape `[1, N]`. `librosa.load(..., sr=16000)` (called internally) handles resampling and channel downmix for you. Segments must be **0.1 s – 64 s**; chunk longer audio yourself. ([source: `moonshine_onnx/transcribe.py`](#6-audio-format-requirements))
- **No streaming, no batching, English only, no translation** in the v1 ONNX package. For streaming you'd need to move to `moonshine-voice` (v2).
- For a CPU-only Mint laptop doing short-clip transcription, **Moonshine Tiny is an excellent fit**: ~5× less compute than Whisper tiny.en on a 10 s segment at comparable WER, no 30 s zero-padding tax, pure-Python ONNX runtime, ~28 MB quantized footprint.

---

## 1. What is Moonshine?

| | |
|---|---|
| **Maker** | Useful Sensors Inc. → rebranded **Moonshine AI** ([moonshine.ai](https://moonshine.ai)). Founded by Pete Warden (former Google TensorFlow lead), Nat Jeffries, et al. The HF org is still `UsefulSensors` for historical reasons. ([HF model card](https://huggingface.co/UsefulSensors/moonshine)) |
| **First release** | 21 October 2024 (v1 paper, arXiv:2410.15608). v2 "Moonshine Voice" launched ~Feb 2026 ([announcement blog](https://huggingface.co/blog/UsefulSensors/announcing-moonshine-voice)). |
| **Task** | Automatic Speech Recognition (English-first; v2 adds 7 more languages, TTS, intent recognition, diarization). |
| **License** | **MIT** — weights, code, and tokenizer. ([HF card](https://huggingface.co/UsefulSensors/moonshine), [PyPI metadata](https://pypi.org/project/fastrtc-moonshine-onnx)) |
| **Architecture** | Encoder–decoder Transformer. **RoPE** position embeddings (not absolute sinusoidal like Whisper). Learned conv front-end (strides 64/3/2, ~384× downsample) instead of a hand-engineered mel spectrogram. **Variable-length input** — no 30 s zero-padding. SwiGLU FFN in decoder, GELU in encoder. Byte-level BPE tokenizer reused from Llama 1/2. ([v1 paper §3.1](https://arxiv.org/abs/2410.15608)) |
| **Training data** | ~200 K hours: 90 K from open datasets (Common Voice 16.1, AMI, GigaSpeech, LibriSpeech, MLS, People's Speech) + 100 K+ internally-collected web audio, pseudo-labelled with Whisper large-v3 and filtered. ([v1 paper §3.2](https://arxiv.org/abs/2410.15608)) |
| **Key selling points** | (1) Variable-length encoder → no zero-pad waste → ~5× less compute than Whisper tiny.en on a 10 s clip at equal WER. (2) Small enough for edge/RPi/microcontroller. (3) Real-time-latency optimised. (4) MIT, runs fully offline, no API keys. (5) v2 adds streaming with KV-cache reuse so most encoder work happens *while the user is still talking*. ([GitHub README](https://github.com/moonshine-ai/moonshine)) |

The name is a pun — they initially tried to *distill* Whisper, then trained from scratch, but "moonshine" stuck. ([v1 paper footnote 1](https://arxiv.org/abs/2410.15608))

---

## 2. Model variants

### 2.1 v1 models (what `fastrtc-moonshine-onnx` uses)

From the v1 paper Table 1 and the HF model card:

| Variant | Parameters | Encoder layers | Decoder layers | Dim | Heads | FLOPs (norm. to Whisper tiny) |
|---|---|---|---|---|---|---|
| **Moonshine Tiny** | **27.1 M** | 6 | 6 | 288 | 8 | 0.7× |
| **Moonshine Base** | **61.5 M** | 8 | 8 | 416 | 8 | 1.6× |
| Whisper tiny.en (ref) | 37.8 M | 4 | 4 | 384 | 6 | 1.0× |
| Whisper base.en (ref) | 72.6 M | 6 | 6 | 512 | — | 2.3× |

**WER (OpenASR Leaderboard avg over 8 datasets, greedy decoding)** — v1 paper Tables 2 & 3:

| Dataset | Moonshine Tiny | Whisper tiny.en | Moonshine Base | Whisper base.en |
|---|---|---|---|---|
| AMI | 22.77 | 24.24 | 17.79 | 21.13 |
| Earnings22 | 21.25 | 19.12 | 17.65 | 15.09 |
| GigaSpeech | 14.41 | 14.08 | 12.19 | 12.83 |
| LibriSpeech clean | **4.52** | 5.66 | **3.23** | 4.25 |
| LibriSpeech other | 11.71 | 15.45 | 8.18 | 10.35 |
| SPGISpeech | 7.70 | 5.93 | 5.46 | 4.26 |
| TED-Lium | 5.64 | 5.97 | 5.22 | 4.87 |
| VoxPopuli | 13.27 | 12.00 | 10.81 | 9.76 |
| **Average** | **12.66** | **12.81** | **10.07** | **10.32** |

Takeaways: Moonshine Tiny/Base **edge out** their Whisper counterparts on average, with notably better LibriSpeech numbers, but **lose on Earnings22** (very short utterances < 1 s cause repetition loops) and on SPGISpeech/VoxPopuli for Base. ([v1 paper §4](https://arxiv.org/abs/2410.15608))

### 2.2 v2 models (NOT in `fastrtc-moonshine-onnx` — requires `moonshine-voice`)

From the current [GitHub README](https://github.com/moonshine-ai/moonshine) "Available Models" table:

| Language | Architecture | Params | WER/CER |
|---|---|---|---|
| English | Tiny | 26 M | 12.66% |
| English | Tiny Streaming | 34 M | 12.00% |
| English | Base | 58 M | 10.07% |
| English | Small Streaming | 123 M | 7.84% |
| English | Medium Streaming | 245 M | 6.65% |
| Arabic / Japanese / Mandarin / Spanish / Ukrainian / Vietnamese / Korean | Base or Tiny | 26–58 M | 4.33–25.76% |

Note the "Tiny" and "Base" rows in v2 are the **same v1 checkpoints** carried forward; "… Streaming" rows are the new ergodic-streaming architecture from the [v2 paper (arXiv:2602.12241)](https://arxiv.org/abs/2602.12241). The v2 streaming models beat Whisper Large v3 (7.44% WER) with Medium Streaming at 6.65% using 245 M vs 1.5 B params.

### 2.3 ONNX file sizes (live Hugging Face Hub listing)

Queried the HF API at `huggingface.co/api/models/UsefulSensors/moonshine/tree/main/onnx/merged/...`:

| Variant | Precision | `encoder_model.onnx` | `decoder_model_merged.onnx` | **Total** |
|---|---|---|---|---|
| **tiny** | float32 (default in fastrtc pkg) | 30.9 MB | 78.2 MB | **~109 MB** |
| tiny | quantized (8-bit) | 7.9 MB | 20.2 MB | **~28 MB** |
| tiny | quantized_4bit | 13.0 MB | 20.2 MB | ~33 MB |
| **base** | float32 (default in fastrtc pkg) | 80.8 MB | 166.2 MB | **~247 MB** |
| base | quantized (8-bit) | 20.5 MB | 42.5 MB | **~63 MB** |
| base | quantized_4bit | 31.0 MB | 42.4 MB | ~73 MB |

The [dev.moonshine.ai Python SDK page](https://dev.moonshine.ai/py) states: *"We quantize the ONNX models, so they offer the smallest file sizes (26 MB for tiny, 57 MB for base)"* — consistent with the 8-bit numbers above (the page rounds and excludes the tokenizer).

### 2.4 Relative speed (v1)

From the v1 paper abstract and §4: **"5× reduction in compute requirements for transcribing a 10-second speech segment"** vs Whisper tiny.en, with **"no increase in word error rates."** §5 concludes **"up to 3× reductions in latency scaled to the duration of input audio"** on GPU. The speed-up grows for shorter clips because Whisper's 30 s encoder cost is fixed while Moonshine's scales with input length.

---

## 3. Performance on CPU

### 3.1 What the v1 paper measures

The paper benchmarks on **H100 GPU** (not CPU), measuring GFLOPS and latency vs clip duration. The headline **5× compute reduction** is a GFLOPS measurement, not wall-clock. The paper does not publish a CPU RTF table. ([v1 paper §4, Fig 5](https://arxiv.org/abs/2410.15608))

### 3.2 Official v2 streaming benchmarks (Linux x86 CPU)

From the current [GitHub README](https://github.com/moonshine-ai/moonshine) "When should you choose Moonshine over Whisper?" table — these are **end-of-phrase latency** (time from VAD detecting phrase-end to final transcript), CPU, `faster-whisper` for Whisper:

| Model | WER | Params | MacBook Pro | **Linux x86** | Raspberry Pi 5 |
|---|---|---|---|---|---|
| Moonshine Medium Streaming | 6.65% | 245 M | 107 ms | 269 ms | 802 ms |
| Whisper Large v3 | 7.44% | 1.5 B | 11 286 ms | 16 919 ms | N/A |
| Moonshine Small Streaming | 7.84% | 123 M | 73 ms | 165 ms | 527 ms |
| Whisper Small | 8.59% | 244 M | 1 940 ms | 3 425 ms | 10 397 ms |
| Moonshine Tiny Streaming | 12.00% | 34 M | 34 ms | 69 ms | 237 ms |
| Whisper Tiny | 12.81% | 39 M | 277 ms | 1 141 ms | 5 863 ms |

Caveats: (a) these are the **v2 streaming** models, not the v1 `tiny`/`base` the user has — the v1 models do *not* do streaming KV-cache reuse, so their phrase-end latency is higher; (b) the benchmark measures the streaming advantage (work done during speech), which favours Moonshine; (c) the metric is *phrase-end-to-transcript*, not full-clip RTF.

### 3.3 Independent benchmark — Picovoice STT benchmark

[Picovoice/speech-to-text-benchmark](https://github.com/Picovoice/speech-to-text-benchmark) (Picovoice is a commercial competitor, so treat with appropriate scepticism, but their methodology is public and reproducible). Hardware: **AMD Ryzen 9 5900X (12 cores) @ 3.70 GHz**, 64 GB RAM, Ubuntu 22.04, 10 cores, processing the entire LibriSpeech `test-clean` set.

**Core-hours per dataset (batch, full 30 s clips) + model size:**

| Engine | Core-Hour | Model Size |
|---|---|---|
| Whisper Tiny | 0.16 | 73 MB |
| Whisper Base | 0.32 | 139 MB |
| Whisper Small | 0.99 | 462 MB |
| Whisper.cpp Streaming Tiny | 0.77 | 73 MB |
| Whisper.cpp Streaming Base | 1.67 | 139 MB |
| Vosk Small | 0.12 | 68 MB |
| **Moonshine Streaming Tiny** | **1.03** | **49 MB** |
| Moonshine Streaming Small | 2.22 | 158 MB |
| Moonshine Streaming Medium | 3.36 | 290 MB |
| Picovoice Leopard | 0.026 | 37 MB |

**Streaming word-emission latency** (100 random LibriSpeech clean files):

| Engine | Latency |
|---|---|
| Moonshine Tiny | 780 ms |
| Moonshine Small | 650 ms |
| Moonshine Medium | 640 ms |
| Whisper.cpp Streaming Tiny | 1 240 ms |
| Whisper.cpp Streaming Base | 1 240 ms |
| Vosk Small | 920 ms |
| Picovoice Cheetah | 590 ms |

**Reading these numbers correctly:**
- In **batch/offline mode on full 30 s clips**, Whisper Tiny is *faster* than Moonshine Streaming Tiny (0.16 vs 1.03 core-hr). This is expected: Whisper's fixed 30 s window is efficient when you actually have 30 s of audio, and `faster-whisper` (CTranslate2) is heavily optimised. Moonshine's advantage disappears when there's no short-clip/zero-pad penalty to recover.
- In **streaming mode**, Moonshine Tiny emits words at 780 ms vs Whisper.cpp Streaming Tiny at 1 240 ms — a ~37 % latency win.
- The official Moonshine benchmarks (69 ms on Linux x86 for Tiny Streaming) measure a *different* thing: time from VAD phrase-end to final transcript, exploiting the streaming cache. Picovoice measures *word-emission* latency. Both are "right" — they answer different questions.

### 3.4 Is it faster than whisper.cpp / distil-whisper?

| Question | Answer |
|---|---|
| Faster than `whisper.cpp` (CPU, **streaming/short-clip**)? | **Yes** — Moonshine Tiny 780 ms vs Whisper.cpp Streaming Tiny 1 240 ms word-emission (Picovoice); 69 ms vs 1 141 ms phrase-end on Linux x86 (official). |
| Faster than `whisper.cpp` (CPU, **batch, 30 s clips**)? | **No** — Whisper Tiny 0.16 core-hr vs Moonshine Streaming Tiny 1.03 core-hr (Picovoice). `whisper.cpp` is aggressively optimised (AVX2/AVX-512/ARM NEON) and wins on full-length clips. |
| Faster than `distil-whisper`? | Not directly benchmarked head-to-head. Distil-Whisper Large v3 is ~5–6× faster than Whisper Large v3 ([Northflank](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)) but targets a different size class (756 M params, ~5 GB VRAM). For *tiny*-class CPU work, Moonshine Tiny (27 M, ~28 MB quantized) is in a different footprint tier. |
| The user's "fast on CPU on a Mint laptop"? | Consistent with expectations. Moonshine Tiny float32 on a modern x86 laptop transcribes a 5–10 s clip in tens to low-hundreds of ms. No GPU/NPU needed. |

### 3.5 Memory footprint (runtime)

- Weights loaded into ONNX Runtime: ~109 MB (tiny float) / ~28 MB (tiny quantized) / ~247 MB (base float) / ~63 MB (base quantized).
- ONNX Runtime CPU arena allocator adds ~100–300 MB working set depending on sequence length.
- `librosa`/`numpy`/`tokenizers` Python overhead: ~50–80 MB.
- **Realistic RSS for a long-running tiny-float process: ~300–450 MB.** With tiny-quantized: ~200–300 MB. With base-float: ~500–700 MB.

---

## 4. Python packages — `fastrtc-moonshine-onnx`

### 4.1 What it is and where it lives

| | |
|---|---|
| **PyPI** | https://pypi.org/project/fastrtc-moonshine-onnx |
| **Version** | `20241016` (single release, 20 Feb 2025; version string = 16 Oct 2024, the v1 code date) |
| **Wheel size** | 729 KB (pure Python; weights are NOT bundled) |
| **License** | MIT |
| **Author** | Useful Sensors |
| **Home page** | https://github.com/usefulsensors/moonshine |
| **Python** | >=3.8 |
| **Dependencies** | `tokenizers>=0.19.0`, `onnxruntime`, `huggingface_hub`, `librosa` |
| **Top-level import** | `moonshine_onnx` (NOT `fastrtc_moonshine_onnx`) |

The package description literally says: *"Fork of moonshine_onnx on pypi. Speech recognition for live transcription and voice commands with the Moonshine ONNX models."* ([PyPI metadata](https://pypi.org/project/fastrtc-moonshine-onnx))

### 4.2 Relationship to FastRTC

[FastRTC](https://fastrtc.org) ("The Real-Time Communication Library for Python", by the Gradio/Hugging Face team — [github.com/gradio-app/fastrtc](https://github.com/gradio-app/fastrtc)) uses Moonshine as its default STT. From the `fastrtc` PyPI metadata, the `stt` and `stopword` extras both pull in `fastrtc-moonshine-onnx`:

```
fastrtc-moonshine-onnx; extra == "stt"
onnxruntime>=1.20.1; extra == "stt"
fastrtc-moonshine-onnx; extra == "stopword"
```

And from the [FastRTC launch blog on HF](https://huggingface.co/blog/fastrtc): *"The `get_stt_model()` will fetch Moonshine Base and `get_tts_model()` will fetch Kokoro from the Hub, both of which have been further optimized for on-device CPU inference."*

**So `fastrtc-moonshine-onnx` exists because fastrtc needed a stable, pure-Python, ONNX-based Moonshine package on PyPI at a moment when the upstream `moonshine-onnx` wasn't published/maintained there.** It is a verbatim fork — the code is byte-identical to the v1 `moonshine_onnx` from Useful Sensors.

### 4.3 The official alternative

Useful Sensors now publishes the official package directly on PyPI as **[`useful-moonshine-onnx`](https://pypi.org/project/useful-moonshine-onnx/)** (current version `20251121`, adds `numba>=0.61.2` as a dependency). Same import name (`moonshine_onnx`), same API, slightly newer. If you're starting fresh and don't need fastrtc interop, prefer `useful-moonshine-onnx`. The [dev.moonshine.ai Python SDK page](https://dev.moonshine.ai/py) documents this as the canonical install.

### 4.4 Exact Python API (verified from the extracted wheel source)

The wheel contains four Python files. Here is the complete public API:

**`moonshine_onnx/__init__.py`**
```python
from .model import MoonshineOnnxModel
from .transcribe import transcribe, benchmark, load_tokenizer, load_audio
ASSETS_DIR = Path(__file__).parent / "assets"   # contains beckett.wav + tokenizer.json
__version__ = "20241016"
```

**`moonshine_onnx/transcribe.py`** (the functions you call)
```python
def load_audio(audio):
    # audio = path/str OR numpy array
    # if path: librosa.load(audio, sr=16_000)  -> resamples + mono-downmixes
    # returns shape [1, num_samples] float32
    ...

def assert_audio_size(audio):
    # enforces 0.1s < duration < 64s  (raises AssertionError otherwise)
    ...

def transcribe(audio, model="moonshine/base"):
    # audio  : path | np.ndarray
    # model  : "moonshine/tiny" | "moonshine/base"  (or a MoonshineOnnxModel instance)
    # returns: list[str]  (len 1, batch size is always 1)
    ...

def load_tokenizer():
    # loads the bundled assets/tokenizer.json via HuggingFace `tokenizers`
    ...

def benchmark(audio, model="moonshine/base"):
    # warms up 4x, then times 8 runs, prints "Time to transcribe Xs of speech is Yms"
    ...
```

**`moonshine_onnx/model.py`** (the low-level class)
```python
class MoonshineOnnxModel:
    def __init__(self, models_dir=None, model_name=None, model_precision="float"):
        # If models_dir is None: downloads from HF hub
        #   repo = "UsefulSensors/moonshine"
        #   subfolder = f"onnx/merged/{model_name}/{model_precision}"
        #   files = encoder_model.onnx, decoder_model_merged.onnx
        # model_name must be "tiny" or "base"  (raises ValueError otherwise)
        # model_precision ∈ {"float", "quantized", "quantized_4bit"}
        # Creates two onnxruntime.InferenceSession instances (encoder + decoder)
        ...

    def generate(self, audio, max_len=None):
        # audio: np.ndarray shape [1, N] float32 @ 16kHz
        # max_len defaults to 6 tokens/sec of audio  (anti-repetition heuristic)
        # Runs encoder once, then autoregressive decoder loop with KV-cache
        # returns list[list[int]]  (tokens, batch=1)
        ...
```

### 4.5 Minimal usage examples

**Transcribe a WAV file (the 3-line version):**
```python
import moonshine_onnx

text = moonshine_onnx.transcribe("interview.wav", "moonshine/tiny")
print(text)   # -> ['Ever tried ever failed, no matter try again, fail again, fail better.']
```

**Use a pre-loaded model (avoid re-loading per call):**
```python
import moonshine_onnx

model = moonshine_onnx.MoonshineOnnxModel(model_name="tiny")  # downloads once
for wav_path in paths:
    text = moonshine_onnx.transcribe(wav_path, model)   # reuse model
```

**Transcribe a numpy array (you did your own resampling):**
```python
import moonshine_onnx, librosa, numpy as np

audio, _ = librosa.load("clip.mp3", sr=16_000, mono=True)   # any format librosa reads
text = moonshine_onnx.transcribe(audio, "moonshine/tiny")
```

**Use the 8-bit quantized weights (28 MB instead of 109 MB):**
```python
import moonshine_onnx
model = moonshine_onnx.MoonshineOnnxModel(model_name="tiny", model_precision="quantized")
text = moonshine_onnx.transcribe("clip.wav", model)
```

**Transcribe a long file (chunk it yourself):**
```python
import moonshine_onnx, librosa, numpy as np

audio, _ = librosa.load("long.wav", sr=16_000, mono=True)
CHUNK = 16_000 * 30   # 30 s, well under the 64 s hard limit
results = []
for i in range(0, len(audio), CHUNK):
    seg = audio[i:i+CHUNK]
    if len(seg) < 16_000 * 0.1:   # skip <0.1s tail
        break
    results.append(moonshine_onnx.transcribe(seg, "moonshine/tiny")[0])
text = " ".join(results)
```

### 4.6 What it does NOT support (important)

| Feature | Supported? | Notes |
|---|---|---|
| **Streaming / chunked incremental** | ❌ No | v1 only. Each `transcribe()` call is independent; there is no state carried between calls. The decoder does use a KV-cache *within* a single call, but not across calls. |
| **Batching (B > 1)** | ❌ No | `generate()` hard-codes batch=1. The encoder/decoder ONNX sessions accept `[1, ...]`. To batch you'd need to re-export the models with dynamic batch axis. |
| **Multilingual / translation** | ❌ No | v1 tiny/base are English-only. |
| **Word timestamps** | ❌ No | Only full-transcript text is returned. |
| **VAD / speaker diarisation** | ❌ No | v1 has none of the v2 voice-toolkit features. |
| **GPU** | ⚠️ Indirect | `onnxruntime` will use a GPU EP (CUDA/TensorRT/CoreML) if installed and available, but the package was designed for CPU. No GPU-specific code in the wrapper. |
| **Pinning which ONNX EP to use** | ❌ No | `InferenceSession(encoder)` is called with no `providers=` arg, so you get ONNX Runtime's default (CPU). To force CUDA/CoreML you'd have to monkey-patch or vendor the source. |

---

## 5. ONNX model files — where they live

### 5.1 Location

The weights are **not bundled** in the wheel (the wheel is only 729 KB — it ships just `beckett.wav` + `tokenizer.json` + Python). They are downloaded on first use from the Hugging Face Hub:

- **Repo:** [`UsefulSensors/moonshine`](https://huggingface.co/UsefulSensors/moonshine)
- **Subfolder:** `onnx/merged/{tiny|base}/{float|quantized|quantized_4bit}/`
- **Files per variant:**
  - `encoder_model.onnx`
  - `decoder_model_merged.onnx` (merged = the decoder + KV-cache `past_key_values` inputs in one graph, so the cache is external to the model file)
  - (base only, quantized variant) also `tokenizer.bin`

### 5.2 Download mechanism

`model.py` calls `huggingface_hub.hf_hub_download(repo, filename, subfolder=...)`. This:
1. Checks the local HF cache (`~/.cache/huggingface/hub/` by default, or whatever `HF_HOME` points at).
2. If absent, fetches from `https://huggingface.co/UsefulSensors/moonshine/resolve/main/onnx/merged/...` (LFS-backed).
3. Returns a local path; `onnxruntime.InferenceSession(path)` loads it.

### 5.3 Do we need to download at server startup?

**Yes, unless you pre-warm.** First call to `MoonshineOnnxModel(model_name="tiny")` will hit the network and pull ~109 MB (float) or ~28 MB (quantized). After that it's cached forever. For a production deployment you should either:

- **Bake the cache into the Docker image:** run `huggingface-cli download UsefulSensors/moonshine ...` at build time, or
- **Set `HF_HOME=/app/hf-cache`** and pre-download on boot before accepting traffic, or
- **Pass `models_dir=`** to `MoonshineOnnxModel` pointing at a directory where you've placed `encoder_model.onnx` + `decoder_model_merged.onnx` yourself (this skips the Hub entirely — see `_load_weights_from_hf_hub` vs the `models_dir` branch in `__init__`).

### 5.4 Alternative ONNX sources

- [`onnx-community/moonshine-base-ONNX`](https://huggingface.co/onnx-community/moonshine-base-ONNX) and `moonshine-tiny-ONNX` — community-maintained ONNX exports (also float + quantized), usable with `transformers.js` in the browser. Different file layout than the official `UsefulSensors/moonshine` repo.
- For v2 (streaming, `.ort` format): `download.moonshine.ai/model/...`, fetched by the `moonshine-voice` CLI's `download` subcommand. Not interchangeable with the v1 `.onnx` files.

---

## 6. Audio format requirements

### 6.1 What the model expects

- **Sample rate:** 16 000 Hz (hard-coded — `16000` appears in `transcribe.py` and `model.py`).
- **Channels:** mono. Stereo must be downmixed.
- **Dtype:** float32, values roughly in `[-1, 1]`.
- **Shape:** `[1, num_samples]` (batch dim of 1 is added by `load_audio`).
- **Length:** strictly **> 0.1 s and < 64 s** per `transcribe()` call (`assert_audio_size` raises `AssertionError` otherwise). For audio outside this range, pre-segment.

### 6.2 What the package accepts at the front door

`load_audio(audio)`:
- If `audio` is a **str/Path**: calls `librosa.load(audio, sr=16_000)`. `librosa` (via `soundfile`/`audioread`/`ffmpeg`) handles **WAV, FLAC, OGG, MP3, M4A, Opus (via ffmpeg), and WebM (via ffmpeg)**, performs **resampling** to 16 kHz, and **downmixes to mono** automatically.
- If `audio` is a **numpy array**: it is used as-is (you are responsible for it being 16 kHz mono float32). Only a batch dim is prepended.

So: **if you pass a file path, the package handles resampling and channel conversion for you.** You do not need `librosa` yourself unless you're pre-chunking long audio (which you should do with `librosa.load` once, then slice the array).

### 6.3 Practical gotchas

- **WebM/Opus from a browser `<audio>` recorder:** works, but only if `ffmpeg` is installed system-side (librosa falls back to `audioread` → `ffmpeg`). On a Mint laptop `apt install ffmpeg` is usually enough.
- **48 kHz WAV** (common from media recorders): `librosa.load(..., sr=16000)` resamples via `soxr`/`resampy` — fine, ~ms-level cost.
- **Stereo WAV:** `librosa` downmixes to mono by averaging. If your channels are very different (e.g. two speakers L/R), you lose separation — but Moonshine v1 has no diarisation anyway.
- **Very short clips (< 0.1 s):** rejected. Pad with silence or merge with adjacent audio.
- **Very long clips (> 64 s):** rejected. Chunk into ≤ 30 s pieces (30 s gives a good accuracy/speed balance; the v1 paper trained on 4–30 s segments, and WER rises for clips > 30 s due to "hallucination" on out-of-distribution lengths — see v1 paper §4.1).

---

## 7. Language support

### 7.1 v1 (`fastrtc-moonshine-onnx`)

- **English only.** The tokenizer is the Llama byte-level BPE (32 000 tokens + 768 special), trained on English text. ([v1 paper §3.1](https://arxiv.org/abs/2410.15608))
- **No translation.** Moonshine does ASR, not AST. There is no "translate to English" mode like Whisper's.
- Passing non-English audio will produce garbage/transliterated English at best.

### 7.2 v2 (`moonshine-voice`)

Separate **mono-lingual** models per language (the [Flavors of Moonshine paper, arXiv:2509.02523](https://arxiv.org/abs/2509.02523) argues this beats one multilingual model at equal size):

- STT: English, Spanish, Mandarin, Japanese, Korean, Vietnamese, Ukrainian, Arabic.
- TTS (new in v2): English, Spanish, Arabic, German, French, Hindi, Italian, Japanese, Korean, Dutch, Portuguese, Russian, Turkish, Ukrainian, Vietnamese, Mandarin.

Each language is a **separate model download** (`moonshine-voice download --stt --language es` etc.), not one model that switches languages.

---

## 8. Streaming support

### 8.1 In `fastrtc-moonshine-onnx` (v1)

**None.** The package transcribes one complete segment per call. There is:

- no incremental `add_audio_chunk()` API,
- no state carried between `transcribe()` calls,
- no partial-result callback.

The decoder *does* use a KV-cache **within** a single `generate()` call (the `past_key_values` dict in `model.py`), which is why per-call inference is fast — but you cannot stream audio into it.

### 8.2 Workaround for "pseudo-streaming" with v1

If you need live transcription with v1, the standard pattern is:

1. Run a cheap VAD (e.g. `silero-vad`, or WebRTC VAD) on the incoming audio stream.
2. Buffer audio until VAD detects an end-of-phrase (silence ≥ ~300–500 ms).
3. Call `moonshine_onnx.transcribe(buffer, model)` on the complete phrase.
4. Emit the text, reset the buffer.

This gives you phrase-level latency (hundreds of ms to low seconds depending on phrase length) but **not** word-by-word streaming. For a Mint-laptop voice-notes or meeting-transcription backend, this is usually fine.

### 8.3 Real streaming — move to v2

If you need true word-by-word streaming (latency < 200 ms, partial transcripts updated while the user is still talking), you must switch to **`moonshine-voice`** (v2). Its `Transcriber` class:

- accepts audio chunks via `Stream.add_audio_chunk()` / `MicTranscriber`,
- caches encoder state and partial decoder state across chunks,
- fires `TranscriptEvent`s (`LineNew`, `LineUpdated`, `LineCompleted`) as text stabilises,
- runs a built-in VAD with configurable `vad_threshold` (default 0.5), `vad_max_segment_duration` (default 15 s), `vad_window_duration` (default 0.5 s).

([v2 GitHub README §"Getting Started with Transcription"](https://github.com/moonshine-ai/moonshine))

### 8.4 Recommended chunk size (v1 pseudo-streaming)

- **Per-call segment:** aim for **1–30 s**. The v1 paper trained on 4–30 s and WER is best in that range; clips > 30 s see rising hallucination.
- **Hard limits:** 0.1 s minimum, 64 s maximum (enforced by `assert_audio_size`).
- **VAD segmenter:** 15 s max segment with 300–500 ms silence threshold is a sensible default for conversational speech.
- **Overlap:** if you want to avoid losing words at segment boundaries, overlap by ~200–500 ms and dedupe — but v1 has no built-in merging, so you'd implement that yourself.

---

## 9. Deployment considerations

### 9.1 Memory footprint (steady state)

| Config | Weights | Realistic RSS |
|---|---|---|
| tiny, float32 | 109 MB | ~300–450 MB |
| tiny, quantized 8-bit | 28 MB | ~200–300 MB |
| base, float32 | 247 MB | ~500–700 MB |
| base, quantized 8-bit | 63 MB | ~300–400 MB |

(RSS = weights + ONNX Runtime arena + Python/numpy/librosa/tokenizers overhead.)

### 9.2 Cold start

- **First-ever start (cold cache):** network download of weights — ~109 MB for tiny float on a typical connection is 5–20 s; then ONNX session init ~0.5–2 s. Total cold start: **~5–25 s**.
- **Warm start (weights cached):** ONNX session load from disk ~0.5–2 s for tiny, ~2–4 s for base. First inference is slightly slower (graph optimisation); subsequent calls are fast.
- **Mitigation:** pre-download at build time (`huggingface-cli download`) and pre-warm with a dummy `transcribe(ASSETS_DIR/'beckett.wav', model)` call before the service accepts traffic.

### 9.3 Running alongside a Node.js server

Yes — Moonshine is a pure-Python process; it has no opinion about what else runs on the box. Two viable patterns:

1. **Sidecar microservice (recommended).** A small FastAPI/Flask app exposing `POST /transcribe` (multipart WAV or raw PCM). The Node.js app calls it over localhost HTTP. Pros: process isolation, independent scaling, language boundary is clean. Cons: one extra hop (~1–5 ms localhost latency), two processes to supervise.
2. **In-process via `child_process` / Python shell.** Node spawns a long-lived Python worker, pipes JSON in/out over stdin/stdout. Lower overhead than HTTP, but you manage the IPC yourself.

Coexistence notes:
- ONNX Runtime CPU will happily use all cores by default. If your Node server is also CPU-heavy, **pin the Python process** (e.g. `taskset -c 0-3` on Linux, or set `OMP_NUM_THREADS=2` / `onnxruntime`'s session options) to avoid contention.
- Memory: budget ~400 MB for tiny-float alongside Node. A 2 GB Mint laptop is comfortable; 1 GB is tight if Node is also doing heavy work.
- The Python process is **thread-safe for inference** (ONNX Runtime sessions are re-entrant), so you can serve concurrent requests from a single loaded model — but Python's GIL means you want to run inference in a thread pool or use async with `run_in_threadpool`.

### 9.4 Recommended production setup

- **Image:** Debian/Ubuntu base + `ffmpeg` + `python3.11` + `pip install fastrtc-moonshine-onnx onnxruntime soundfile`.
- **Pre-bake weights:** at Docker build time, run a Python one-liner that instantiates `MoonshineOnnxModel(model_name="tiny", model_precision="quantized")` so the HF cache is populated. Set `HF_HOME=/app/hf-cache` and `TRANSFORMERS_OFFLINE=1` / `HF_HUB_OFFLINE=1` at runtime.
- **Use quantized** unless you need the last ~0.5–3 % WER (see v2 README's float-vs-quant table: 8-bit penalty is +3.0 % WER on Tiny, +0.5 % on Small). For tiny, the float-vs-quant WER gap is real — pick based on your accuracy budget.
- **API surface:** FastAPI + `run_in_threadpool` for the `transcribe` call. Keep one `MoonshineOnnxModel` instance in module scope; reuse it.
- **Audio in:** accept multipart WAV/Opus/WebM; let `librosa` decode. If clients send raw PCM, accept it with an explicit `sample_rate` query param and skip librosa.
- **Chunking:** enforce server-side max segment length (e.g. reject or auto-chunk anything > 60 s).
- **Health check:** a `/health` endpoint that runs `transcribe(ASSETS_DIR/'beckett.wav', model)` on boot and reports ready.

---

## 10. Alternatives worth mentioning

| Option | When to pick | Trade-offs vs Moonshine v1 |
|---|---|---|
| **`useful-moonshine-onnx`** (official) | Same as `fastrtc-moonshine-onnx` but you want the canonical, maintained package (v `20251121`, adds `numba`). | Identical API; slightly newer; preferred if you don't need fastrtc interop. ([PyPI](https://pypi.org/project/useful-moonshine-onnx/)) |
| **`moonshine-voice`** (v2) | You need true streaming, multilingual, TTS, intent, or diarisation; or you want Medium Streaming's 6.65 % WER beating Whisper Large v3. | Different API (C++ core, event-driven `Transcriber`); bigger dependency surface; v2 streaming models are newer and less battle-tested in third-party benchmarks. ([GitHub](https://github.com/moonshine-ai/moonshine)) |
| **`faster-whisper`** | You want the best CPU Whisper performance (CTranslate2), multilingual support, or batch processing of long files. | Larger (Whisper tiny is 73 MB, base 139 MB); pays the 30 s zero-pad tax on short clips; multilingual; mature. ([github.com/SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)) |
| **`whisper.cpp` (+ Python bindings)** | You want a single C++ binary, no Python, AVX2/NEON-tuned, runs everywhere incl. RPi. | Still Whisper (30 s window, no streaming cache); Python bindings (`whisper-cpp-python` / `pywhispercpp`) are thinner than `faster-whisper`. ([github.com/ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp)) |
| **`distil-whisper`** | English-only, want ~6× Whisper Large v3 speed, can afford 756 M params / ~5 GB. | Much bigger footprint than Moonshine Tiny; English-only; no streaming. ([huggingface.co/distil-whisper](https://huggingface.co/distil-whisper)) |
| **NVIDIA NeMo / Parakeet TDT / Canary** | GPU available, want SOTA accuracy (Canary Qwen 2.5B = 5.63 % WER) or >2 000× RTF. | GPU-required; heavy; English-only for Parakeet; Apache-2.0 / CC-BY-4.0. ([Northflank benchmark](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)) |
| **Vosk** | Tiny offline footprint (68 MB small model), works on Android/RPi, multilingual. | Higher WER than Moonshine at similar size (Picovoice: Vosk Small 18.4 % avg vs Moonshine Tiny 23.9 % streaming / 12.66 % batch — note Vosk's number is streaming-mode); older Kaldi-based architecture. ([alphacephei.com/vosk](https://alphacephei.com/vosk/)) |
| **Picovoice Cheetah/Leopard** | You want the absolute lowest CPU footprint and latency on edge, and can pay commercial. | Proprietary (free tier for dev); best-in-class core-hours (0.026–0.083) but not open-weight. ([picovoice.ai](https://picovoice.ai/)) |

**Bottom line for this integration:** if the requirement is *English, CPU-only, short clips, low footprint, MIT-licensed*, Moonshine Tiny via `fastrtc-moonshine-onnx` (or the official `useful-moonshine-onnx`) is a defensible default. If the requirement shifts to *multilingual, true streaming, or batch throughput on long files*, switch to `faster-whisper` (multilingual/batch) or `moonshine-voice` v2 (streaming).

---

## Sources

- Hugging Face model card — https://huggingface.co/UsefulSensors/moonshine
- Moonshine v1 paper (Jeffries et al., 2024) — https://arxiv.org/abs/2410.15608
- Moonshine v2 paper (streaming) — https://arxiv.org/abs/2602.12241
- Flavors of Moonshine (multilingual edge) — https://arxiv.org/abs/2509.02523
- Moonshine AI GitHub (v2 "Moonshine Voice") — https://github.com/moonshine-ai/moonshine
- Moonshine AI Python SDK docs — https://dev.moonshine.ai/py
- Moonshine AI announcement blog — https://huggingface.co/blog/UsefulSensors/announcing-moonshine-voice
- Pete Warden's launch post — https://petewarden.com/2024/10/21/introducing-moonshine-the-new-state-of-the-art-for-speech-to-text
- `fastrtc-moonshine-onnx` on PyPI — https://pypi.org/project/fastrtc-moonshine-onnx
- `useful-moonshine-onnx` on PyPI — https://pypi.org/project/useful-moonshine-onnx/
- `fastrtc` on PyPI (deps confirm the fork relationship) — https://pypi.org/project/fastrtc/
- FastRTC docs — https://fastrtc.org
- FastRTC launch blog (HF) — https://huggingface.co/blog/fastrtc
- FastRTC GitHub — https://github.com/gradio-app/fastrtc
- Hugging Face Hub file listing (onnx/merged/...) — https://huggingface.co/UsefulSensors/moonshine/tree/main/onnx/merged
- `onnx-community/moonshine-base-ONNX` (alternative export) — https://huggingface.co/onnx-community/moonshine-base-ONNX
- Picovoice STT benchmark (independent, CPU) — https://github.com/Picovoice/speech-to-text-benchmark
- Northflank 2026 STT benchmark survey — https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks
- Moonshine Web (in-browser, Xenova) — https://huggingface.co/posts/Xenova/486935205804807
- `faster-whisper` — https://github.com/SYSTRAN/faster-whisper
- `whisper.cpp` — https://github.com/ggerganov/whisper.cpp
- Moonshine Tiny on OpenASR leaderboard space — https://huggingface.co/OpenASR/moonshine-tiny
- Extracted `fastrtc-moonshine-onnx` wheel source (internal verification): `__init__.py`, `model.py`, `transcribe.py`, `version.py` — all quoted in §4.
