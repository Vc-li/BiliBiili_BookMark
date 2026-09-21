let DOMjs = globalThis.DOMjs;
(() => {
    console.log('[Content] BiliBili 视频书签已在此页面加载。');

    // 创建嵌入页面的按钮容器 和BiliBili官方样式的同一行其它按钮的类型对齐。
    const recordButtonContainer = document.createElement("div");
    recordButtonContainer.className = "bpx-player-ctrl-btn"
    recordButtonContainer.style.cursor = "Pointer";
    // recordButtonContainer.style.backgroundColor = "red";
    recordButtonContainer.style.marginRight = "10px";

    const recordButton = document.createElement("img");
    recordButton.classList.add("recordButtonContainer");
    recordButton.src = chrome.runtime.getURL("icons/icons-plus-pink.png");
    recordButton.style.height = "22px";

    // 悬停效果
    recordButtonContainer.addEventListener("mouseover", () => {
        recordButton.style.filter = "brightness(1.2)";
    });
    recordButtonContainer.addEventListener("mouseout", () => {
        recordButton.style.filter = "brightness(0.8)";
    });

    // 点击以添加书签
    recordButtonContainer.addEventListener("click", async () => {
        const titleElement = document.querySelector('.video-info-title-inner > h1');
        if (titleElement && DOMjs.video){
            console.log('[Content][STORE_VIDEO_INFO] Current Video URL:', window.location.href)
            let title = `[V3]${titleElement.title}`;
            if(DOMjs.p != 0){
                title = `${title}(P${DOMjs.p})`
            }
            const currentTime = DOMjs.video.currentTime;
            const duration = DOMjs.video.duration;
            // 发送书签信息到 background.js
            const recordTime = Math.floor(Date.now() / 1000)
            console.log('[Content][STORE_VIDEO_INFO] Video information:', {recordTime, key: DOMjs.key, bv: DOMjs.bv, p: DOMjs.p, title, currentTime, duration});
            chrome.runtime.sendMessage({
                type: 'STORE_VIDEO_INFO',
                tabId: await getTabId_async(),
                recordTime,
                key: DOMjs.key,
                title,
                bv: DOMjs.bv,
                p: DOMjs.p,
                currentTime,
                duration,
            });
        }
    })
    recordButtonContainer.appendChild(recordButton)

    // 插入按钮。每次重新查询工具栏——分P视频播放器挂载比普通视频晚，
    // 不能在脚本加载时一次性捕获引用（否则拿到 null，insertBefore 抛错导致按钮永远不出现）。
    function insertButton() {
        const playerToolbar = document.querySelector(".bpx-player-control-bottom-right");
        if (!playerToolbar) return false;
        if (playerToolbar.contains(recordButtonContainer)) return true; // 已插入，避免重复
        playerToolbar.insertBefore(recordButtonContainer, playerToolbar.firstChild);
        return true;
    }

    // 优先等官方清晰度按钮出现后再插入，防止本按钮先于官方按钮出现的违和感；
    // 但加 5 秒兜底，防止清晰度按钮选择器变化/不出现导致按钮永远不显示。
    let inserted = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const qualityBtn = document.querySelector(".bpx-player-ctrl-quality-result");
        if (qualityBtn || Date.now() - startedAt > 5000) {
            if (insertButton()) {
                inserted = true;
                clearInterval(timer);
            }
        }
    }, 100);

    // 播放器重新渲染（切换分P、切清晰度等）可能移除本按钮，检测到后自动重新插入。
    const observer = new MutationObserver(() => {
        if (inserted && !document.contains(recordButtonContainer)) {
            inserted = insertButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();


// ==========
// 通知有新视频打开。
async function newVideoOpened(){
    // 新视频打开后，向background.js验证其是否需要追踪。
    chrome.runtime.sendMessage({
        type: 'NEW_VIDEO_OPENED',
        tabId: await getTabId_async(),
        key: DOMjs.key,
    })
}
newVideoOpened();
// ==========