/* Schedule snapshot work at the configured frame rate instead of polling at 66 Hz. */
function startCameraRefreshLoop(refresh) {
    var timer = null;

    function tick() {
        clearTimeout(timer);
        timer = null;
        if (document.hidden) {
            return;
        }

        var delay = refresh(Date.now());
        timer = setTimeout(tick, Math.max(15, Math.min(delay, 1000)));
    }

    document.addEventListener('visibilitychange', tick);
    tick();
    return tick;
}

/* Returns the time until the next useful check. Load/error handlers clear loading_count. */
function refreshCameraImage(img, options, now) {
    var interval = options.framerate > 0 ? 1000 / options.framerate : 0;
    if (img.error && interval) {
        interval = Math.max(interval, 1000);
    }

    if (img._lastRequestTime != null) {
        /* A zero frame rate means one snapshot, including after a failed request. */
        if (!interval) {
            return 1000;
        }
        if (img.loading_count && now - img._lastRequestTime < 2000) {
            return Math.min(interval, 2000 - (now - img._lastRequestTime));
        }
        var remaining = interval - (now - img._lastRequestTime);
        if (remaining > 0) {
            return remaining;
        }
    }

    var path = options.basePath + 'picture/' + options.cameraId + '/current/?_=' + now;
    if (options.width) {
        path += '&width=' + options.width;
    }

    img._lastRequestTime = now;
    img.loading_count = 1;
    img.src = path;
    return interval || 1000;
}
