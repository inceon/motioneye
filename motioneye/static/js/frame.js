
var refreshDisabled = false;


    /* camera frame */

function setupCameraFrame() {
    var cameraFrameDiv = $('div.camera-frame');
    var cameraPlaceholder = cameraFrameDiv.find('div.camera-placeholder');
    var cameraProgress = cameraFrameDiv.find('div.camera-progress');
    var cameraImg = cameraFrameDiv.find('img.camera');
    var cameraId = cameraFrameDiv.attr('id').substring(6);
    var progressImg = cameraFrameDiv.find('img.camera-progress');

    cameraFrameDiv[0].streamingFramerate = parseInt(cameraFrameDiv.attr('streaming_framerate')) || 1;
    cameraFrameDiv[0].streamingServerResize = cameraFrameDiv.attr('streaming_server_resize') == 'true';
    cameraFrameDiv[0].proto = cameraFrameDiv.attr('proto');
    cameraFrameDiv[0].url = cameraFrameDiv.attr('url');
    progressImg.attr('src', staticPath + 'img/camera-progress.gif');

    cameraProgress.addClass('visible');
    cameraPlaceholder.css('opacity', '0');

    /* fade in */
    cameraFrameDiv.animate({'opacity': 1}, 100);

    /* error and load handlers */
    cameraImg.on('error', function () {
        this.error = true;
        this.loading_count = 0;

        cameraImg.addClass('error').removeClass('loading');
        cameraPlaceholder.css('opacity', 1);
        cameraProgress.removeClass('visible');
        cameraFrameDiv.removeClass('motion-detected');
    });
    cameraImg.on('load', function () {
        if (refreshDisabled) {
            return; /* refresh temporarily disabled for updating */
        }

        this.error = false;
        this.loading_count = 0;

        cameraImg.removeClass('error').removeClass('loading');
        cameraPlaceholder.css('opacity', 0);
        cameraProgress.removeClass('visible');

        /* there's no point in looking for a cookie update more often than once every second */
        var now = new Date().getTime();
        if ((!this.lastCookieTime || now - this.lastCookieTime > 1000) && (cameraFrameDiv[0].proto != 'mjpeg')) {
            if (getCookie('motion_detected_' + cameraId) == 'true') {
                cameraFrameDiv.addClass('motion-detected');
            }
            else {
                cameraFrameDiv.removeClass('motion-detected');
            }

            this.lastCookieTime = now;
        }
    });

    cameraImg.addClass('loading');
}

function refreshCameraFrame(timestamp) {
    var $cameraFrame = $('div.camera-frame');
    var cameraFrame = $cameraFrame[0];
    var img = $cameraFrame.find('img.camera')[0];

    if (cameraFrame.proto == 'mjpeg') {
        if (cameraFrame.url && !img.getAttribute('src')) {
            var url = cameraFrame.url.replace('127.0.0.1', window.location.host.split(':')[0]);
            img.src = url + (url.indexOf('?') > 0 ? '&' : '?') + '_=' + timestamp;
        }
        return 1000;
    }
    if (refreshDisabled || refreshInterval > 1000) {
        return 1000;
    }

    return refreshCameraImage(img, {
        basePath: basePath,
        cameraId: cameraFrame.id.substring(6),
        framerate: cameraFrame.streamingFramerate,
        width: cameraFrame.streamingServerResize ? img.width : null
    }, timestamp);
}


    /* startup function */

$(document).ready(function () {
    setupCameraFrame();
    startCameraRefreshLoop(refreshCameraFrame);
});
