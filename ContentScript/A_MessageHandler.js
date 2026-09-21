// 在监听到跳转消息时修改当前页面视频时间戳
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log(`[Content][ContentMessageHandler]: ${message.type}`, `[${message}]`)
    switch (message.type) {
        case "JUMP_TO_TIME":
            if (message.currentTime !== undefined) {
                DOMjs.video.currentTime = message.currentTime; // 设置视频跳转到指定时间
            }
            break;
        case "TIME_TRACK":
            addPlayerTracker();
            break;
        case "P_CHANGED": // 分P发生改变？
            // console.log(window.location.href)
            isChanged = loadKey();
            if(!isChanged){
                console.log('[Content] P_CHANGED? No. 视频分P未改变')
                break
            }
            newVideoOpened();
            break
        default:
            console.log('[Content][ContentMessageHandler]: Unknown Message Type.', `{${message.type}}`);
    }
});