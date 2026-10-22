"""Render isolated frontend fixtures; no running motion daemon is required."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

from jinja2 import Environment, FileSystemLoader, select_autoescape

root = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1])
env = Environment(
    loader=FileSystemLoader(root / 'motioneye/templates'),
    autoescape=select_autoescape(['html']),
)
env.globals.update(
    _=lambda text: text,
    static_version=lambda path: 'qa',
    settings=SimpleNamespace(
        lingvo='en',
        js_translations=json.loads(
            (root / 'motioneye/static/js/motioneye.en.json').read_text()
        ),
    ),
)
base = dict(
    version='qa',
    hostname='Camera station',
    current_user='admin',
    has_motion=True,
    add_remove_cameras=True,
    mask_width=32,
    static_path='/static/',
)
(output / 'main.html').write_text(
    env.get_template('main.html').render(**base, frame=False)
)
(output / 'frame.html').write_text(
    env.get_template('main.html').render(
        **base,
        frame=True,
        camera_id=1,
        camera_config={
            'stream_maxrate': 5,
            '@webcam_server_resize': True,
            '@proto': 'netcam',
            '@url': '',
        },
    )
)
