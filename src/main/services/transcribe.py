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
import argparse
import ctypes
import gc
import json
import os
import platform
import sys
import time
import traceback

# SSL_CERT_FILE 환경변수가 존재하지만 유효하지 않은 파일 경로를 가리키면 ssl 모듈이 FileNotFoundError를 일으킵니다.
# 이를 방지하기 위해 실제로 파일이 존재하지 않는 경우 환경변수를 지워줍니다.
if "SSL_CERT_FILE" in os.environ and not os.path.exists(os.environ["SSL_CERT_FILE"]):
    del os.environ["SSL_CERT_FILE"]


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", nargs="?", default=None)
    parser.add_argument("--download_only", action="store_true", help="Download the model and exit")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--language", default=None)
    parser.add_argument("--initial_prompt", default=None)
    parser.add_argument("--beam_size", type=int, default=5)
    parser.add_argument("--vocal_model", default=None, help="Optional ONNX MDX-Net vocal separation model path")
    return parser.parse_args(argv)


def configure_windows_cuda_dlls():
    """Windows 환경에서 pip nvidia 패키지 및 CUDA_PATH DLL 검색 경로를 동적으로 등록합니다."""
    if platform.system() != "Windows":
        return

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
            for root, _dirs, files in os.walk(nvidia_dir):
                if root.endswith("bin") or root.endswith("lib") or any(f.lower().endswith(".dll") for f in files):
                    try:
                        if hasattr(os, "add_dll_directory"):
                            os.add_dll_directory(root)
                        # C++ 바이너리(ctranslate2 등) 탐색을 위해 PATH에도 추가
                        os.environ["PATH"] = root + os.pathsep + os.environ["PATH"]
                    except Exception:
                        pass

    # 시스템 설치된 CUDA Toolkit (CUDA_PATH) 환경변수 탐색
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


def download_whisper_model(model_name, emit_fn=emit):
    """모델 다운로드 전용 모드를 수행하고 종료 코드를 반환합니다."""
    try:
        from faster_whisper.utils import _MODELS as FW_MODELS
        from huggingface_hub import HfFileSystem, snapshot_download

        repo_id = FW_MODELS.get(model_name, f"Systran/faster-whisper-{model_name}")

        # 전체 파일 목록 조회 → 총 예상 용량 계산
        try:
            fs = HfFileSystem()
            files = fs.ls(repo_id, detail=True)
            total_size = sum(f.get("size", 0) for f in files if f.get("type") == "file")
        except Exception:
            total_size = 0

        emit_fn({
            "type": "progress",
            "stage": "downloading",
            "percent": 0.0,
            "message": f"{model_name} 파일 목록 확인 중...",
            "totalBytes": total_size,
        })

        last_emitted_pct = -1.0
        last_emit_time = 0.0

        # tqdm_class를 직접 전달해 huggingface_hub 1.x의 바이트 단위 진행률 캡처
        try:
            from tqdm import tqdm as original_tqdm

            class ProgressTqdm(original_tqdm):
                def __init__(self, *a, **kw):
                    kw.pop("name", None)
                    kw["disable"] = False
                    super().__init__(*a, **kw)

                def display(self, msg=None, pos=None):
                    pass

                def update(self, n=1):
                    super().update(n)
                    nonlocal last_emitted_pct, last_emit_time
                    if self.unit not in ("B", "iB"):
                        return
                    downloaded_bytes = float(self.n or 0)
                    effective_total = max(float(total_size or 0), float(self.total or 0))
                    pct = min(downloaded_bytes / effective_total, 0.99) if effective_total > 0 else 0.0
                    now = time.monotonic()
                    if (pct - last_emitted_pct >= 0.01) or (now - last_emit_time >= 0.25):
                        last_emitted_pct = pct
                        last_emit_time = now
                        dl_mb = downloaded_bytes / (1024 * 1024)
                        tot_mb = effective_total / (1024 * 1024)
                        emit_fn({
                            "type": "progress",
                            "stage": "downloading",
                            "percent": round(pct, 4),
                            "message": f"{model_name} 다운로드 중 ({dl_mb:.1f} / {tot_mb:.1f} MB)",
                            "downloadedBytes": int(downloaded_bytes),
                            "totalBytes": int(effective_total),
                        })

            model_path = snapshot_download(
                repo_id=repo_id,
                local_files_only=False,
                tqdm_class=ProgressTqdm,
            )

        except Exception:
            # tqdm_class 훅 실패 시 진행률 없이 안전하게 다운로드
            emit_fn({
                "type": "progress",
                "stage": "downloading",
                "percent": 0.1,
                "message": f"{model_name} 다운로드 중... (진행률 표시 불가)",
            })
            model_path = snapshot_download(repo_id=repo_id, local_files_only=False)

        emit_fn({"type": "done", "stage": "downloaded", "model": model_name, "path": model_path})
        return 0

    except ImportError as exc:
        emit_fn({"type": "error", "message": f"huggingface_hub를 찾을 수 없습니다. faster-whisper를 재설치하세요: {str(exc)}"})
        return 1
    except Exception as exc:
        emit_fn({"type": "error", "message": f"모델 다운로드 실패: {str(exc)}"})
        return 1


def format_ort_provider(provider_name):
    if provider_name in ("DmlExecutionProvider", "CUDAExecutionProvider"):
        return "GPU"
    return "CPU"


def prepare_vocal_audio(audio_path, vocal_model_path, device, emit_fn=emit):
    """GPU VRAM 경합을 피하기 위해 Whisper 로딩 전 온디맨드 ONNX 보컬 분리를 실행하고 세션을 해제합니다."""
    if not (vocal_model_path and os.path.exists(vocal_model_path)):
        return None

    service_dir = os.path.dirname(os.path.abspath(__file__))
    if service_dir not in sys.path:
        sys.path.insert(0, service_dir)
    from vocal_separator import separate_vocals_onnx

    prepared_vocal_audio = None
    emit_fn({"type": "progress", "stage": "isolating_vocals", "percent": 0.05})
    last_pct = 0.05
    vocal_device_label = None

    def on_sep_provider(provider_name):
        nonlocal vocal_device_label
        vocal_device_label = format_ort_provider(provider_name)
        emit_fn({"type": "info", "message": f"Vocal separation provider: {provider_name} ({vocal_device_label})"})
        emit_fn({
            "type": "progress",
            "stage": "isolating_vocals",
            "percent": round(last_pct, 3),
            "deviceLabel": vocal_device_label,
        })

    def on_sep_progress(p):
        nonlocal last_pct
        mapped = 0.05 + 0.50 * max(0.0, min(1.0, p))
        if mapped - last_pct >= 0.04 or p >= 1.0:
            last_pct = mapped
            payload = {
                "type": "progress",
                "stage": "isolating_vocals",
                "percent": round(mapped, 3),
            }
            if vocal_device_label:
                payload["deviceLabel"] = vocal_device_label
            emit_fn(payload)

    try:
        separated = separate_vocals_onnx(
            audio_path,
            vocal_model_path,
            device=device,
            on_progress=on_sep_progress,
            on_provider=on_sep_provider,
        )
        if separated is not None:
            prepared_vocal_audio = separated
            emit_fn({"type": "info", "message": "ONNX vocal separation completed."})
        else:
            emit_fn({"type": "info", "message": "Vocal stem near-silent; falling back to original audio."})
    except Exception as sep_exc:
        emit_fn({"type": "info", "message": f"Vocal separation failed ({str(sep_exc)}); falling back to original audio."})
    finally:
        gc.collect()

    return prepared_vocal_audio


def detect_vocal_language(target_model, audio_input, emit_fn=emit):
    """Auto-detect language from a vocal-active mid-track slice without full transcription decoding."""
    try:
        import wave
        import numpy as np

        if isinstance(audio_input, np.ndarray):
            framerate = 16000
            nframes = audio_input.shape[0]
            duration = nframes / float(framerate)
            if duration < 45.0:
                return None, 0.0
            start_frame = int(min(45.0, duration * 0.25) * framerate)
            end_frame = min(nframes, start_frame + int(30.0 * framerate))
            mid_audio = audio_input[start_frame:end_frame]
        else:
            with wave.open(audio_input, "rb") as wf:
                if wf.getsampwidth() != 2 or wf.getnchannels() != 1 or wf.getframerate() <= 0:
                    return None, 0.0
                framerate = wf.getframerate()
                nframes = wf.getnframes()
                duration = nframes / float(framerate)
                if duration < 45.0:
                    return None, 0.0
                start_sec = min(45.0, duration * 0.25)
                start_frame = int(start_sec * framerate)
                slice_frames = min(int(30.0 * framerate), nframes - start_frame)
                if slice_frames <= 0:
                    return None, 0.0
                wf.setpos(start_frame)
                pcm_bytes = wf.readframes(slice_frames)
            mid_audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        if mid_audio.size == 0:
            return None, 0.0

        lang = None
        prob = 0.0
        if hasattr(target_model, "detect_language"):
            detected = target_model.detect_language(mid_audio)
            if isinstance(detected, tuple) and len(detected) >= 2:
                lang = detected[0]
                prob = float(detected[1] or 0.0)

        if not lang:
            probe_kwargs = dict(
                beam_size=1,
                best_of=1,
                temperature=0.0,
                without_timestamps=True,
            )
            _, probe_info = target_model.transcribe(mid_audio, vad_filter=False, **probe_kwargs)
            lang = getattr(probe_info, "language", None)
            prob = float(getattr(probe_info, "language_probability", 0.0) or 0.0)

        if lang and prob >= 0.55:
            return lang, prob
    except Exception as probe_exc:
        emit_fn({"type": "info", "message": f"Mid-track language detection skipped: {str(probe_exc)}"})
    return None, 0.0


def collect_segments(
    iter_segments,
    total_duration=0.0,
    progress_start=0.1,
    progress_end=0.98,
    device_label=None,
    emit_fn=emit,
):
    output_lines = []
    line_count = 1
    last_emitted_pct = progress_start

    for seg in iter_segments:
        words = getattr(seg, "words", None)
        if words and len(words) > 0:
            current_line_words = []

            for w in words:
                w_text = w.word.strip() if w.word else ""
                if not w_text:
                    continue

                if not current_line_words:
                    current_line_words.append(w)
                else:
                    prev_w = current_line_words[-1]
                    gap = w.start - prev_w.end

                    # 단어 간 시간 차이가 1.2초 이상이거나, 줄바꿈 힌트가 포함되거나, 텍스트가 너무 길어지면 줄 분할
                    should_split = (
                        gap >= 1.2
                        or "\n" in w.word
                        or len(" ".join([x.word.strip() for x in current_line_words])) > 45
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

        if total_duration > 0:
            seg_end = float(getattr(seg, "end", 0.0) or 0.0)
            ratio = max(0.0, min(1.0, seg_end / total_duration))
            mapped_pct = progress_start + (progress_end - progress_start) * ratio
            if mapped_pct - last_emitted_pct >= 0.02:
                last_emitted_pct = mapped_pct
                progress_payload = {
                    "type": "progress",
                    "stage": "transcribing",
                    "percent": round(mapped_pct, 3),
                }
                if device_label:
                    progress_payload["deviceLabel"] = device_label
                emit_fn(progress_payload)

    return output_lines


def check_cuda_runtime(ctranslate2_mod=None):
    """CUDA 런타임 라이브러리(cublas64_*.dll 등) 로드 가능 여부를 사전 확인합니다."""
    if ctranslate2_mod is None:
        import ctranslate2 as ctranslate2_mod

    if ctranslate2_mod.get_cuda_device_count() == 0:
        return False, "No CUDA devices detected"
    if platform.system() == "Windows":
        found_cublas = False
        for dll_name in ("cublas64_12.dll", "cublas64_11.dll"):
            try:
                ctypes.CDLL(dll_name)
                found_cublas = True
                break
            except Exception:
                pass
        if not found_cublas:
            return False, "cublas64_12.dll 또는 cublas64_11.dll을 로드할 수 없습니다"
    return True, "CUDA available"


def create_whisper_model(whisper_model_cls, model_name, device_name, compute_mode, cpu_threads):
    if device_name == "cpu":
        return whisper_model_cls(model_name, device="cpu", compute_type=compute_mode, cpu_threads=cpu_threads)
    return whisper_model_cls(model_name, device=device_name, compute_type=compute_mode)


def resolve_whisper_model(
    whisper_model_cls,
    model_name,
    device_choice,
    cpu_threads,
    cuda_ok,
    cuda_reason,
    emit_fn=emit,
):
    """요청된 장치 모드와 CUDA 가용성에 따라 WhisperModel 및 실행 장치를 결정합니다."""
    model = None
    resolved_device = "cpu"
    compute_type = "int8"
    mode_msg = "Using CPU for transcription (fallback)."

    if device_choice == "cpu":
        resolved_device = "cpu"
        compute_type = "int8"
        mode_msg = "Using CPU for transcription (forced)."
    elif device_choice == "cuda":
        if not cuda_ok:
            emit_fn({
                "type": "info",
                "message": f"GPU 가속(CUDA)이 요청되었으나 필수 런타임 라이브러리가 없어 CPU로 전환합니다 ({cuda_reason}).",
            })
            resolved_device = "cpu"
            compute_type = "int8"
            mode_msg = "Using CPU for transcription (fallback from forced CUDA)."
        else:
            resolved_device = "cuda"
            compute_type = "float16"
            mode_msg = "Using CUDA (GPU) for transcription (forced)."
    else:  # "auto"
        if cuda_ok:
            try:
                model = whisper_model_cls(model_name, device="cuda", compute_type="float16")
                resolved_device = "cuda"
                compute_type = "float16"
                mode_msg = "Using CUDA (GPU) for transcription (auto)."
            except Exception as exc:
                emit_fn({
                    "type": "info",
                    "message": f"CUDA initialization failed, falling back to CPU. Error: {str(exc)}\n{traceback.format_exc()}",
                })
                model = None
        else:
            emit_fn({
                "type": "info",
                "message": f"CUDA 미지원 또는 필수 라이브러리 부재로 CPU 모드를 사용합니다 ({cuda_reason}).",
            })

        if model is None:
            resolved_device = "cpu"
            compute_type = "int8"
            mode_msg = "Using CPU for transcription (fallback)."

    if model is None:
        model = create_whisper_model(whisper_model_cls, model_name, resolved_device, compute_type, cpu_threads)

    emit_fn({"type": "info", "message": mode_msg})
    return model, resolved_device, compute_type, mode_msg


def run_transcription(target_model, audio_input, resolved_device, args, has_vocal_audio=False, emit_fn=emit):
    """언어 자동 감지 후 Whisper 전사 및 세그먼트 수집을 수행합니다."""
    whisper_device_label = "GPU" if resolved_device == "cuda" else "CPU"
    progress_start = 0.6 if has_vocal_audio else 0.1
    emit_fn({
        "type": "progress",
        "stage": "transcribing",
        "percent": progress_start,
        "deviceLabel": whisper_device_label,
    })

    resolved_language = args.language
    if not resolved_language:
        probed_lang, probed_prob = detect_vocal_language(target_model, audio_input, emit_fn=emit_fn)
        if probed_lang:
            resolved_language = probed_lang
            emit_fn({
                "type": "info",
                "message": f"Detected vocal language from mid-track: {resolved_language} ({probed_prob:.2f})",
            })

    clean_prompt = args.initial_prompt.strip()[:120] if args.initial_prompt and args.initial_prompt.strip() else None

    iter_segments, info_obj = target_model.transcribe(
        audio_input,
        language=resolved_language,
        beam_size=args.beam_size,
        vad_filter=False,  # 노래 보컬 누락 방지를 위해 vad_filter=False 고정
        word_timestamps=True,  # 단어 단위 precise timestamp 추출
        condition_on_previous_text=False,
        temperature=(0.0, 0.2, 0.4, 0.6),
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.85,
        initial_prompt=clean_prompt,
    )
    total_duration = float(getattr(info_obj, "duration", 0.0) or 0.0)
    output_lines = collect_segments(
        iter_segments,
        total_duration=total_duration,
        progress_start=progress_start,
        progress_end=0.98,
        device_label=whisper_device_label,
        emit_fn=emit_fn,
    )

    return output_lines, info_obj


def main():
    args = parse_args()
    configure_windows_cuda_dlls()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        emit({"type": "error", "message": "faster-whisper is not installed. Run: pip install faster-whisper"})
        sys.exit(1)

    if args.download_only:
        sys.exit(download_whisper_model(args.model))

    if not args.audio_path:
        emit({"type": "error", "message": "Missing required audio_path argument."})
        sys.exit(1)

    try:
        cpu_threads = min(os.cpu_count() or 4, 8)
        prepared_vocal_audio = prepare_vocal_audio(args.audio_path, args.vocal_model, args.device)
        has_vocal_audio = prepared_vocal_audio is not None
        audio_input = prepared_vocal_audio if has_vocal_audio else args.audio_path

        emit({
            "type": "progress",
            "stage": "loading_model",
            "percent": 0.56 if has_vocal_audio else 0.0,
        })

        cuda_ok, cuda_reason = check_cuda_runtime()
        model, resolved_device, _compute_type, _mode_msg = resolve_whisper_model(
            WhisperModel,
            args.model,
            args.device,
            cpu_threads,
            cuda_ok,
            cuda_reason,
        )

        # 런타임 실행 중 예외 처리 (lazy loading으로 인한 cublas/cudnn 지연 에러 등 방어)
        try:
            lines, info = run_transcription(model, audio_input, resolved_device, args, has_vocal_audio=has_vocal_audio)
        except Exception as run_exc:
            err_str = str(run_exc).lower()
            if resolved_device == "cuda" and (
                "cublas" in err_str
                or "cudnn" in err_str
                or "cuda" in err_str
                or "out of memory" in err_str
                or isinstance(run_exc, RuntimeError)
            ):
                emit({
                    "type": "info",
                    "message": f"CUDA 추론 도중 런타임 오류 발생: {str(run_exc)}. CPU 모드로 안전하게 재시도합니다.",
                })
                try:
                    del model
                    gc.collect()
                except Exception:
                    pass
                resolved_device = "cpu"
                model = create_whisper_model(WhisperModel, args.model, "cpu", "int8", cpu_threads)
                emit({"type": "info", "message": "Using CPU for transcription (recovered from GPU error)."})
                lines, info = run_transcription(model, audio_input, resolved_device, args, has_vocal_audio=has_vocal_audio)
            else:
                raise run_exc

        for line in lines:
            emit(line)

        emit({"type": "done", "count": len(lines), "language": info.language if info else (args.language or "unknown")})

    except FileNotFoundError as exc:
        if not os.path.exists(args.audio_path):
            emit({"type": "error", "message": f"Audio file not found: {args.audio_path}"})
        else:
            emit({"type": "error", "message": f"FileNotFoundError: {str(exc)}\n{traceback.format_exc()}"})
        sys.exit(1)
    except Exception:
        emit({"type": "error", "message": traceback.format_exc()})
        sys.exit(1)


if __name__ == "__main__":
    main()
