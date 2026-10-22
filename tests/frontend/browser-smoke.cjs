const fs = require('fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.MOTIONEYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../..');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'motioneye-browser-'));
execFileSync(process.env.PYTHON || 'python3', [path.join(__dirname, 'render_fixture.py'), artifacts]);
const camera = {
    id: 1,
    name: 'Entrance',
    enabled: true,
    proto: 'netcam',
    streaming_framerate: 5,
    streaming_server_resize: true,
    actions: ['snapshot', 'record', 'up', 'down'],
    width: 1280,
    height: 720,
};
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.MOTIONEYE_CHROMIUM, headless: true });
    try {
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        let frames = 0;
        let requestsByCamera = {};
        let streams = 0;
        await page.route('http://motioneye.test/**', async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/static/')) {
                const file = root + '/motioneye' + url.pathname;
                if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
                if (url.pathname === '/static/js/main.js') {
                    const body = fs
                        .readFileSync(file, 'utf8')
                        .replace(
                            'function refreshCameraFrames(timestamp) {',
                            'function refreshCameraFrames(timestamp) { window.__ticks = (window.__ticks || 0) + 1;',
                        );
                    return route.fulfill({ contentType: 'text/javascript', body });
                }
                return route.fulfill({ path: file });
            }
            if (url.pathname === '/' || url.pathname === '/picture/1/frame/')
                return route.fulfill({
                    contentType: 'text/html',
                    body: fs.readFileSync(
                        path.join(artifacts, (url.pathname === '/' ? 'main' : 'frame') + '.html'),
                        'utf8',
                    ),
                });
            if (
                url.pathname.includes('/current/') ||
                url.pathname === '/native-stream' ||
                url.pathname.includes('/preview')
            ) {
                if (url.pathname === '/native-stream') streams++;
                else if (url.pathname.includes('/current/')) {
                    frames++;
                    const id = url.pathname.split('/')[2];
                    requestsByCamera[id] = (requestsByCamera[id] || 0) + 1;
                }
                return route.fulfill({
                    contentType: 'image/svg+xml',
                    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#354b48"/><path d="M0 600 L500 100 L1280 600" fill="#52756a"/><text x="60" y="650" fill="white" font-size="50">Entrance · test camera</text></svg>',
                });
            }
            let data = {};
            if (url.pathname === '/login/') data = { user: 'admin' };
            if (url.pathname === '/prefs/')
                data = {
                    layout_columns: 2,
                    fit_frames_vertically: false,
                    layout_rows: 1,
                    framerate_factor: 1,
                    resolution_factor: 1,
                    camera_order: [1, 2],
                };
            if (url.pathname === '/config/list/') data = { cameras: [] };
            if (url.pathname === '/movie/1/list/')
                data = {
                    mediaList: [
                        {
                            path: '/2026-10-22/entrance.mp4',
                            mimeType: 'video/mp4',
                            timestamp: 1792690000,
                            momentStr: '2026-10-22 18:00',
                            momentStrShort: '18:00',
                            sizeStr: '3 MB',
                        },
                        {
                            path: '/2026-10-21/garden.mp4',
                            mimeType: 'video/mp4',
                            timestamp: 1792600000,
                            momentStr: '2026-10-21 18:00',
                            momentStrShort: '18:00',
                            sizeStr: '2 MB',
                        },
                    ],
                };
            return route.fulfill({ json: data });
        });
        await page.goto('http://motioneye.test/');
        await page.waitForFunction(() => typeof initialConfigFetched !== 'undefined' && initialConfigFetched);
        await page.waitForTimeout(400);
        await page.evaluate((camera) => {
            $('#cameraSelect').html(
                '<option value="1">Entrance</option><option value="2">Garden</option><option value="add">Add Camera</option>',
            );
            recreateCameraFrames([camera, { ...camera, id: 2, name: 'Garden' }]);
        }, camera);
        await page.waitForTimeout(1000);
        const before = frames;
        const ticksBefore = await page.evaluate(() => window.__ticks);
        await page.waitForTimeout(2200);
        assert.ok(
            frames - before >= 18 && frames - before <= 26,
            `two 5-FPS cameras requested ${frames - before} frames in 2.2 s`,
        );
        const ticks = (await page.evaluate(() => window.__ticks)) - ticksBefore;
        assert.ok(ticks <= 16, `5-FPS scheduler woke ${ticks} times in 2.2 seconds`);
        const displayedFps = parseFloat(await page.locator('#camera1 .camera-fps span').textContent());
        assert.ok(
            displayedFps >= 4 && displayedFps <= 5.5,
            `FPS display matches delivered frames: ${displayedFps}`,
        );
        const ratio = await page.evaluate(() => cameraFrameRatios[1]);
        assert.equal(ratio, 720 / 1280, 'layout ratio updates when a frame loads');
        console.log('camera scheduler', { ticks, requests: frames - before, displayedFps });
        await page.evaluate(() => doSingleViewCamera(1));
        await page.waitForTimeout(400);
        const otherCameraRequests = requestsByCamera[2];
        await page.waitForTimeout(500);
        assert.equal(requestsByCamera[2], otherCameraRequests, 'single view pauses other cameras');
        await page.evaluate(() => doExitSingleViewCamera());
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(100);
        const hiddenRequests = frames;
        await page.waitForTimeout(400);
        assert.equal(frames, hiddenRequests, 'hidden tab stops snapshots');
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(400);
        assert.ok(frames > hiddenRequests, 'visible tab resumes snapshots');
        await page.evaluate(() => {
            framerateFactor = 0;
        });
        await page.waitForTimeout(300);
        const pausedRequests = frames;
        await page.waitForTimeout(400);
        assert.equal(frames, pausedRequests, 'zero FPS stops further snapshots');
        await page.evaluate(() => {
            framerateFactor = 1;
        });
        await page.waitForTimeout(1100);
        await page.evaluate(
            (camera) =>
                recreateCameraFrames([
                    { ...camera, proto: 'mjpeg', url: 'http://motioneye.test/native-stream' },
                ]),
            camera,
        );
        await page.waitForTimeout(1200);
        assert.equal(streams, 1, 'native MJPEG URL is assigned once');
        await page.evaluate(
            (camera) => recreateCameraFrames([camera, { ...camera, id: 2, name: 'Garden' }]),
            camera,
        );
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
        await page.evaluate(() => openSettings());
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(artifacts, 'settings.png'), fullPage: true });
        for (const width of [320, 390, 600, 768, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await page.waitForTimeout(250);
            await page.evaluate(() => {
                showApply();
                $('.settings').scrollTop(0);
            });
            await page.waitForTimeout(300);
            const metrics = await page.evaluate(() => {
                const settings = document.querySelector('div.settings');
                const select = document.querySelector('#cameraSelect').getBoundingClientRect();
                const apply = document.querySelector('#applyButton').getBoundingClientRect();
                return {
                    width: innerWidth,
                    document: document.documentElement.scrollWidth,
                    panel: settings.clientWidth,
                    scroll: settings.scrollWidth,
                    select: select.width,
                    apply: apply.right,
                };
            });
            console.log('settings', metrics);
            assert.ok(metrics.document <= width, 'page overflow at ' + width);
            assert.ok(metrics.scroll <= metrics.panel + 1, 'settings overflow at ' + width);
            assert.ok(metrics.select >= 50, 'camera selector reachable at ' + width);
            assert.ok(metrics.apply <= width, 'apply reachable at ' + width);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(artifacts, 'settings.png') });
        // Drag the FPS slider with actual touch events, then check its hidden input.
        const bar = await page.locator('#framerateDimmerSlider + .slider .slider-bar').boundingBox();
        const cdp = await context.newCDPSession(page);
        const point = { x: bar.x + bar.width * 0.25, y: bar.y + 12 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...point, x: bar.x + bar.width * 0.65 }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const sliderValue = await page.locator('#framerateDimmerSlider').inputValue();
        assert.ok(Number(sliderValue) > 50 && Number(sliderValue) < 80, 'touch slider value ' + sliderValue);
        console.log('touch slider', sliderValue);
        await page.evaluate(() => {
            closeSettings();
            runAddCameraDialog();
        });
        await page.waitForTimeout(350);
        for (const size of [
            { width: 320, height: 568 },
            { width: 390, height: 400 },
            { width: 844, height: 390 },
        ]) {
            await page.setViewportSize(size);
            await page.waitForTimeout(250);
            const rect = await page.locator('.modal-container').boundingBox();
            console.log('add camera dialog', size, rect);
            assert.ok(
                rect.x >= 0 &&
                    rect.y >= 0 &&
                    rect.x + rect.width <= size.width + 1 &&
                    rect.y + rect.height <= size.height + 1,
            );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        await page.locator('#typeSelect').selectOption('netcam');
        await page.waitForTimeout(200);
        const field = await page.locator('#urlEntry').boundingBox();
        assert.ok(field.width > 250, 'network camera URL field stays readable');
        await page.screenshot({ path: path.join(artifacts, 'add-camera.png') });
        await page.evaluate(() => hideModalDialog());
        await page.waitForTimeout(250);
        await page.evaluate(() => showCameraOverlay());
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(artifacts, 'controls.png') });
        await page.evaluate(() => runMediaDialog(1, 'movie'));
        await page.waitForFunction(() => document.querySelector('.media-list-entry'));
        await page.waitForTimeout(250);
        const mediaRect = await page.locator('.modal-container').boundingBox();
        assert.ok(mediaRect.x >= 0 && mediaRect.x + mediaRect.width <= 391);
        await page.screenshot({ path: path.join(artifacts, 'media.png') });
        await page.evaluate(() => hideModalDialog());
        await page.waitForTimeout(250);
        await page.evaluate(() => runLoginDialog(() => {}));
        await page.waitForTimeout(250);
        const loginField = await page.locator('#usernameEntry').boundingBox();
        assert.ok(loginField.width > 250, 'login input stays readable');
        await page.screenshot({ path: path.join(artifacts, 'login.png') });
        console.log('main', {
            frames,
            errors,
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        });
        assert.deepEqual(errors, []);
        await page.goto('http://motioneye.test/picture/1/frame/');
        await page.waitForTimeout(400);
        const frameBefore = frames;
        await page.waitForTimeout(2200);
        assert.ok(
            frames - frameBefore >= 9 && frames - frameBefore <= 13,
            `embed requests ${frames - frameBefore}`,
        );
        const widthParam = await page.locator('img.camera').getAttribute('src');
        assert.match(widthParam, /&width=/);
        assert.deepEqual(errors, []);
        console.log('embed', { requests: frames - frameBefore, widthParam });
        console.log('Screenshots:', artifacts);
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
