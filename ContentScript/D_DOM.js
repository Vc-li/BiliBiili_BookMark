// 视频元素
globalThis.DOMjs = {};
globalThis.DOMjs.video = document.querySelector('video');

// Key
globalThis.DOMjs.key;
globalThis.DOMjs.bv;
globalThis.DOMjs.p = 0;
// 归一化分P：B站打开多P视频不写 ?p 时默认就是第一P，
// 因此"无 ?p"与"?p=1"是同一P，统一记为 0，避免同一视频产生两条书签。
function normalizePart(pParam){
    const n = parseInt(pParam, 10);
    if (!pParam || isNaN(n) || n <= 1) return 0;
    return n;
}

function loadKey(){
    const url = new URL(window.location.href);
    var isChanged = false
    globalThis.DOMjs.bv = url.pathname.split('/')[2]; // 假设路径为 /video/BVxxxxxx
    // 获得视频分P
    const params = url.searchParams;
    const p = normalizePart(params.get("p"));
    if (p != globalThis.DOMjs.p){
        isChanged = true
    }
    globalThis.DOMjs.p = p
    // 计算出Key
    globalThis.DOMjs.key = `${globalThis.DOMjs.bv}:${globalThis.DOMjs.p}`;
    return isChanged
}
loadKey();

// TabId
globalThis.DOMjs.TabId;
// 只能通过询问Background得到
async function getTabId_async(){
    if (!globalThis.DOMjs.TabId) {
        await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (res) => {
                globalThis.DOMjs.TabId = res.tabId;
                resolve()
            });
        })
    }
    return globalThis.DOMjs.TabId
}