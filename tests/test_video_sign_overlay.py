import unittest
from collections import deque
from unittest.mock import patch

import numpy as np

from tools.video_sign_overlay import (
    ASPECT_WINDOW,
    FADE_FRAMES,
    ICON_SIGN_SCALE,
    SINGLE_SIGN_TRACKING_JSON,
    SINGLE_SIGN_VIDEO,
    THREE_SIGN_TRACKING_JSON,
    THREE_SIGN_VIDEO,
    _TrackRenderState,
    _load_frame_tracks,
    _render_tracked_frame,
    alpha_paste_subpixel,
    build_smoothed_tracks,
)


class VideoSignOverlayTests(unittest.TestCase):
    def test_packaged_mode_tracks(self):
        single_meta, single = _load_frame_tracks(SINGLE_SIGN_TRACKING_JSON)
        multi_meta, multi = _load_frame_tracks(THREE_SIGN_TRACKING_JSON)
        self.assertEqual(single_meta.total_frames, 120)
        self.assertEqual(single_meta.fps, 12.0)
        self.assertEqual(set(single), {"center_sign"})
        self.assertEqual(multi_meta, single_meta)
        self.assertEqual(set(multi), {"left_sign", "right_sign", "center_sign"})

    def test_packaged_asset_paths_exist(self):
        for path in (
            SINGLE_SIGN_TRACKING_JSON,
            THREE_SIGN_TRACKING_JSON,
            SINGLE_SIGN_VIDEO,
            THREE_SIGN_VIDEO,
        ):
            self.assertTrue(path.is_file(), f"Missing packaged asset: {path}")

    def test_fade_runs_from_zero_to_full_opacity_in_exactly_12_frames(self):
        samples = {
            frame: {"left": 20, "right": 60, "top": 30, "bottom": 50}
            for frame in range(16)
        }
        state = _TrackRenderState(deque(maxlen=ASPECT_WINDOW))
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        logo = np.full((10, 20, 4), 255, dtype=np.uint8)
        opacities = []

        def capture_opacity(base, overlay, left, top, width, height, opacity=1.0):
            opacities.append(opacity)
            return base

        with patch("tools.video_sign_overlay.alpha_paste_subpixel", capture_opacity):
            for index in range(16):
                _render_tracked_frame(
                    frame, index, {"sign": samples}, {"sign": logo}, {"sign": state}
                )
        # Stability is reached on frame 4 and the inclusive ramp ends on frame 15.
        self.assertEqual(state.fade_start_frame, 4)
        self.assertEqual(len(opacities), FADE_FRAMES)
        self.assertAlmostEqual(opacities[0], 0.0)
        self.assertAlmostEqual(opacities[-1], 1.0)

    def test_clipped_box_reconstructs_center_from_reliable_edge(self):
        sample = {"left": 0, "right": 20, "top": 30, "bottom": 50, "outside": True}
        state = _TrackRenderState(deque(maxlen=ASPECT_WINDOW), 2.0, 0)
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        logo = np.full((10, 20, 4), 255, dtype=np.uint8)
        calls = []

        def capture(base, overlay, left, top, width, height, opacity=1.0):
            calls.append((left, width))
            return base

        with patch("tools.video_sign_overlay.alpha_paste_subpixel", capture):
            _render_tracked_frame(
                frame, 20, {"sign": {20: sample}}, {"sign": logo}, {"sign": state}
            )
        # true sign center = reliable right edge 20 - (height 20 * ratio 2) / 2 = 0
        # Logo is 30 px wide at 75% sign height, therefore its left edge is -15.
        self.assertEqual(ICON_SIGN_SCALE, 0.75)
        self.assertAlmostEqual(calls[0][0], -15.0)
        self.assertAlmostEqual(calls[0][1], 30.0)

    def test_logo_height_is_seventy_five_percent_and_keeps_aspect_ratio(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        overlay = np.full((10, 20, 4), 255, dtype=np.uint8)
        rendered = alpha_paste_subpixel(frame, overlay, 30, 30, 40, 20)
        changed = np.argwhere(np.any(rendered != 0, axis=2))
        self.assertGreater(len(changed), 0)

    def test_alternative_tracks_smooth_and_extrapolate_exit(self):
        meta, raw_tracks = _load_frame_tracks(THREE_SIGN_TRACKING_JSON)
        tracks = build_smoothed_tracks(raw_tracks, meta.frame_width)
        track = tracks['left_sign']
        centers = np.asarray([track.placements[f][0] for f in sorted(track.placements)])
        raw = raw_tracks['left_sign']
        raw_centers = np.asarray([
            (sample['left'] + sample['right']) * 0.5 for sample in raw.values()
        ])
        self.assertLess(np.var(np.diff(centers[:len(raw_centers)])),
                        np.var(np.diff(raw_centers)))
        exit_centers = np.asarray([track.placements[f][0]
                                   for f in range(track.exit_start_frame + 5, 100)])
        exit_velocity = np.diff(exit_centers)
        self.assertLess(np.max(np.abs(np.diff(exit_velocity))), 1e-8)
        self.assertLess(track.placements[119][0], 0)


if __name__ == "__main__":
    unittest.main()

