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
    parser.add_argument("audio_path", nargs="?", default=None)
    parser.add_argument("--download_only", action="store_true", help="Download the model and exit")
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

        app_data = os.environ.get("APPDATA")
        if app_data:
            base_paths.append(os.path.join(app_data, "auto-lyrics-player"))
            base_paths.append(os.path.join(app_data, "auto-lyrics-player", "bin"))
            base_paths.append(os.path.join(app_data, "AutoLyricsPlayer"))
            base_paths.append(os.path.join(app_data, "AutoLyricsPlayer", "bin"))

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

        # 2. 시스템 설치된 CUDA Toolkit (CUDA_PATH) 환경변수 탐색
        cuda_path = os.environ.get("CUDA_PATH")
        if cuda_path and os.path.exists(cuda_path):
            cuda_bin = os.path.join(cuda_path, "bin")
            if os.path.exists(cuda_bin):
                try:
                    if hasattr(os, "add_dll_directory"):
                        os.add_dll_directory(cuda_bin)
                    os.environ["PATH"] = cuda_bin + os.pathsep + os.environ["PATH"]
                except Exception:
                    pass
        
    try:
        from faster_whisper import WhisperModel, download_model
    except ImportError:
        emit({"type": "error", "message": "faster-whisper is not installed. Run: pip install faster-whisper"})
        sys.exit(1)

    # 모델 다운로드 전용 모드
    if args.download_only:
        try:
            from huggingface_hub import snapshot_download
            from huggingface_hub import HfFileSystem
            import re

            repo_id = f"Systran/faster-whisper-{args.model}"

            # 전체 파일 목록 조회 → 총 예상 용량 계산
            try:
                fs = HfFileSystem()
                files = fs.ls(repo_id, detail=True)
                total_size = sum(f.get("size", 0) for f in files if f.get("type") == "file")
            except Exception:
                total_size = 0

            emit({"type": "progress", "stage": "downloading", "percent": 0.0,
                  "message": f"{args.model} 파일 목록 확인 중...", "totalBytes": total_size})

            downloaded_bytes = 0
            file_count = 0
            completed_files = 0

            # tqdm을 커스텀 서브클래스로 대체하여 진행률 캡처
            try:
                from tqdm import tqdm as original_tqdm

                class ProgressTqdm(original_tqdm):
                    def __init__(self, *a, **kw):
                        super().__init__(*a, **kw)

                    def update(self, n=1):
                        super().update(n)
                        nonlocal downloaded_bytes
                        downloaded_bytes += n * (self.unit_scale or 1) if self.unit in ("B", "iB") else 0
                        pct = (downloaded_bytes / total_size) if total_size > 0 else 0
                        pct = min(pct, 0.99)
                        emit({
                            "type": "progress",
                            "stage": "downloading",
                            "percent": round(pct, 4),
                            "message": f"다운로드 중: {self.desc or args.model}",
                            "downloadedBytes": downloaded_bytes,
                            "totalBytes": total_size
                        })

                import huggingface_hub.file_download as _fd
                _orig_tqdm = _fd.tqdm
                _fd.tqdm = ProgressTqdm

                model_path = snapshot_download(repo_id=repo_id, local_files_only=False)

                _fd.tqdm = _orig_tqdm

            except Exception:
                # tqdm 훅 실패 시 진행률 없이 그냥 다운로드
                emit({"type": "progress", "stage": "downloading", "percent": 0.1,
                      "message": f"{args.model} 다운로드 중... (진행률 표시 불가)"})
                model_path = snapshot_download(repo_id=repo_id, local_files_only=False)

            emit({"type": "done", "stage": "downloaded", "model": args.model, "path": model_path})
            sys.exit(0)

        except ImportError as e:
            emit({"type": "error", "message": f"huggingface_hub를 찾을 수 없습니다. faster-whisper를 재설치하세요: {str(e)}"})
            sys.exit(1)
        except Exception as e:
            emit({"type": "error", "message": f"모델 다운로드 실패: {str(e)}"})
            sys.exit(1)


    if not args.audio_path:
        emit({"type": "error", "message": "Missing required audio_path argument."})
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
                vad_filter=False,  # 사용자 요구사항에 따라 vad_filter=False 고정 (가사 손실 0%)
                word_timestamps=True,  # 단어 단위 precise timestamp 추출
                condition_on_previous_text=False,
                temperature=0.0,
                initial_prompt=args.initial_prompt or "가사 전사: 노래 가사를 줄 단위로 명확히 분할하여 기록합니다.",
            )
            
            output_lines = []
            line_count = 1

            for seg in iter_segments:
                words = getattr(seg, "words", None)
                if words and len(words) > 0:
                    current_line_words = []
                    
                    for w in words:
                        w_text = w.word.strip()
                        if not w_text:
                            continue
                        
                        if not current_line_words:
                            current_line_words.append(w)
                        else:
                            prev_w = current_line_words[-1]
                            gap = w.start - prev_w.end
                            
                            # 단어 간 시간 차이가 1.2초 이상이거나, 줄바꿈 힌트가 포함되거나, 텍스트가 너무 길어지면 줄 분할
                            should_split = (
                                gap >= 1.2 or
                                "\n" in w.word or
                                len(" ".join([x.word.strip() for x in current_line_words])) > 45
                            )
                            
                            if should_split:
                                line_text = " ".join([x.word.strip() for x in current_line_words]).strip()
                                if line_text:
                                    output_lines.append({
                                        "type": "segment",
                                        "id": f"line_{line_count:03d}",
                                        "start": round(current_line_words[0].start, 3),
                                        "end": round(current_line_words[-1].end, 3),
                                        "text": line_text,
                                        "confidence": 0.9,
                                    })
                                    line_count += 1
                                current_line_words = [w]
                            else:
                                current_line_words.append(w)
                    
                    if current_line_words:
                        line_text = " ".join([x.word.strip() for x in current_line_words]).strip()
                        if line_text:
                            output_lines.append({
                                "type": "segment",
                                "id": f"line_{line_count:03d}",
                                "start": round(current_line_words[0].start, 3),
                                "end": round(current_line_words[-1].end, 3),
                                "text": line_text,
                                "confidence": 0.9,
                            })
                            line_count += 1
                else:
                    text = seg.text.strip()
                    if text:
                        output_lines.append({
                            "type": "segment",
                            "id": f"line_{line_count:03d}",
                            "start": round(seg.start, 3),
                            "end": round(seg.end, 3),
                            "text": text,
                            "confidence": 0.9,
                        })
                        line_count += 1

            return output_lines, info_obj

        # CUDA 런타임 라이브러리(cublas64_*.dll 등) 로드 가능 여부 사전 확인
        def check_cuda_runtime():
            if ctranslate2.get_cuda_device_count() == 0:
                return False, "No CUDA devices detected"
            if platform.system() == "Windows":
                import ctypes
                found_cublas = False
                for dll_name in ["cublas64_12.dll", "cublas64_11.dll"]:
                    try:
                        ctypes.CDLL(dll_name)
                        found_cublas = True
                        break
                    except Exception:
                        pass
                if not found_cublas:
                    return False, "cublas64_12.dll 또는 cublas64_11.dll을 로드할 수 없습니다"
            return True, "CUDA available"

        cuda_ok, cuda_reason = check_cuda_runtime()
        model = None
        device_choice = args.device
        lines = []
        info = None

        resolved_device = "cpu"
        compute_type = "int8"
        mode_msg = "Using CPU for transcription (fallback)."

        if device_choice == "cpu":
            resolved_device = "cpu"
            compute_type = "int8"
            mode_msg = "Using CPU for transcription (forced)."
        elif device_choice == "cuda":
            if not cuda_ok:
                emit({
                    "type": "info",
                    "message": f"GPU 가속(CUDA)이 요청되었으나 필수 런타임 라이브러리가 없어 CPU로 전환합니다 ({cuda_reason})."
                })
                resolved_device = "cpu"
                compute_type = "int8"
                mode_msg = "Using CPU for transcription (fallback from forced CUDA)."
            else:
                resolved_device = "cuda"
                compute_type = "float16"
                mode_msg = "Using CUDA (GPU) for transcription (forced)."
        else: # "auto"
            if cuda_ok:
                try:
                    # Attempt GPU (CUDA) model load first
                    model = WhisperModel(args.model, device="cuda", compute_type="float16")
                    resolved_device = "cuda"
                    compute_type = "float16"
                    mode_msg = "Using CUDA (GPU) for transcription (auto)."
                except Exception as e:
                    emit({
                        "type": "info",
                        "message": f"CUDA initialization failed, falling back to CPU. Error: {str(e)}\n{traceback.format_exc()}"
                    })
                    model = None
            else:
                emit({
                    "type": "info",
                    "message": f"CUDA 미지원 또는 필수 라이브러리 부재로 CPU 모드를 사용합니다 ({cuda_reason})."
                })

            if model is None:
                resolved_device = "cpu"
                compute_type = "int8"
                mode_msg = "Using CPU for transcription (fallback)."

        if model is None:
            model = WhisperModel(args.model, device=resolved_device, compute_type=compute_type)

        emit({"type": "info", "message": mode_msg})

        # 런타임 실행 중 예외 처리 (lazy loading으로 인한 cublas/cudnn 지연 에러 등 방어)
        try:
            lines, info = run_transcription(model)
        except Exception as run_exc:
            err_str = str(run_exc).lower()
            if resolved_device == "cuda" and ("cublas" in err_str or "cudnn" in err_str or "cuda" in err_str or "out of memory" in err_str or isinstance(run_exc, RuntimeError)):
                emit({
                    "type": "info",
                    "message": f"CUDA 추론 도중 런타임 오류 발생: {str(run_exc)}. CPU 모드로 안전하게 재시도합니다."
                })
                try:
                    del model
                    import gc
                    gc.collect()
                except Exception:
                    pass
                resolved_device = "cpu"
                compute_type = "int8"
                model = WhisperModel(args.model, device="cpu", compute_type="int8")
                emit({"type": "info", "message": "Using CPU for transcription (recovered from GPU error)."})
                lines, info = run_transcription(model)
            else:
                raise run_exc

        # Emit all generated segment JSONs
        for line in lines:
            emit(line)

        emit({"type": "done", "count": len(lines), "language": info.language if info else (args.language or "unknown")})

    except FileNotFoundError as exc:
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
