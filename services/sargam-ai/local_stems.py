"""Local Demucs, yt-dlp, YIN/ACF pitch, and faster-whisper stem extractor.

Provides a standalone GPU/CPU fallback when the Modal Cloud Sargam endpoint
is offline or disabled. Outputs normalized JSON on stdout.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_video_id(url: str) -> str:
    """Extract a stable 11-character YouTube ID or MD5 slug for cache keys."""
    patterns = [
        r"(?:v=|/)([0-9A-Za-z_-]{11}).*",
        r"(?:youtu\.be/)([0-9A-Za-z_-]{11})",
        r"(?:embed/)([0-9A-Za-z_-]{11})",
        r"(?:shorts/)([0-9A-Za-z_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:11]


def has_cuda() -> bool:
    """Return True if PyTorch CUDA GPU acceleration is available locally."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def extract_pitch_and_bars(audio_path: Path):
    """Extract normalized F0 pitch contour and discrete vocal note bars."""
    import numpy as np
    from scipy.io import wavfile

    wav_tmp = audio_path.with_suffix(".tmp.wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(audio_path), "-ar", "22050", "-ac", "1", str(wav_tmp)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        if not wav_tmp.exists():
            return [], []
        sr, data = wavfile.read(str(wav_tmp))
    finally:
        try:
            if wav_tmp.exists():
                wav_tmp.unlink()
        except Exception:
            pass

    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    else:
        data = data.astype(np.float32)

    hop = int(sr * 0.05)
    frame_len = int(sr * 0.08)
    min_lag = max(1, int(sr / 600.0))
    max_lag = max(min_lag + 1, int(sr / 65.0))
    n_fft = 1 << (2 * frame_len - 1).bit_length()
    curve = []

    for i in range(0, len(data) - frame_len, hop):
        frame = data[i : i + frame_len]
        energy = float(np.mean(frame ** 2))
        if energy < 0.001 or max_lag >= frame_len:
            continue
        spectrum = np.fft.rfft(frame, n=n_fft)
        corr = np.fft.irfft(spectrum * np.conj(spectrum), n=n_fft)[:frame_len]
        peak_lag = min_lag + int(np.argmax(corr[min_lag:max_lag]))
        if peak_lag > 0 and corr[0] > 0 and corr[peak_lag] > 0.25 * corr[0]:
            hz = float(sr / peak_lag)
            if 65.0 <= hz <= 600.0:
                curve.append({"t": round(i / sr, 3), "hz": round(hz, 2)})

    bars = []
    cur_midi = None
    start_t, end_t = 0.0, 0.0
    sum_hz, cnt = 0.0, 0

    for pt in curve:
        midi = int(round(69 + 12 * np.log2(pt["hz"] / 440.0)))
        if cur_midi is None:
            cur_midi = midi
            start_t = pt["t"]
            end_t = pt["t"] + 0.05
            sum_hz = pt["hz"]
            cnt = 1
        elif midi == cur_midi and (pt["t"] - end_t) < 0.15:
            end_t = pt["t"] + 0.05
            sum_hz += pt["hz"]
            cnt += 1
        else:
            if (end_t - start_t) >= 0.12 and cnt >= 2:
                bars.append({
                    "start": round(start_t, 2),
                    "end": round(end_t, 2),
                    "midi": cur_midi,
                    "avg_hz": round(sum_hz / cnt, 1),
                })
            cur_midi = midi
            start_t = pt["t"]
            end_t = pt["t"] + 0.05
            sum_hz = pt["hz"]
            cnt = 1

    if cur_midi is not None and (end_t - start_t) >= 0.12 and cnt >= 2:
        bars.append({
            "start": round(start_t, 2),
            "end": round(end_t, 2),
            "midi": cur_midi,
            "avg_hz": round(sum_hz / cnt, 1),
        })

    return curve, bars


def transcribe_lyrics(audio_path: Path, use_cuda: bool):
    """Run local faster-whisper transcription on isolated vocal stem."""
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(
            "base" if use_cuda else "tiny",
            device="cuda" if use_cuda else "cpu",
            compute_type="float16" if use_cuda else "int8",
        )
        segments, _ = model.transcribe(str(audio_path), beam_size=3 if use_cuda else 1, vad_filter=True)
        return [
            {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
            for s in segments
            if s.text and re.search(r"[A-Za-z0-9\u0900-\u097F]", s.text)
        ]
    except Exception:
        return []


def separate_audio_file(input_audio: Path, out_dir: Path, title: str, cache_key: str, use_cuda: bool):
    """Separate vocal/instrumental stems via Demucs and compute pitch & lyrics."""
    vocals_mp3 = out_dir / "vocals.mp3"
    inst_mp3 = out_dir / "no_vocals.mp3"
    meta_json = out_dir / "metadata.json"

    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "--two-stems",
        "vocals",
        "-n",
        "htdemucs",
        "-d",
        "cuda" if use_cuda else "cpu",
        "-o",
        str(out_dir),
        str(input_audio),
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)

    track_dir = out_dir / "htdemucs" / input_audio.stem
    raw_vocal_wav = track_dir / "vocals.wav"
    raw_inst_wav = track_dir / "no_vocals.wav"

    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_vocal_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(vocals_mp3)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_inst_wav), "-codec:a", "libmp3lame", "-qscale:a", "2", str(inst_mp3)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )

    curve, bars = extract_pitch_and_bars(vocals_mp3)
    lyrics = transcribe_lyrics(vocals_mp3, use_cuda)
    meta = {"title": title, "note_bars": bars, "pitch_curve": curve, "lyrics": lyrics}
    meta_json.write_text(json.dumps(meta), encoding="utf-8")

    return {
        "success": True,
        "cached": False,
        "title": title,
        "vocals": f"/api/audio?file=vid_{cache_key}/vocals.mp3",
        "instruments": f"/api/audio?file=vid_{cache_key}/no_vocals.mp3",
        "note_bars": bars,
        "pitch_curve": curve,
        "lyrics": lyrics,
        "device": "cuda" if use_cuda else "cpu",
    }


def cached_result(out_dir: Path, cache_key: str, fallback_title: str):
    """Return cached local result if stems and metadata already exist."""
    vocals_mp3 = out_dir / "vocals.mp3"
    inst_mp3 = out_dir / "no_vocals.mp3"
    meta_json = out_dir / "metadata.json"
    if vocals_mp3.exists() and inst_mp3.exists() and meta_json.exists():
        cached = json.loads(meta_json.read_text(encoding="utf-8"))
        return {
            "success": True,
            "cached": True,
            "title": cached.get("title", fallback_title),
            "vocals": f"/api/audio?file=vid_{cache_key}/vocals.mp3",
            "instruments": f"/api/audio?file=vid_{cache_key}/no_vocals.mp3",
            "note_bars": cached.get("note_bars", []),
            "pitch_curve": cached.get("pitch_curve", []),
            "lyrics": cached.get("lyrics", []),
        }
    return None


def main():
    parser = argparse.ArgumentParser(description="Local Sargam AI stem separator")
    parser.add_argument("--probe", action="store_true", help="Report local GPU/tool readiness")
    parser.add_argument("--mode", choices=["url", "file"], help="Separation input mode")
    parser.add_argument("--input", help="YouTube/media URL or local audio file path")
    parser.add_argument("--title", default="", help="Optional track title override")
    parser.add_argument(
        "--cache-dir",
        default=os.path.join(tempfile.gettempdir(), "callsummarizer_sargam_cache"),
        help="Directory for separated stem cache",
    )
    args = parser.parse_args()

    if args.probe:
        has_demucs = importlib.util.find_spec("demucs") is not None
        has_ytdlp = importlib.util.find_spec("yt_dlp") is not None
        has_ffmpeg = shutil.which("ffmpeg") is not None
        has_nvidia = bool(shutil.which("nvidia-smi"))
        print(json.dumps({
            "ok": bool(has_demucs and has_ytdlp and has_ffmpeg),
            "cuda": has_nvidia,
            "ffmpeg": has_ffmpeg
        }))
        return

    use_cuda = has_cuda()

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "url":
        vid = extract_video_id(args.input)
        out_dir = cache_dir / f"vid_{vid}"
        out_dir.mkdir(parents=True, exist_ok=True)
        existing = cached_result(out_dir, vid, f"YouTube {vid}")
        if existing:
            print(json.dumps(existing))
            return

        import yt_dlp

        download_base = out_dir / "original"
        cookie_file = cache_dir / "cookies.txt"
        ydl_opts = {
            "format": "ba/b/bv*+ba/best",
            "outtmpl": str(download_base),
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
            "quiet": True,
            "no_warnings": True,
        }
        if cookie_file.exists():
            ydl_opts["cookiefile"] = str(cookie_file)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(args.input, download=True)

        title = (info or {}).get("title") or args.title or f"YouTube {vid}"
        orig_mp3 = out_dir / "original.mp3"
        if not orig_mp3.exists():
            matches = [p for p in out_dir.glob("original.*") if not p.name.endswith(".part")]
            if matches:
                orig_mp3 = matches[0]
        result = separate_audio_file(orig_mp3, out_dir, title, vid, use_cuda)
        print(json.dumps(result))
        return

    if args.mode == "file":
        src_path = Path(args.input)
        raw_bytes = src_path.read_bytes()
        file_hash = hashlib.md5(raw_bytes).hexdigest()[:12]
        out_dir = cache_dir / f"vid_{file_hash}"
        out_dir.mkdir(parents=True, exist_ok=True)
        title = args.title or src_path.stem or "Uploaded Song Stems"
        existing = cached_result(out_dir, file_hash, title)
        if existing:
            print(json.dumps(existing))
            return

        ext = src_path.suffix or ".mp3"
        copied = out_dir / f"input{ext}"
        copied.write_bytes(raw_bytes)
        result = separate_audio_file(copied, out_dir, title, file_hash, use_cuda)
        print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as proc_err:
        err_detail = proc_err.stderr.decode("utf-8", errors="ignore") if proc_err.stderr else str(proc_err)
        print(json.dumps({"success": False, "error": f"Demucs/FFmpeg failed: {err_detail.strip() or proc_err}"}))
        sys.exit(1)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)
