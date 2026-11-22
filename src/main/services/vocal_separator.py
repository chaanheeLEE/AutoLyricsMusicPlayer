import io
import os
import wave
import numpy as np


def _make_hann_window(n_fft: int) -> np.ndarray:
    """Periodic Hann window matching torch.hann_window(n_fft, periodic=True)."""
    return np.hanning(n_fft + 1)[:-1].astype(np.float32)


def stft_stereo(audio: np.ndarray, n_fft: int = 7680, hop_length: int = 1024, window: np.ndarray = None):
    """Compute center-padded STFT for (2, samples) float32 stereo audio."""
    if window is None:
        window = _make_hann_window(n_fft)

    pad = n_fft // 2
    num_samples = audio.shape[1]
    pad_mode = "reflect" if num_samples > pad else "constant"
    padded = np.pad(audio, ((0, 0), (pad, pad)), mode=pad_mode)

    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft, axis=-1)[:, ::hop_length, :]
    windowed = frames.astype(np.float32, copy=False) * window
    spec = np.fft.rfft(windowed, n=n_fft, axis=-1)
    # Return shape: (channels, freq_bins, num_frames)
    return np.transpose(spec, (0, 2, 1))


def istft_stereo(
    spec: np.ndarray,
    n_fft: int = 7680,
    hop_length: int = 1024,
    length: int = None,
    window: np.ndarray = None,
) -> np.ndarray:
    """Invert center-padded STFT back to (2, samples) float32 stereo audio via overlap-add."""
    if window is None:
        window = _make_hann_window(n_fft)

    channels, _freq_bins, num_frames = spec.shape
    spec_t = np.transpose(spec, (0, 2, 1))
    time_frames = (np.fft.irfft(spec_t, n=n_fft, axis=-1) * window).astype(np.float32, copy=False)

    y_len = n_fft + (num_frames - 1) * hop_length
    y = np.zeros((channels, y_len), dtype=np.float32)
    wsum = np.zeros(y_len, dtype=np.float32)
    win_sq = window * window

    for idx in range(num_frames):
        pos = idx * hop_length
        y[:, pos : pos + n_fft] += time_frames[:, idx, :]
        wsum[pos : pos + n_fft] += win_sq

    valid = wsum > 1e-8
    y[:, valid] /= wsum[valid]

    pad = n_fft // 2
    y = y[:, pad:]
    if length is not None:
        if y.shape[1] >= length:
            y = y[:, :length]
        else:
            y = np.pad(y, ((0, 0), (0, length - y.shape[1])), mode="constant")
    return y


def _read_stereo_wav_44k(wav_path: str) -> tuple[np.ndarray, int]:
    """Read 16-bit PCM WAV into (2, N) float32 array in [-1.0, 1.0]."""
    with wave.open(wav_path, "rb") as wf:
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        if sampwidth != 2 or framerate <= 0 or nframes <= 0:
            raise ValueError(f"Unsupported WAV format: channels={channels}, sampwidth={sampwidth}, sr={framerate}")
        raw = wf.readframes(nframes)

    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels == 1:
        stereo = np.stack([pcm, pcm], axis=0)
    else:
        reshaped = pcm.reshape(-1, channels).T
        stereo = reshaped[:2, :]
    return stereo, framerate


def _resample_mono_to_16k(mono_audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Resample mono float32 waveform to 16kHz float32 using bundled faster_whisper audio decoder."""
    if sample_rate == 16000:
        return mono_audio.astype(np.float32, copy=False)

    from faster_whisper.audio import decode_audio

    clipped = np.clip(mono_audio, -1.0, 1.0)
    int16_pcm = (clipped * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int16_pcm.tobytes())

    buf.seek(0)
    return decode_audio(buf, sampling_rate=16000).astype(np.float32, copy=False)


def separate_vocals_onnx(
    wav_path: str,
    model_path: str,
    device: str = "auto",
    on_progress=None,
    on_provider=None,
):
    """
    Separate vocals from a 44.1kHz stereo WAV using an MDX-Net ONNX model (e.g. UVR-MDX-NET-Voc_FT.onnx).
    Returns 16kHz mono float32 waveform ready for WhisperModel.transcribe, or None if vocal stem is near-silent.
    """
    import onnxruntime as ort

    audio, sr = _read_stereo_wav_44k(wav_path)
    total_samples = audio.shape[1]
    if total_samples == 0:
        return None

    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = min(os.cpu_count() or 4, 8)
    sess_options.inter_op_num_threads = 1

    available = ort.get_available_providers()
    providers = []
    if device != "cpu":
        for preferred in ("CUDAExecutionProvider", "DmlExecutionProvider"):
            if preferred in available:
                providers.append(preferred)
    providers.append("CPUExecutionProvider")

    if "DmlExecutionProvider" in providers:
        sess_options.enable_mem_pattern = False
        sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

    try:
        session = ort.InferenceSession(model_path, sess_options=sess_options, providers=providers)
    except Exception:
        if providers == ["CPUExecutionProvider"]:
            raise
        cpu_opts = ort.SessionOptions()
        cpu_opts.intra_op_num_threads = min(os.cpu_count() or 4, 8)
        cpu_opts.inter_op_num_threads = 1
        session = ort.InferenceSession(model_path, sess_options=cpu_opts, providers=["CPUExecutionProvider"])

    active_providers = session.get_providers()
    if on_provider is not None and active_providers:
        on_provider(active_providers[0])
    input_meta = session.get_inputs()[0]
    input_name = input_meta.name
    output_name = session.get_outputs()[0].name
    input_shape = input_meta.shape

    n_fft = 7680
    hop_length = 1024
    dim_f = int(input_shape[2]) if len(input_shape) >= 3 and isinstance(input_shape[2], int) else 3072
    dim_t = int(input_shape[3]) if len(input_shape) >= 4 and isinstance(input_shape[3], int) else 256
    freq_bins = n_fft // 2 + 1
    window = _make_hann_window(n_fft)

    chunk_samples = hop_length * (dim_t - 1)
    margin = (dim_t // 12) * hop_length
    step = chunk_samples - 2 * margin
    if step <= 0:
        margin = 0
        step = chunk_samples

    num_chunks = max(1, (total_samples + step - 1) // step)
    pad_right = max(0, margin + (num_chunks - 1) * step + chunk_samples - (total_samples + margin))
    padded_mix = np.pad(audio, ((0, 0), (margin, pad_right)), mode="constant")

    vocal_stereo = np.zeros((2, total_samples), dtype=np.float32)

    for idx in range(num_chunks):
        start = idx * step
        chunk = padded_mix[:, start : start + chunk_samples]
        spec = stft_stereo(chunk, n_fft=n_fft, hop_length=hop_length, window=window)
        cropped = spec[:, :dim_f, :]

        # Stack into [1, 4, dim_f, dim_t]: [L_real, L_imag, R_real, R_imag]
        ort_input = np.stack(
            [cropped[0].real, cropped[0].imag, cropped[1].real, cropped[1].imag],
            axis=0,
        )[np.newaxis, :, :, :].astype(np.float32)

        pred = session.run([output_name], {input_name: ort_input})[0][0]

        pred_left = pred[0] + 1j * pred[1]
        pred_right = pred[2] + 1j * pred[3]
        pred_complex = np.stack([pred_left, pred_right], axis=0)

        if dim_f < freq_bins:
            pred_complex = np.pad(
                pred_complex,
                ((0, 0), (0, freq_bins - dim_f), (0, 0)),
                mode="constant",
            )

        vocal_chunk = istft_stereo(
            pred_complex,
            n_fft=n_fft,
            hop_length=hop_length,
            length=chunk_samples,
            window=window,
        )

        valid_interior = vocal_chunk[:, margin : margin + step]
        out_start = idx * step
        out_end = min(total_samples, out_start + step)
        copy_len = out_end - out_start
        if copy_len > 0:
            vocal_stereo[:, out_start:out_end] = valid_interior[:, :copy_len]

        if on_progress is not None:
            on_progress((idx + 1) / float(num_chunks))

    mono_vocal = np.mean(vocal_stereo, axis=0)
    rms = float(np.sqrt(np.mean(mono_vocal * mono_vocal)))
    if rms < 1e-4:
        return None

    return _resample_mono_to_16k(mono_vocal, sr)
