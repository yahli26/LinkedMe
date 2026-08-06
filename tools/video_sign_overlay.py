"""Render graphics over signs tracked in a fixed 120-frame video."""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import cv2
import numpy as np

DEFAULT_SIGN_ORDER = ("right", "left", "center")
SINGLE_SIGN_TRACKING_JSON = (
    Path(__file__).resolve().parents[1]
    / "extension"
    / "assets"
    / "1_sign_track_raw_12_frames.json"
)
THREE_SIGN_TRACKING_JSON = (
    Path(__file__).resolve().parents[1]
    / "extension"
    / "assets"
    / "3_sign_tracks_corrected_12_frames.json"
)
SINGLE_SIGN_VIDEO = (
    Path(__file__).resolve().parents[1]
    / "extension"
    / "assets"
    / "1_sign_video_12_frames_final.mp4"
)
THREE_SIGN_VIDEO = (
    Path(__file__).resolve().parents[1]
    / "extension"
    / "assets"
    / "3_signs_video_12_frames_final.mp4"
)
VIDEO_FPS = 12.0
VIDEO_FRAME_COUNT = 120
FADE_FRAMES = 12
ASPECT_WINDOW = 5
ASPECT_VARIANCE_THRESHOLD = 0.0025
EDGE_EPSILON = 1.0
SMOOTHING_WINDOW = 9
EXIT_BLEND_FRAMES = 5
ICON_SIGN_SCALE = 0.75


@dataclass(frozen=True)
class TrackingMetadata:
    fps: float
    total_frames: int
    frame_width: int
    frame_height: int


@dataclass(frozen=True)
class SignPolynomial:
    cx_coeffs: tuple[float, ...]
    cy_coeffs: tuple[float, ...]
    w_coeffs: tuple[float, ...]
    h_coeffs: tuple[float, ...]
    t_start: float
    t_end: float


@dataclass(frozen=True)
class TrackingData:
    meta: TrackingMetadata
    polynomials: Mapping[str, SignPolynomial]


@dataclass(frozen=True)
class OverlayPlacement:
    sign: str
    time_s: float
    cx: float
    cy: float
    width: float
    height: float
    left: float
    top: float
    right: float
    bottom: float


@dataclass
class _TrackRenderState:
    aspect_samples: deque[float]
    stable_aspect_ratio: float | None = None
    fade_start_frame: int | None = None


@dataclass(frozen=True)
class SmoothedTrack:
    placements: Mapping[int, tuple[float, float, float, float]]
    fade_start_frame: int
    exit_start_frame: int


def _required_number(source: Mapping[str, object], key: str) -> float:
    value = source.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Tracking JSON field {key!r} must be numeric")
    return float(value)


def _load_frame_tracks(json_path: str | Path) -> tuple[TrackingMetadata, dict[str, dict[int, dict[str, object]]]]:
    path = Path(json_path)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid tracking JSON: {path}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("video"), dict):
        raise ValueError("Frame tracking JSON is missing the video object")
    raw_tracks = document.get("tracks")
    if not isinstance(raw_tracks, dict) or not raw_tracks:
        raise ValueError("Frame tracking JSON is missing the tracks object")
    video = document["video"]
    meta = TrackingMetadata(
        fps=VIDEO_FPS,
        total_frames=int(_required_number(video, "total_frames")),
        frame_width=int(_required_number(video, "width")),
        frame_height=int(_required_number(video, "height")),
    )
    if meta.total_frames != VIDEO_FRAME_COUNT:
        raise ValueError(f"Tracking data must describe exactly {VIDEO_FRAME_COUNT} frames")
    tracks: dict[str, dict[int, dict[str, object]]] = {}
    for name, samples in raw_tracks.items():
        if not isinstance(samples, list):
            raise ValueError(f"Track {name!r} must be a list")
        indexed: dict[int, dict[str, object]] = {}
        for sample in samples:
            if not isinstance(sample, dict):
                raise ValueError(f"Track {name!r} contains a non-object sample")
            frame = int(_required_number(sample, "frame"))
            if frame < 0 or frame >= VIDEO_FRAME_COUNT:
                raise ValueError(f"Track {name!r} has invalid frame {frame}")
            indexed[frame] = sample
        tracks[str(name)] = indexed
    return meta, tracks


def _coefficients(
    source: Mapping[str, object], key: str, expected_count: int
) -> tuple[float, ...]:
    values = source.get(key)
    if not isinstance(values, list) or len(values) != expected_count:
        degree = expected_count - 1
        raise ValueError(
            f"Tracking JSON field {key!r} must contain "
            f"{expected_count} degree-{degree} coefficients"
        )
    if any(
        isinstance(value, bool) or not isinstance(value, (int, float))
        for value in values
    ):
        raise ValueError(f"Tracking JSON field {key!r} has a non-numeric coefficient")
    return tuple(float(value) for value in values)


def load_tracking_data(json_path: str | Path) -> TrackingData:
    """Load metadata and polynomial models, deliberately ignoring ``signs``."""

    path = Path(json_path)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid tracking JSON: {path}") from exc

    if not isinstance(document, dict):
        raise ValueError("Tracking JSON root must be an object")
    meta_source = document.get("meta")
    polynomial_source = document.get("polynomials")
    if not isinstance(meta_source, dict):
        raise ValueError("Tracking JSON is missing the meta object")
    if not isinstance(polynomial_source, dict) or not polynomial_source:
        raise ValueError("Tracking JSON is missing the polynomials object")

    meta = TrackingMetadata(
        fps=_required_number(meta_source, "fps"),
        total_frames=int(_required_number(meta_source, "total_frames")),
        frame_width=int(_required_number(meta_source, "frame_width")),
        frame_height=int(_required_number(meta_source, "frame_height")),
    )
    if meta.fps <= 0 or min(meta.total_frames, meta.frame_width, meta.frame_height) <= 0:
        raise ValueError("Tracking metadata values must be positive")

    polynomials: dict[str, SignPolynomial] = {}
    for sign, raw_model in polynomial_source.items():
        if not isinstance(raw_model, dict):
            raise ValueError(f"Polynomial model for {sign!r} must be an object")
        model = SignPolynomial(
            cx_coeffs=_coefficients(raw_model, "cx_coeffs", 5),
            cy_coeffs=_coefficients(raw_model, "cy_coeffs", 5),
            w_coeffs=_coefficients(raw_model, "w_coeffs", 4),
            h_coeffs=_coefficients(raw_model, "h_coeffs", 4),
            t_start=_required_number(raw_model, "t_start"),
            t_end=_required_number(raw_model, "t_end"),
        )
        if model.t_start > model.t_end:
            raise ValueError(f"Polynomial model for {sign!r} has t_start after t_end")
        polynomials[str(sign)] = model

    return TrackingData(meta=meta, polynomials=polynomials)


def evaluate_polynomial(coefficients: Sequence[float], time_s: float) -> float:
    """Evaluate descending-power coefficients with Horner's method."""

    result = 0.0
    for coefficient in coefficients:
        result = result * time_s + float(coefficient)
    return result


def placement_for_time(
    sign: str, model: SignPolynomial, time_s: float
) -> OverlayPlacement | None:
    """Evaluate a sign only inside its closed fitted time domain."""

    time_s = float(time_s)
    if time_s < model.t_start or time_s > model.t_end:
        return None

    cx = evaluate_polynomial(model.cx_coeffs, time_s)
    cy = evaluate_polynomial(model.cy_coeffs, time_s)
    width = evaluate_polynomial(model.w_coeffs, time_s)
    height = evaluate_polynomial(model.h_coeffs, time_s)
    if not all(np.isfinite(value) for value in (cx, cy, width, height)):
        return None
    if width <= 0 or height <= 0:
        return None

    half_width = width * 0.5
    half_height = height * 0.5
    return OverlayPlacement(
        sign=sign,
        time_s=time_s,
        cx=cx,
        cy=cy,
        width=width,
        height=height,
        left=cx - half_width,
        top=cy - half_height,
        right=cx + half_width,
        bottom=cy + half_height,
    )


def sign_order_by_lifecycle(
    polynomials: Mapping[str, SignPolynomial],
    custom_order: Sequence[str] | None = None,
) -> list[str]:
    available = set(polynomials)
    if custom_order is not None:
        unknown = set(custom_order).difference(available)
        if unknown:
            raise ValueError(f"Custom sign order contains unknown signs: {sorted(unknown)}")
        return list(custom_order)

    ordered = [sign for sign in DEFAULT_SIGN_ORDER if sign in available]
    remaining = sorted(
        available.difference(ordered), key=lambda name: polynomials[name].t_start
    )
    return ordered + remaining


def assign_objects_to_signs(
    objects: Sequence[str | Path | np.ndarray],
    polynomials: Mapping[str, SignPolynomial],
    custom_order: Sequence[str] | None = None,
) -> dict[str, str | Path | np.ndarray]:
    order = sign_order_by_lifecycle(polynomials, custom_order)
    if len(objects) != len(order):
        raise ValueError(f"Expected {len(order)} objects for signs {order}, got {len(objects)}")
    return dict(zip(order, objects, strict=True))


def load_graphic_rgba(graphic: str | Path | np.ndarray) -> np.ndarray:
    if isinstance(graphic, np.ndarray):
        image = graphic.copy()
    else:
        image = cv2.imread(str(graphic), cv2.IMREAD_UNCHANGED)
        if image is None:
            raise FileNotFoundError(f"Could not read overlay graphic: {graphic}")

    if image.ndim != 3 or image.shape[2] not in (3, 4):
        raise ValueError("Overlay graphic must have 3 BGR/RGB or 4 BGRA/RGBA channels")
    if image.shape[2] == 3:
        alpha = np.full(image.shape[:2] + (1,), 255, dtype=image.dtype)
        image = np.concatenate([image, alpha], axis=2)
    return image


def alpha_paste_subpixel(
    frame_bgr: np.ndarray,
    overlay_bgra: np.ndarray,
    left: float,
    top: float,
    width: float,
    height: float,
    opacity: float = 1.0,
) -> np.ndarray:
    """Alpha-composite using float translation in the affine transform."""

    opacity = float(np.clip(opacity, 0.0, 1.0))
    if width <= 0 or height <= 0 or opacity <= 0:
        return frame_bgr

    frame_h, frame_w = frame_bgr.shape[:2]
    box_left, box_top = left, top
    box_right, box_bottom = left + width, top + height
    source_h, source_w = overlay_bgra.shape[:2]
    fit_scale = min(width / source_w, height / source_h)
    rendered_width = source_w * fit_scale
    rendered_height = source_h * fit_scale
    left += (width - rendered_width) * 0.5
    top += (height - rendered_height) * 0.5
    if left >= frame_w and box_left < frame_w:
        left = box_left
    elif left + rendered_width <= 0 and box_right > 0:
        left = box_right - rendered_width
    if top >= frame_h and box_top < frame_h:
        top = box_top
    elif top + rendered_height <= 0 and box_bottom > 0:
        top = box_bottom - rendered_height

    transform = np.array(
        [
            [float(fit_scale), 0.0, float(left)],
            [0.0, float(fit_scale), float(top)],
        ],
        dtype=np.float32,
    )
    layer = cv2.warpAffine(
        overlay_bgra,
        transform,
        (frame_w, frame_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )

    alpha = layer[:, :, 3:4].astype(np.float32) / 255.0 * opacity
    if not np.any(alpha):
        return frame_bgr
    base = frame_bgr.astype(np.float32)
    overlay = layer[:, :, :3].astype(np.float32)
    return np.clip(overlay * alpha + base * (1.0 - alpha), 0, 255).astype(np.uint8)


def render_frame_overlays(
    frame_bgr: np.ndarray,
    frame_index: int,
    fps: float,
    polynomials: Mapping[str, SignPolynomial],
    sign_to_graphic: Mapping[str, str | Path | np.ndarray],
    graphic_cache: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    """Evaluate and render every active sign at ``frame_index / fps``."""

    output = frame_bgr.copy()
    cache = graphic_cache if graphic_cache is not None else {}
    time_s = frame_index / fps
    for sign, graphic in sign_to_graphic.items():
        model = polynomials.get(sign)
        if model is None:
            continue
        placement = placement_for_time(sign, model, time_s)
        if placement is None:
            continue
        if sign not in cache:
            cache[sign] = load_graphic_rgba(graphic)
        scaled_width = placement.width * ICON_SIGN_SCALE
        scaled_height = placement.height * ICON_SIGN_SCALE
        output = alpha_paste_subpixel(
            output,
            cache[sign],
            placement.cx - scaled_width * 0.5,
            placement.cy - scaled_height * 0.5,
            scaled_width,
            scaled_height,
        )
    return output


def validate_source_video_grid(
    capture: cv2.VideoCapture, meta: TrackingMetadata
) -> None:
    actual = (
        float(capture.get(cv2.CAP_PROP_FPS)),
        int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
        int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    )
    expected = (meta.fps, meta.total_frames, meta.frame_width, meta.frame_height)
    if abs(actual[0] - expected[0]) > 0.1 or actual[1:] != expected[1:]:
        raise ValueError(
            "Input video does not match tracking metadata: "
            f"expected {expected[2]}x{expected[3]}, {expected[1]} frames at "
            f"{expected[0]:.6f} FPS; got {actual[2]}x{actual[3]}, "
            f"{actual[1]} frames at {actual[0]:.6f} FPS"
        )


def _frame_number(sample: Mapping[str, object], key: str) -> float:
    value = sample.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Tracking sample field {key!r} must be numeric")
    return float(value)


def _robust_smooth(values: np.ndarray, window: int = SMOOTHING_WINDOW) -> np.ndarray:
    if len(values) < 3:
        return values.copy()
    radius = min(window // 2, (len(values) - 1) // 2)
    padded = np.pad(values, radius, mode='edge')
    medians = np.asarray([np.median(padded[i:i + 2 * radius + 1]) for i in range(len(values))])
    residual = values - medians
    mad = float(np.median(np.abs(residual - np.median(residual))))
    cleaned = values.copy()
    if mad > 1e-9:
        outliers = np.abs(residual) > 3.5 * 1.4826 * mad
        cleaned[outliers] = medians[outliers]
    weights = np.arange(1, radius + 2, dtype=np.float64)
    weights = np.concatenate((weights, weights[-2::-1]))
    weights /= weights.sum()
    return np.convolve(np.pad(cleaned, radius, mode='edge'), weights, mode='valid')


def _robust_linear_slope(frames: np.ndarray, values: np.ndarray) -> float:
    if len(frames) < 2:
        return 0.0
    mask = np.ones(len(frames), dtype=bool)
    slope = 0.0
    for _ in range(3):
        if mask.sum() < 2:
            break
        slope, intercept = np.polyfit(frames[mask], values[mask], 1)
        residual = values - (slope * frames + intercept)
        mad = float(np.median(np.abs(residual[mask] - np.median(residual[mask]))))
        if mad <= 1e-9:
            break
        mask = np.abs(residual) <= 3.5 * 1.4826 * mad
    return float(slope)


def _extrapolate_exit(frames: np.ndarray, values: np.ndarray, start: int) -> None:
    fit_start = max(int(start * .45), start - max(12, int(start * .35)))
    fit_frames = frames[fit_start:start]
    anchor = values[start].copy()
    for column in range(4):
        slope = _robust_linear_slope(fit_frames, values[fit_start:start, column])
        for index in range(start, len(frames)):
            predicted = anchor[column] + slope * (frames[index] - frames[start])
            blend = min(1.0, (index - start + 1) / EXIT_BLEND_FRAMES)
            values[index, column] = (1 - blend) * values[index, column] + blend * predicted


def _track_arrays(samples: Mapping[int, Mapping[str, object]]):
    usable = sorted(f for f, s in samples.items() if not bool(s.get('occluded', False)))
    # Keep predicting after the last measurement; rendering naturally stops
    # only once the extrapolated logo has crossed the frame boundary.
    frames = np.arange(usable[0], VIDEO_FRAME_COUNT, dtype=np.float64)
    raw = np.asarray([[
        (_frame_number(samples[f], 'left') + _frame_number(samples[f], 'right')) * .5,
        (_frame_number(samples[f], 'top') + _frame_number(samples[f], 'bottom')) * .5,
        _frame_number(samples[f], 'right') - _frame_number(samples[f], 'left'),
        _frame_number(samples[f], 'bottom') - _frame_number(samples[f], 'top'),
    ] for f in usable], dtype=np.float64)
    source = np.asarray(usable, dtype=np.float64)
    values = np.column_stack([np.interp(frames, source, raw[:, c]) for c in range(4)])
    return usable, frames, np.column_stack([_robust_smooth(values[:, c]) for c in range(4)])


def build_smoothed_tracks(tracks, frame_width: int) -> dict[str, SmoothedTrack]:
    result = {}
    for sign, samples in tracks.items():
        if not any(not s.get('occluded', False) for s in samples.values()):
            continue
        usable, frames, smooth = _track_arrays(samples)
        midpoint = usable[0] + (usable[-1] - usable[0]) * .55
        bad = [f for f in usable if f >= midpoint and (samples[f].get('outside', False)
            or _frame_number(samples[f], 'left') <= EDGE_EPSILON
            or _frame_number(samples[f], 'right') >= frame_width - EDGE_EPSILON)]
        fallback = round(usable[0] + .85 * (usable[-1] - usable[0]))
        exit_index = int(np.clip((bad[0] if bad else fallback) - usable[0], 1, len(frames) - 1))
        _extrapolate_exit(frames, smooth, exit_index)
        smooth[:, 2:] = np.maximum(smooth[:, 2:], 1.0)
        result[sign] = SmoothedTrack(
            {int(f): tuple(map(float, smooth[i])) for i, f in enumerate(frames)},
            usable[0] + min(ASPECT_WINDOW - 1, len(usable) - 1), int(frames[exit_index]))
    return result


def _render_smoothed_frame(frame, frame_index, tracks, sign_to_graphic):
    output = frame.copy()
    frame_height, frame_width = frame.shape[:2]
    for sign, track in tracks.items():
        placement = track.placements.get(frame_index)
        if placement is None:
            continue
        center_x, center_y, _width, height = placement
        logo = sign_to_graphic[sign]
        logo_height = height * ICON_SIGN_SCALE
        logo_width = logo_height * logo.shape[1] / logo.shape[0]
        outside = (center_x + logo_width * .5 <= 0
            or center_x - logo_width * .5 >= frame_width
            or center_y + logo_height * .5 <= 0
            or center_y - logo_height * .5 >= frame_height)
        if outside:
            continue
        opacity = np.clip((frame_index - track.fade_start_frame) / (FADE_FRAMES - 1), 0, 1)
        output = alpha_paste_subpixel(output, logo, center_x - logo_width * .5,
            center_y - logo_height * .5, logo_width, logo_height, opacity=float(opacity))
    return output


def _render_tracked_frame(
    frame: np.ndarray,
    frame_index: int,
    tracks: Mapping[str, Mapping[int, Mapping[str, object]]],
    sign_to_graphic: Mapping[str, np.ndarray],
    states: Mapping[str, _TrackRenderState],
) -> np.ndarray:
    output = frame.copy()
    frame_height, frame_width = frame.shape[:2]
    for sign, samples in tracks.items():
        sample = samples.get(frame_index)
        if sample is None or bool(sample.get("occluded", False)):
            continue
        left = _frame_number(sample, "left")
        right = _frame_number(sample, "right")
        top = _frame_number(sample, "top")
        bottom = _frame_number(sample, "bottom")
        width, height = right - left, bottom - top
        if width <= 0 or height <= 0:
            continue

        state = states[sign]
        clipped_left = left <= EDGE_EPSILON
        clipped_right = right >= frame_width - EDGE_EPSILON
        clipped = clipped_left or clipped_right or bool(sample.get("outside", False))
        if not clipped:
            state.aspect_samples.append(width / height)
            if len(state.aspect_samples) == ASPECT_WINDOW:
                ratios = np.asarray(state.aspect_samples, dtype=np.float64)
                relative_variance = float(np.var(ratios) / max(np.mean(ratios) ** 2, 1e-12))
                if relative_variance < ASPECT_VARIANCE_THRESHOLD:
                    state.stable_aspect_ratio = float(np.mean(ratios))
                    if state.fade_start_frame is None:
                        state.fade_start_frame = frame_index
        if state.stable_aspect_ratio is None or state.fade_start_frame is None:
            continue

        center_x = (left + right) * 0.5
        if clipped_left and not clipped_right:
            center_x = right - height * state.stable_aspect_ratio * 0.5
        elif clipped_right and not clipped_left:
            center_x = left + height * state.stable_aspect_ratio * 0.5
        logo = sign_to_graphic[sign]
        logo_height = height * ICON_SIGN_SCALE
        logo_width = logo_height * logo.shape[1] / logo.shape[0]
        center_y = (top + bottom) * 0.5
        if center_x + logo_width * 0.5 <= 0 or center_x - logo_width * 0.5 >= frame_width:
            continue
        if center_y + logo_height * 0.5 <= 0 or center_y - logo_height * 0.5 >= frame_height:
            continue
        opacity = min(1.0, (frame_index - state.fade_start_frame) / (FADE_FRAMES - 1))
        output = alpha_paste_subpixel(
            output, logo, center_x - logo_width * 0.5, center_y - logo_height * 0.5,
            logo_width, logo_height, opacity=opacity,
        )
    return output


TrackRenderState = _TrackRenderState
render_tracked_frame = _render_tracked_frame
render_smoothed_frame = _render_smoothed_frame

def process_video_with_sign_overlays(
    input_video: str | Path | None,
    output_video: str | Path,
    objects: Sequence[str | Path | np.ndarray],
    tracking_json: str | Path | None = None,
    custom_order: Sequence[str] | None = None,
    codec: str = "mp4v",
    *,
    single_item_mode: bool = False,
    tracking_method: str = 'raw',
) -> Path:
    """Overlay logos using matching frame tracks and source video.

    ``single_item_mode`` mirrors the UI toggle. If ``input_video`` is omitted,
    the packaged 1-sign or 3-sign video is selected automatically; an explicit
    video path remains supported and is checked against the selected metadata.
    """

    selected_json = Path(tracking_json) if tracking_json is not None else (
        SINGLE_SIGN_TRACKING_JSON if single_item_mode else THREE_SIGN_TRACKING_JSON
    )
    selected_video = Path(input_video) if input_video is not None else (
        SINGLE_SIGN_VIDEO if single_item_mode else THREE_SIGN_VIDEO
    )
    meta, tracks = _load_frame_tracks(selected_json)
    if tracking_method not in ('raw', 'smoothed_extrapolated'):
        raise ValueError('tracking_method must be raw or smoothed_extrapolated')
    smooth = None
    order = list(custom_order) if custom_order is not None else list(tracks)
    if set(order) != set(tracks) or len(order) != len(tracks):
        raise ValueError(f"Custom sign order must contain exactly {list(tracks)}")
    if len(objects) != len(order):
        raise ValueError(
            f"Expected {len(order)} logo(s) for signs {order}, got {len(objects)}"
        )
    sign_to_graphic = {
        sign: load_graphic_rgba(graphic)
        for sign, graphic in zip(order, objects, strict=True)
    }

    capture = cv2.VideoCapture(str(selected_video))
    if not capture.isOpened():
        raise FileNotFoundError(f"Could not open input video: {selected_video}")
    try:
        validate_source_video_grid(capture, meta)
    except ValueError:
        capture.release()
        raise
    writer = cv2.VideoWriter(
        str(output_video), cv2.VideoWriter_fourcc(*codec), meta.fps,
        (meta.frame_width, meta.frame_height),
    )
    if not writer.isOpened():
        capture.release()
        raise OSError(f"Could not open output video for writing: {output_video}")

    from .tracking_raw import TrackRenderState, render_tracked_frame
    states = {sign: TrackRenderState(deque(maxlen=ASPECT_WINDOW)) for sign in tracks}
    if tracking_method == 'smoothed_extrapolated':
        from .tracking_smoothed import build_smoothed_tracks as build_smoothed_strategy
        from .tracking_smoothed import render_smoothed_frame as render_smoothed_strategy
    else:
        build_smoothed_strategy = None
        render_smoothed_strategy = None
    if build_smoothed_strategy is not None:
        smooth = build_smoothed_strategy(tracks, meta.frame_width)
    try:
        for frame_index in range(meta.total_frames):
            ok, frame = capture.read()
            if not ok:
                raise ValueError(f"Input video ended before metadata frame {meta.total_frames}")
            if smooth is not None:
                rendered = render_smoothed_strategy(frame, frame_index, smooth, sign_to_graphic)
            else:
                rendered = render_tracked_frame(frame, frame_index, tracks, sign_to_graphic, states)
            writer.write(rendered)
    finally:
        capture.release()
        writer.release()
    return Path(output_video)
