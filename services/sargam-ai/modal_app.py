import os
import sys
import uuid
import json
import re
import hashlib
import shutil
import subprocess
from pathlib import Path
import numpy as np

import modal
from fastapi import FastAPI, Request, Query, UploadFile, File
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.middleware.cors import CORSMiddleware

# Initialize Modal App
app = modal.App("sargam-tuner-backend")

# Persistent Cloud Volume for caching stems, pitch contours, and lyrics
volume = modal.Volume.from_name("sargam-tuner-cache", create_if_missing=True)
CACHE_DIR = Path("/cache")

# Debian container image with PyTorch, Demucs, yt-dlp, Deno+Node EJS, FFmpeg, Whisper + bgutil PO Token Server
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "ca-certificates", "git", "unzip")
    .pip_install(
        "demucs",
        "yt-dlp[default]",
        "yt-dlp-ejs",
        "curl_cffi",
        "faster-whisper",
        "scipy",
        "numpy",
        "torch",
        "torchaudio",
        "fastapi[standard]"
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && "
        "apt-get install -y nodejs && "
        "curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && "
        "git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil && "
        "cd /opt/bgutil/server && npm install && npx tsc && "
        "pip install -U bgutil-ytdlp-pot-provider"
    )
)

web_app = FastAPI(title="Sargam Tuner Cloud AI Backend")

web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_video_id(url: str) -> str:
    patterns = [
        r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
        r'(?:youtu\.be\/)([0-9A-Za-z_-]{11})',
        r'(?:embed\/)([0-9A-Za-z_-]{11})',
        r'(?:shorts\/)([0-9A-Za-z_-]{11})'
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return hashlib.md5(url.encode()).hexdigest()[:11]

def extract_pitch_and_bars(audio_path: Path):
    from scipy.io import wavfile
    wav_tmp = audio_path.with_suffix(".tmp.wav")
    cmd = ["ffmpeg", "-y", "-i", str(audio_path), "-ar", "22050", "-ac", "1", str(wav_tmp)]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wav_tmp.exists():
        return [], []

    sr, data = wavfile.read(str(wav_tmp))
    try: wav_tmp.unlink()
    except Exception: pass

    if data.dtype == np.int16: data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32: data = data.astype(np.float32) / 2147483648.0

    hop = int(sr * 0.05)
    frame_len = int(sr * 0.08)
    curve = []

    for i in range(0, len(data) - frame_len, hop):
        frame = data[i:i + frame_len]
        energy = np.mean(frame ** 2)
        t = round(i / sr, 3)
        if energy < 0.001:
            continue
        corr = np.correlate(frame, frame, mode='full')[frame_len - 1:]
        min_lag = int(sr / 600.0)
        max_lag = int(sr / 65.0)
        if max_lag >= len(corr):
            continue
        peak_lag = min_lag + np.argmax(corr[min_lag:max_lag])
        if peak_lag > 0:
            hz = float(sr / peak_lag)
            if 65.0 <= hz <= 600.0:
                curve.append({"t": t, "hz": round(hz, 2)})

    # Group into discrete horizontal note bars
    bars = []
    cur_midi = None
    start_t, end_t = 0, 0
    sum_hz, cnt = 0, 0

    for pt in curve:
        m = int(round(69 + 12 * np.log2(pt["hz"] / 440.0)))
        if cur_midi is None:
            cur_midi = m
            start_t = pt["t"]
            end_t = pt["t"] + 0.05
            sum_hz = pt["hz"]
            cnt = 1
        elif m == cur_midi and (pt["t"] - end_t) < 0.15:
            end_t = pt["t"] + 0.05
            sum_hz += pt["hz"]
            cnt += 1
        else:
            if (end_t - start_t) >= 0.12 and cnt >= 2:
                bars.append({
                    "start": round(start_t, 2),
                    "end": round(end_t, 2),
                    "midi": cur_midi,
                    "avg_hz": round(sum_hz / cnt, 1)
                })
            cur_midi = m
            start_t = pt["t"]
            end_t = pt["t"] + 0.05
            sum_hz = pt["hz"]
            cnt = 1

    if cur_midi is not None and (end_t - start_t) >= 0.12 and cnt >= 2:
        bars.append({
            "start": round(start_t, 2),
            "end": round(end_t, 2),
            "midi": cur_midi,
            "avg_hz": round(sum_hz / cnt, 1)
        })

    return curve, bars

def has_nvidia_gpu() -> bool:
    try:
        import torch
        if torch.cuda.is_available():
            return True
    except Exception:
        pass
    if shutil.which("nvidia-smi"):
        try:
            return subprocess.run(["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        except Exception:
            return False
    return False

def transcribe_lyrics(audio_path: Path):
    try:
        from faster_whisper import WhisperModel
        has_cuda = has_nvidia_gpu()
        model = WhisperModel(
            "base" if has_cuda else "tiny",
            device="cuda" if has_cuda else "cpu",
            compute_type="float16" if has_cuda else "int8"
        )
        segments, _ = model.transcribe(str(audio_path), beam_size=1 if not has_cuda else 3)
        res = []
        for s in segments:
            text = s.text.strip()
            if text:
                res.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": text})
        return res
    except Exception as e:
        print(f"Whisper transcription skipped: {e}")
        return []

def ensure_bgutil_server() -> bool:
    main_js = Path("/opt/bgutil/server/build/main.js")
    if not main_js.exists():
        return False
    import socket
    import time
    try:
        with socket.create_connection(("127.0.0.1", 4416), timeout=0.35):
            return True
    except Exception:
        pass
    try:
        subprocess.Popen(
            ["node", str(main_js), "--port", "4416", "--host", "127.0.0.1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        for _ in range(10):
            time.sleep(0.35)
            try:
                with socket.create_connection(("127.0.0.1", 4416), timeout=0.35):
                    return True
            except Exception:
                continue
    except Exception as err:
        print(f"bgutil start failed: {err}")
    return False

@app.function(
    image=image,
    cpu=4.0,
    memory=8192,
    timeout=600,
    scaledown_window=180,
    volumes={"/cache": volume}
)
@modal.asgi_app()
def fastapi_app():
    os.environ["TORCH_HOME"] = str(CACHE_DIR / "torch")
    os.environ["HF_HOME"] = str(CACHE_DIR / "hf")
    ensure_bgutil_server()
    return web_app

@web_app.get("/")
def index():
    return {"status": "ok", "service": "Sargam Tuner Cloud AI Backend (Modal Serverless)"}

@web_app.get("/api/health")
def health():
    has_cuda = has_nvidia_gpu()
    cookie_exists = (CACHE_DIR / "cookies.txt").exists()
    pot_active = ensure_bgutil_server()
    return {
        "status": "online",
        "gpu": "NVIDIA T4 GPU" if has_cuda else "Modal Cloud 4-vCPU / 8GB",
        "hasCookies": cookie_exists,
        "potServer": pot_active
    }

@web_app.get("/api/yt-status")
def yt_status(url: str = Query("https://www.youtube.com/watch?v=dQw4w9WgXcQ")):
    import yt_dlp
    ensure_bgutil_server()
    cookie_file = CACHE_DIR / "cookies.txt"
    last_err = "Unknown error"
    for clients in [['mweb', 'tv'], ['android_vr', 'ios'], ['web_safari', 'web']]:
        ydl_opts = {
            'format': 'ba/b',
            'extractor_args': {'youtube': {'player_client': clients}},
            'quiet': True,
            'no_warnings': True,
        }
        if cookie_file.exists():
            ydl_opts['cookiefile'] = str(cookie_file)
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    "ok": True,
                    "title": info.get("title"),
                    "duration": info.get("duration"),
                    "client": clients,
                    "usedCookies": cookie_file.exists()
                }
        except Exception as err:
            last_err = str(err)
    return JSONResponse({"ok": False, "error": last_err, "usedCookies": cookie_file.exists()}, status_code=403)

@web_app.get("/api/last-session")
def last_session():
    return {"hasSession": False}

@web_app.get("/api/get-pitch-and-lyrics")
async def get_pitch_and_lyrics(vocal_url: str = Query(...)):
    try:
        await volume.reload.aio()
    except Exception:
        pass
    match = re.search(r'(vid_[a-zA-Z0-9_\-]+)', vocal_url)
    if match:
        vid_dir = CACHE_DIR / match.group(1)
        meta_file = vid_dir / "metadata.json"
        if meta_file.exists():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return {"success": True, **data}
            except Exception as e:
                print(f"Error reading metadata.json: {e}")
        # Check if individual JSON files exist
        bars_file = vid_dir / "note_bars.json"
        curve_file = vid_dir / "pitch_curve.json"
        lyrics_file = vid_dir / "lyrics.json"
        if bars_file.exists():
            try:
                bars = json.loads(bars_file.read_text(encoding="utf-8"))
                curve = json.loads(curve_file.read_text(encoding="utf-8")) if curve_file.exists() else []
                lyrics = json.loads(lyrics_file.read_text(encoding="utf-8")) if lyrics_file.exists() else []
                return {"success": True, "note_bars": bars, "pitch_curve": curve, "lyrics": lyrics}
            except Exception as e:
                print(f"Error reading individual files: {e}")
    return {"success": False, "error": "Metadata not found"}

@web_app.head("/api/audio")
def stream_audio_head(file: str = Query(...)):
    target = CACHE_DIR / file
    if not target.exists():
        return Response(status_code=404)
    file_size = target.stat().st_size
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": "audio/mpeg"
    }
    return Response(status_code=200, headers=headers)

@web_app.get("/api/audio")
def stream_audio(request: Request, file: str = Query(...)):
    target = CACHE_DIR / file
    if not target.exists():
        return Response("Audio file not found", status_code=404)
    
    file_size = target.stat().st_size
    range_header = request.headers.get("range")
    if range_header:
        m = re.search(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1
            with open(target, "rb") as f:
                f.seek(start)
                data = f.read(length)
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
                "Content-Type": "audio/mpeg"
            }
            return Response(content=data, status_code=206, headers=headers)

    with open(target, "rb") as f:
        data = f.read()
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": "audio/mpeg"
    }
    return Response(content=data, status_code=200, headers=headers)

@web_app.get("/audio/{filename}")
def stream_static_audio(filename: str):
    local_audio = Path("/app/audio") / filename
    if local_audio.exists():
        return FileResponse(local_audio, media_type="audio/mpeg")
    return Response("Audio drone not found", status_code=404)

@web_app.post("/api/separate-stems")
async def separate_stems(req: Request):
    try:
        body = await req.json()
        url = body.get("url", "").strip()
        if not url:
            return JSONResponse({"success": False, "error": "Missing YouTube URL"}, status_code=400)

        vid = extract_video_id(url)
        out_dir = CACHE_DIR / f"vid_{vid}"
        out_dir.mkdir(parents=True, exist_ok=True)

        vocals_mp3 = out_dir / "vocals.mp3"
        inst_mp3 = out_dir / "no_vocals.mp3"
        meta_json = out_dir / "metadata.json"

        try:
            await volume.reload.aio()
        except Exception:
            pass

        if vocals_mp3.exists() and inst_mp3.exists() and meta_json.exists():
            with open(meta_json, "r", encoding="utf-8") as f:
                cached = json.load(f)
            return {
                "success": True,
                "cached": True,
                "title": cached.get("title", f"YouTube {vid}"),
                "vocals": f"/api/audio?file=vid_{vid}/vocals.mp3",
                "instruments": f"/api/audio?file=vid_{vid}/no_vocals.mp3",
                "note_bars": cached.get("note_bars", []),
                "pitch_curve": cached.get("pitch_curve", []),
                "lyrics": cached.get("lyrics", [])
            }

        # 1. Download YouTube Audio with progressive PO-token client strategy & cookie fallback
        import yt_dlp
        ensure_bgutil_server()
        download_base = out_dir / "original"
        cookie_file = CACHE_DIR / "cookies.txt"

        client_strategies = [
            ['android_vr'],
            ['ios'],
            ['mweb'],
            ['tv'],
            ['web_safari', 'web']
        ]
        info = None
        last_dl_err = None
        client_errors = []

        for clients in client_strategies:
            ydl_opts = {
                'format': 'ba/b/bv*+ba/best',
                'outtmpl': str(download_base),
                'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
                'extractor_args': {
                    'youtube': {'player_client': clients},
                    'youtubepot-bgutilhttp': {'base_url': ['http://127.0.0.1:4416']}
                },
                'js_runtimes': {'deno': {}, 'node': {}},
                'remote_components': ['ejs:github'],
                'quiet': True,
                'no_warnings': True,
            }
            if cookie_file.exists():
                ydl_opts['cookiefile'] = str(cookie_file)
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    break
            except Exception as dl_err:
                last_dl_err = dl_err
                client_errors.append(f"{clients}: {str(dl_err)[:180]}")
                # Remove partial files before retrying next client strategy
                for part in out_dir.glob("original*"):
                    try: part.unlink()
                    except Exception: pass

        if info is None:
            err_msg = str(last_dl_err or "YouTube download failed")
            combined_err = " | ".join(client_errors)
            if "Sign in to confirm you" in combined_err or "bot" in combined_err.lower():
                return JSONResponse({
                    "success": False,
                    "error": "YouTube flagged cloud IP for this video. Upload a Netscape cookies.txt or upload an audio file (MP3/WAV) directly.",
                    "details": combined_err
                }, status_code=403)
            return JSONResponse({
                "success": False,
                "error": err_msg,
                "details": combined_err
            }, status_code=500)

        title = info.get('title', f"YouTube {vid}")

        orig_mp3 = out_dir / "original.mp3"

        # 2. Run Demucs Separation (multi-threaded CPU)
        subprocess.run([
            sys.executable, "-m", "demucs.separate",
            "--two-stems", "vocals",
            "-n", "htdemucs",
            "-j", "4",
            "-o", str(out_dir),
            str(orig_mp3)
        ], check=True)

        track_dir = out_dir / "htdemucs" / "original"
        raw_vocal_wav = track_dir / "vocals.wav"
        raw_inst_wav = track_dir / "no_vocals.wav"

        subprocess.run(["ffmpeg", "-y", "-i", str(raw_vocal_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(vocals_mp3)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["ffmpeg", "-y", "-i", str(raw_inst_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(inst_mp3)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # 3. Compute Vocal Pitch Curve & Note Bars
        curve, bars = extract_pitch_and_bars(vocals_mp3)

        # 4. Compute Whisper Lyrics
        lyrics = transcribe_lyrics(vocals_mp3)

        # Cache metadata
        meta = {"title": title, "note_bars": bars, "pitch_curve": curve, "lyrics": lyrics}
        with open(meta_json, "w", encoding="utf-8") as f:
            json.dump(meta, f)

        try:
            await volume.commit.aio()
        except Exception:
            pass

        return {
            "success": True,
            "cached": False,
            "title": title,
            "vocals": f"/api/audio?file=vid_{vid}/vocals.mp3",
            "instruments": f"/api/audio?file=vid_{vid}/no_vocals.mp3",
            "note_bars": bars,
            "pitch_curve": curve,
            "lyrics": lyrics
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

@web_app.post("/api/separate-stems-file")
async def separate_stems_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        if not content:
            return JSONResponse({"success": False, "error": "Empty audio file"}, status_code=400)
            
        file_hash = hashlib.md5(content).hexdigest()[:12]
        title = Path(file.filename or "uploaded_song").stem
        out_dir = CACHE_DIR / f"vid_{file_hash}"
        out_dir.mkdir(parents=True, exist_ok=True)
        
        vocals_mp3 = out_dir / "vocals.mp3"
        inst_mp3 = out_dir / "no_vocals.mp3"
        meta_json = out_dir / "metadata.json"
        
        try:
            await volume.reload.aio()
        except Exception:
            pass

        if vocals_mp3.exists() and inst_mp3.exists() and meta_json.exists():
            with open(meta_json, "r", encoding="utf-8") as f:
                cached = json.load(f)
            return {
                "success": True,
                "cached": True,
                "title": cached.get("title", title),
                "vocals": f"/api/audio?file=vid_{file_hash}/vocals.mp3",
                "instruments": f"/api/audio?file=vid_{file_hash}/no_vocals.mp3",
                "note_bars": cached.get("note_bars", []),
                "pitch_curve": cached.get("pitch_curve", []),
                "lyrics": cached.get("lyrics", [])
            }

        input_audio = out_dir / "input.mp3"
        with open(input_audio, "wb") as f:
            f.write(content)

        # Demucs Separation
        subprocess.run([
            sys.executable, "-m", "demucs.separate",
            "--two-stems", "vocals",
            "-n", "htdemucs",
            "-o", str(out_dir),
            str(input_audio)
        ], check=True)

        track_dir = out_dir / "htdemucs" / "input"
        raw_vocal_wav = track_dir / "vocals.wav"
        raw_inst_wav = track_dir / "no_vocals.wav"

        subprocess.run(["ffmpeg", "-y", "-i", str(raw_vocal_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(vocals_mp3)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["ffmpeg", "-y", "-i", str(raw_inst_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(inst_mp3)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        curve, bars = extract_pitch_and_bars(vocals_mp3)
        lyrics = transcribe_lyrics(vocals_mp3)

        meta = {"title": title, "note_bars": bars, "pitch_curve": curve, "lyrics": lyrics}
        with open(meta_json, "w", encoding="utf-8") as f:
            json.dump(meta, f)

        try:
            await volume.commit.aio()
        except Exception:
            pass

        return {
            "success": True,
            "cached": False,
            "title": title,
            "vocals": f"/api/audio?file=vid_{file_hash}/vocals.mp3",
            "instruments": f"/api/audio?file=vid_{file_hash}/no_vocals.mp3",
            "note_bars": bars,
            "pitch_curve": curve,
            "lyrics": lyrics
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

@web_app.post("/api/upload-cookies")
async def upload_cookies(file: UploadFile = File(...)):
    try:
        content = await file.read()
        cookie_path = CACHE_DIR / "cookies.txt"
        with open(cookie_path, "wb") as f:
            f.write(content)
        try:
            await volume.commit.aio()
        except Exception:
            pass
        return {"success": True, "message": "YouTube cookies saved to cloud cache volume"}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
