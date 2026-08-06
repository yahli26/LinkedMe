"""Higher-stability tracking strategy for rendered sign overlays."""

from __future__ import annotations

from typing import Mapping

import numpy as np

from .video_sign_overlay import (
    ASPECT_WINDOW,
    EDGE_EPSILON,
    VIDEO_FRAME_COUNT,
    SmoothedTrack,
    _extrapolate_exit,
    _frame_number,
    _robust_smooth,
    render_smoothed_frame,
)


# This is an offline, centered filter, so it does not add playback latency.
# Keep it odd so every frame has a unique center sample.
SMOOTHING_WINDOW = 11


def _track_arrays(samples: Mapping[int, Mapping[str, object]]):
    usable = sorted(
        frame for frame, sample in samples.items()
        if not bool(sample.get("occluded", False))
    )
    # Keep predicting after the last measurement; rendering naturally stops
    # only once the extrapolated logo has crossed the frame boundary.
    frames = np.arange(usable[0], VIDEO_FRAME_COUNT, dtype=np.float64)
    raw = np.asarray(
        [
            [
                (_frame_number(samples[frame], "left")
                 + _frame_number(samples[frame], "right")) * 0.5,
                (_frame_number(samples[frame], "top")
                 + _frame_number(samples[frame], "bottom")) * 0.5,
                _frame_number(samples[frame], "right")
                - _frame_number(samples[frame], "left"),
                _frame_number(samples[frame], "bottom")
                - _frame_number(samples[frame], "top"),
            ]
            for frame in usable
        ],
        dtype=np.float64,
    )
    source = np.asarray(usable, dtype=np.float64)
    values = np.column_stack(
        [np.interp(frames, source, raw[:, column]) for column in range(4)]
    )
    return usable, frames, np.column_stack(
        [
            _robust_smooth(values[:, column], window=SMOOTHING_WINDOW)
            for column in range(4)
        ]
    )


def build_smoothed_tracks(
    tracks, frame_width: int
) -> dict[str, SmoothedTrack]:
    """Build tracks with stronger temporal smoothing for video playback."""

    result = {}
    for sign, samples in tracks.items():
        if not any(
            not sample.get("occluded", False)
            for sample in samples.values()
        ):
            continue

        usable, frames, smooth = _track_arrays(samples)
        midpoint = usable[0] + (usable[-1] - usable[0]) * 0.55
        bad = [
            frame
            for frame in usable
            if frame >= midpoint
            and (
                samples[frame].get("outside", False)
                or _frame_number(samples[frame], "left") <= EDGE_EPSILON
                or _frame_number(samples[frame], "right")
                >= frame_width - EDGE_EPSILON
            )
        ]
        fallback = round(usable[0] + 0.85 * (usable[-1] - usable[0]))
        exit_index = int(
            np.clip(
                (bad[0] if bad else fallback) - usable[0],
                1,
                len(frames) - 1,
            )
        )
        _extrapolate_exit(frames, smooth, exit_index)
        smooth[:, 2:] = np.maximum(smooth[:, 2:], 1.0)
        result[sign] = SmoothedTrack(
            {
                int(frame): tuple(map(float, smooth[index]))
                for index, frame in enumerate(frames)
            },
            usable[0] + min(ASPECT_WINDOW - 1, len(usable) - 1),
            int(frames[exit_index]),
        )
    return result
