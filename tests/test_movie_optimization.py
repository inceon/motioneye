from __future__ import annotations

import os
import struct
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from tornado.web import HTTPError

from motioneye import mediafiles


def atom(kind, payload=b''):
    return struct.pack('>I4s', 8 + len(payload), kind) + payload


class MovieOptimizationTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name, 'movie.mp4')
        self.config = {'target_dir': self.directory.name}
        self.original = atom(b'ftyp') + atom(b'mdat', b'video') + atom(b'moov')
        self.optimized = atom(b'ftyp') + atom(b'moov') + atom(b'mdat', b'video')
        self.path.write_bytes(self.original)

    def test_atom_inspection_handles_order_extended_size_and_corruption(self):
        self.assertTrue(mediafiles._needs_faststart(str(self.path)))
        self.path.write_bytes(self.optimized)
        self.assertFalse(mediafiles._needs_faststart(str(self.path)))
        self.path.write_bytes(struct.pack('>I4sQ', 1, b'mdat', 16) + atom(b'moov'))
        self.assertTrue(mediafiles._needs_faststart(str(self.path)))
        for invalid in (
            b'',
            b'garbage',
            struct.pack('>I4s', 1, b'mdat'),
            struct.pack('>I4s', 100, b'moov'),
        ):
            self.path.write_bytes(invalid)
            self.assertIsNone(mediafiles._needs_faststart(str(self.path)))

    def test_remux_is_atomic_preserves_metadata_and_skips_a_second_pass(self):
        os.chmod(self.path, 0o640)
        before = self.path.stat()

        def remux(cmd, **kwargs):
            self.assertEqual(self.original, self.path.read_bytes())
            Path(cmd[-1]).write_bytes(self.optimized)

        with patch('motioneye.utils.call_subprocess', side_effect=remux) as run:
            self.assertTrue(mediafiles.optimize_movie(self.config, 'movie.mp4'))
            self.assertFalse(mediafiles.optimize_movie(self.config, 'movie.mp4'))
            run.assert_called_once()
        self.assertEqual(self.optimized, self.path.read_bytes())
        self.assertEqual(before.st_mtime_ns, self.path.stat().st_mtime_ns)
        self.assertEqual(0o640, self.path.stat().st_mode & 0o777)
        self.assertEqual(['movie.mp4'], os.listdir(self.directory.name))

    def test_timeout_keeps_original_and_removes_partial_output(self):
        with patch(
            'motioneye.utils.call_subprocess',
            side_effect=subprocess.TimeoutExpired('ffmpeg', 60),
        ):
            self.assertFalse(mediafiles.optimize_movie(self.config, 'movie.mp4'))
        self.assertEqual(self.original, self.path.read_bytes())
        self.assertEqual(['movie.mp4'], os.listdir(self.directory.name))

    def test_invalid_output_keeps_original(self):
        with patch('motioneye.utils.call_subprocess'):
            self.assertFalse(mediafiles.optimize_movie(self.config, 'movie.mp4'))
        self.assertEqual(self.original, self.path.read_bytes())

    def test_recording_changed_during_remux_is_not_replaced(self):
        def remux(cmd, **kwargs):
            Path(cmd[-1]).write_bytes(self.optimized)
            self.path.write_bytes(self.original + atom(b'free'))

        with patch('motioneye.utils.call_subprocess', side_effect=remux):
            self.assertFalse(mediafiles.optimize_movie(self.config, 'movie.mp4'))
        self.assertEqual(self.original + atom(b'free'), self.path.read_bytes())

    def test_rejects_path_traversal(self):
        with self.assertRaises(HTTPError):
            mediafiles.optimize_movie(self.config, '../movie.mp4')

    def test_thumbnail_timeout_does_not_publish_a_partial_jpeg(self):
        def timeout(cmd, **kwargs):
            Path(cmd[-1]).write_bytes(b'partial jpeg')
            raise subprocess.TimeoutExpired('ffmpeg', 15)

        config = dict(self.config, framerate=2, pre_capture=1)
        with (
            patch('motioneye.mediafiles.get_movie_duration_seconds', return_value=10),
            patch('motioneye.utils.call_subprocess', side_effect=timeout),
        ):
            self.assertIsNone(mediafiles.make_movie_preview(config, 'movie.mp4'))
        self.assertFalse(Path(str(self.path) + '.thumb').exists())
        self.assertEqual(['movie.mp4'], os.listdir(self.directory.name))
