#!/usr/bin/env python3
"""
faster-whisper wrapper for Auto Lyrics Player.
Usage: python transcribe.py <audio_path> [--model <name>] [--language <code>]
Outputs newline-delimited JSON to stdout:
  {"type": "progress", "stage": "transcribing", "percent": 0.5}
  {"type": "segment", "id": "line_001", "start": 1.2, "end": 3.4, "text": "...", "confidence": 0.91}
  {"type": "done", "count": 42}
  {"type": "error", "message": "..."}
"""
import sys
import json
import argparse
import traceback
import os

# SSL_CERT_FILE 환경변수가 존재하지만 유효하지 않은 파일 경로를 가리키면 ssl 모듈이 FileNotFoundError를 일으킵니다.
# 이를 방지하기 위해 실제로 파일이 존재하지 않는 경우 환경변수를 지워줍니다.
if "SSL_CERT_FILE" in os.environ and not os.path.exists(os.environ["SSL_CERT_FILE"]):
    del os.environ["SSL_CERT_FILE"]


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--language", default=None)
    parser.add_argument("--initial_prompt", default=None)
    parser.add_argument("--beam_size", type=int, default=5)
    args = parser.parse_args()

    # Windows 환경에서 pip 설치된 nvidia 패키지 DLL 경로 동적 추가
    import platform
    import os
    if platform.system() == "Windows":
        # PyInstaller 임시 디렉토리(_MEIPASS) 및 실행 경로를 포함하여 탐색
        base_paths = []
        if hasattr(sys, "_MEIPASS"):
            base_paths.append(sys._MEIPASS)
        base_paths.append(os.path.dirname(sys.executable))
        base_paths.extend(sys.path)

        for path in base_paths:
            if not path:
                continue
            nvidia_dir = os.path.join(path, "nvidia")
            if os.path.exists(nvidia_dir):
                for root, dirs, files in os.walk(nvidia_dir):
                    if root.endswith("bin") or root.endswith("lib"):
                        try:
                            if hasattr(os, "add_dll_directory"):
                                os.add_dll_directory(root)
                            # C++ 바이너리(ctranslate2 등) 탐색을 위해 PATH에도 추가
                            os.environ["PATH"] = root + os.pathsep + os.environ["PATH"]
                        except Exception:
                            pass

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        emit({"type": "error", "message": "faster-whisper is not installed. Run: pip install faster-whisper"})
        sys.exit(1)

    try:
        emit({"type": "progress", "stage": "loading_model", "percent": 0.0})
        import ctranslate2
        
        # Helper function to execute transcription and collect lines
        def run_transcription(target_model):
            emit({"type": "progress", "stage": "transcribing", "percent": 0.1})
            iter_segments, info_obj = target_model.transcribe(
                args.audio_path,
                language=args.language,
                beam_size=args.beam_size,
                vad_filter=False,
                condition_on_previous_text=False,
                temperature=0.0,
                initial_prompt=args.initial_prompt,
            )
            
            output_lines = []
            for idx, seg in enumerate(iter_segments):
                output_lines.append({
                    "type": "segment",
                    "id": f"line_{idx + 1:03d}",
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                    "text": seg.text.strip(),
                    "confidence": 0.9,
                })
            return output_lines, info_obj

        model = None
        device_choice = args.device
        lines = []
        info = None

        if device_choice == "cpu":
            emit({"type": "info", "message": "Using CPU for transcription (forced)."})
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
            lines, info = run_transcription(model)
        elif device_choice == "cuda":
            if ctranslate2.get_cuda_device_count() == 0:
                raise RuntimeError("No CUDA devices found, but GPU Only (cuda) was requested.")
            emit({"type": "info", "message": "Using CUDA (GPU) for transcription (forced)."})
            model = WhisperModel(args.model, device="cuda", compute_type="float16")
            lines, info = run_transcription(model)
        else: # "auto"
            gpu_activated = False
            if ctranslate2.get_cuda_device_count() > 0:
                try:
                    # Attempt GPU (CUDA) execution
                    model = WhisperModel(args.model, device="cuda", compute_type="float16")
                    lines, info = run_transcription(model)
                    gpu_activated = True
                    emit({"type": "info", "message": "Using CUDA (GPU) for transcription (auto)."})
                except Exception as e:
                    import traceback
                    emit({
                        "type": "info",
                        "message": f"CUDA initialization failed, falling back to CPU. Error: {str(e)}\n{traceback.format_exc()}"
                    })
                    model = None

            if not gpu_activated:
                # CPU Fallback
                emit({"type": "info", "message": "Using CPU for transcription (fallback)."})
                model = WhisperModel(args.model, device="cpu", compute_type="int8")
                lines, info = run_transcription(model)

        # Emit all generated segment JSONs
        for line in lines:
            emit(line)

        emit({"type": "done", "count": len(lines), "language": info.language if info else (args.language or "unknown")})

    except FileNotFoundError as exc:
        import os
        if not os.path.exists(args.audio_path):
            emit({"type": "error", "message": f"Audio file not found: {args.audio_path}"})
        else:
            emit({"type": "error", "message": f"FileNotFoundError: {str(exc)}\n{traceback.format_exc()}"})
        sys.exit(1)
    except Exception as exc:
        emit({"type": "error", "message": traceback.format_exc()})
        sys.exit(1)

if __name__ == "__main__":
    main()
