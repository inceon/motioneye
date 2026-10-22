Camera scheduling tests use Node's built-in runner (no npm dependencies):

```sh
node --test tests/frontend/*.test.cjs
```

The browser smoke check renders the real Jinja templates and serves local assets
through Playwright routes. Camera images and API replies are fixtures; it does
not connect to a running motionEye server or change camera settings.

Install Playwright outside the repository, then run from the repository root:

```sh
npm install --prefix /tmp/motioneye-browser-tests playwright
NODE_PATH=/tmp/motioneye-browser-tests/node_modules node tests/frontend/browser-smoke.cjs
```

Jinja2 must be available to `python3`. Use `PYTHON` to select another interpreter.
Install Chromium with Playwright if needed, or set `MOTIONEYE_CHROMIUM` to an
existing executable. `MOTIONEYE_PLAYWRIGHT` can point to an installed Playwright
module. The script prints its temporary screenshot directory.

Coverage includes snapshot FPS and scheduler wake-ups, single-camera mode,
hidden-tab pause/resume, zero-FPS mode, native MJPEG initialization, embedded
server-side resizing, settings at 320–1440 px, touch slider dragging, and dialog
bounds in portrait and landscape. It fails on uncaught browser JavaScript errors.
