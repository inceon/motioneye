// Run with: node --test tests/frontend/*.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../motioneye/static/js/camera.js'), 'utf8');

function setup() {
    const timers = new Map();
    const events = {};
    let id = 0;
    const context = vm.createContext({
        document: {hidden: false, addEventListener: (event, fn) => events[event] = fn},
        setTimeout: (fn, delay) => {timers.set(++id, {fn, delay}); return id;},
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(source, context);
    return {context, timers, events};
}

const options = {basePath: '/cctv/', cameraId: 3, framerate: 5, width: 640};

test('requests respect FPS and subpath; width is optional', () => {
    const {context: c} = setup();
    const img = {};
    assert.equal(c.refreshCameraImage(img, options, 1000), 200);
    assert.equal(img.src, '/cctv/picture/3/current/?_=1000&width=640');
    img.loading_count = 0;
    assert.equal(c.refreshCameraImage(img, options, 1150), 50);
    assert.match(img.src, /_=1000/);
    c.refreshCameraImage(img, {...options, width: null}, 1200);
    assert.equal(img.src, '/cctv/picture/3/current/?_=1200');
});

test('slow requests are not replaced until the two-second retry deadline', () => {
    const {context: c} = setup();
    const img = {};
    c.refreshCameraImage(img, options, 0);
    c.refreshCameraImage(img, options, 1999);
    assert.match(img.src, /_=0&/);
    c.refreshCameraImage(img, options, 2000);
    assert.match(img.src, /_=2000&/);
});

test('errors limit refresh to at most 1 FPS and recover to the configured FPS', () => {
    const {context: c} = setup();
    const img = {error: true};
    assert.equal(c.refreshCameraImage(img, options, 0), 1000);
    img.loading_count = 0;
    c.refreshCameraImage(img, options, 999);
    assert.match(img.src, /_=0&/);
    c.refreshCameraImage(img, options, 1000);
    img.loading_count = 0;
    img.error = false;
    assert.equal(c.refreshCameraImage(img, options, 1200), 200);
    assert.match(img.src, /_=1200&/);
});

test('zero FPS takes one snapshot and resumes when FPS is restored', () => {
    const {context: c} = setup();
    const img = {};
    c.refreshCameraImage(img, {...options, framerate: 0}, 0);
    img.loading_count = 0;
    c.refreshCameraImage(img, {...options, framerate: 0}, 5000);
    assert.match(img.src, /_=0&/);
    c.refreshCameraImage(img, options, 5200);
    assert.match(img.src, /_=5200&/);
});

test('hidden tabs cancel work; resuming and waking never duplicate timers', () => {
    const {context: c, timers, events} = setup();
    let calls = 0;
    const wake = c.startCameraRefreshLoop(() => {calls++; return 200;});
    assert.equal(calls, 1);
    assert.equal([...timers.values()][0].delay, 200);
    wake();
    assert.equal(timers.size, 1);
    c.document.hidden = true;
    events.visibilitychange();
    assert.equal(timers.size, 0);
    assert.equal(calls, 2);
    c.document.hidden = false;
    events.visibilitychange();
    assert.equal(calls, 3);
    assert.equal(timers.size, 1);
});

test('scheduler bounds idle checks and prevents tight loops at very high FPS', () => {
    const {context: c, timers} = setup();
    c.startCameraRefreshLoop(() => 2);
    assert.equal([...timers.values()][0].delay, 15);
    timers.clear();
    c.startCameraRefreshLoop(() => 5000);
    assert.equal([...timers.values()][0].delay, 1000);
});
