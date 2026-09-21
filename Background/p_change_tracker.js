// 监听 SPA 的 pushState/replaceState 导航
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return; // 只管顶层
    chrome.tabs.sendMessage(details.tabId, { type: "P_CHANGED" });
}, {
    url: [{ hostEquals: "www.bilibili.com", pathPrefix: "/video/" }]
});