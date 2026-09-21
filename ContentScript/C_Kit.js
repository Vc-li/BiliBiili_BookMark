// ==============================
// 监听当前视频的进度。
let handler
function addPlayerTracker(){
    console.log('[Content] 开始追踪视频进度:', {key : DOMjs.key})
    let lastSavedTime = DOMjs.video.currentTime;
    // TimeUpdate是 <video> 或 <audio> 元素自带的一个事件，它会在视频的播放位置发生变化时触发。
    // 每次重新触发时，移除上一次的监听器函数。
    DOMjs.video.removeEventListener('timeupdate', handler);
    handler = timeupdate(lastSavedTime); // 闭包，拿到函数引用
    DOMjs.video.addEventListener('timeupdate', handler);
}
// 追踪监听器函数闭包，通过闭包传递多参数。
function timeupdate(lastSavedTime){
    return function onUpdate(e) {
        const currentTime = DOMjs.video.currentTime;
        // 每次视频播放进度跨度达到5S时，触发进度保存消息。
        if (currentTime - lastSavedTime > 5){
            lastSavedTime = currentTime;
            chrome.runtime.sendMessage({
                type: 'UPDATE_VIDEO_PROGRESS',
                key: DOMjs.key,
                currentTime
            });
        }
    }
}
// ==============================