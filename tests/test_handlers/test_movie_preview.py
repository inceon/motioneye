from __future__ import annotations

import threading
from unittest.mock import patch

from tornado.ioloop import IOLoop
from tornado.testing import gen_test

from motioneye.handlers.movie import MovieHandler
from tests.test_handlers import HandlerTestCase


class MoviePreviewTest(HandlerTestCase):
    handler_cls = MovieHandler

    @gen_test
    async def test_thumbnail_generation_does_not_block_the_event_loop(self):
        released = threading.Event()

        def preview(*args, **kwargs):
            # The event-loop callback must run while thumbnail work is pending.
            return b'jpeg' if released.wait(1) else b'blocked'

        IOLoop.current().call_later(0.02, released.set)
        with patch('motioneye.mediafiles.get_media_preview', side_effect=preview):
            response = await self.http_client.fetch(
                self.get_url('/movie/1/preview/movie.mp4'),
                headers={'Cookie': self.make_session_cookie('admin')},
            )
        self.assertEqual(b'jpeg', response.body)
        self.assertEqual('image/jpeg', response.headers['Content-Type'])
