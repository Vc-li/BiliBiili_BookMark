import { dedupeBookmarks } from './dedupe.js';

// 从 storage.local 全量数据中筛出书签并去重，得到干净的纯书签对象。
// 去重保证 session 缓存里同一视频同一P只有一条（与 storage.local 的清理保持一致）。
function buildBookmarks(items) {
    const bookmarks = {};
    for (const [k, v] of Object.entries(items)) {
        if (k.startsWith('BV')) bookmarks[k] = v;
    }
    return dedupeBookmarks(bookmarks, items.deletedBookmarks || {}).bookmarks;
}

// 将 local 存储的书签数据迁移到 session 存储中。
// session 已初始化则跳过，避免 SW 重启时用旧快照覆盖同步后刷新的缓存。
chrome.storage.session.get(["bookmarks"], (item) => {
    if (item.bookmarks) return;
    chrome.storage.local.get(null, (items) => {
        const bookmarks = buildBookmarks(items);
        console.log("[BackGround] Cache Initialize: ", bookmarks)
        chrome.storage.session.set({ "bookmarks": bookmarks })
    })
})

// 从 local 重建 session 的 bookmarks 缓存。
// 同步拉取/合并后必须调用，否则 popup（优先读 session）看不到新数据。
export async function refreshSessionCache() {
    const items = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    const bookmarks = buildBookmarks(items);
    await new Promise((resolve) => chrome.storage.session.set({ "bookmarks": bookmarks }, resolve));
}

// 向缓存添加新的书签
export async function cacheNewMark(item) {
    chrome.storage.local.get(null, (items) => {})
}
