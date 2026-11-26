"""Persistent local faster-whisper worker for zero-cost speech-to-text fallback."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    winget_glob = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_glob.exists():
        for p in winget_glob.rglob("ffmpeg.exe"):
            return str(p)
    return None


def main():
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        sys.exit(1)

    ffmpeg_bin = _find_ffmpeg()
    print(json.dumps({"ready": True}), flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        wav_tmp = None
        try:
            payload = json.loads(line)
            req_id = payload.get("id")
            src_path = payload.get("path", "")
            if not src_path or not os.path.exists(src_path):
                print(json.dumps({"id": req_id, "text": "", "error": "Missing audio file"}), flush=True)
                continue

            target_path = src_path
            if ffmpeg_bin:
                fd, wav_tmp = tempfile.mkstemp(suffix=".wav", prefix="cs_stt_")
                os.close(fd)
                proc = subprocess.run(
                    [ffmpeg_bin, "-y", "-i", src_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_tmp],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if proc.returncode == 0 and os.path.exists(wav_tmp) and os.path.getsize(wav_tmp) > 64:
                    target_path = wav_tmp

            segments, _ = model.transcribe(
                target_path,
                beam_size=1,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 250},
            )
            text = " ".join(s.text.strip() for s in segments if s.text and s.text.strip()).strip()
            print(json.dumps({"id": req_id, "text": text}), flush=True)
        except Exception as exc:
            print(json.dumps({"id": req_id, "text": "", "error": str(exc)}), flush=True)
        finally:
            if wav_tmp and os.path.exists(wav_tmp):
                try:
                    os.remove(wav_tmp)
                except Exception:
                    pass


if __name__ == "__main__":
    main()
