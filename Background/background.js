import * as tracker from './p_change_tracker.js';
import * as uuid from './uuid.js'
import * as cache from './cache.js'
import * as webdav from './webdav.js'
import { dedupeLocal } from './dedupe.js'

chrome.runtime.onInstalled.addListener(() => {
    console.log('[BackGround] Chrome Extension installed.');
    ensureSyncAlarm();
});

// SW 启动时对本地书签去重一次（合并同一视频同一P的历史重复），有变更则刷新 session 缓存。
// dedupeLocal 幂等，无重复时直接返回。
(async () => {
    try {
        const changed = await dedupeLocal();
        if (changed) {
            console.log('[BackGround] 重复书签去重完成');
            await cache.refreshSessionCache();
        }
    } catch (e) {
        console.error('[BackGround] 去重失败:', e);
    }
})();

// ---------- 自动同步（chrome.alarms 周期轮询） ----------
// service worker 易失，setTimeout 防抖不可靠；用周期 alarm 驱动。
// 每次 alarm 触发都执行一次完整的"拉取+合并+推送"，无论本地是否有变化，
// 这样其它设备（A 电脑）的更新也能被拉到本机（B 电脑）。
const SYNC_ALARM = 'webdav-sync';

// 根据当前配置确保同步 alarm 处于正确状态（autoSync 开→创建，关→清除）。
async function ensureSyncAlarm() {
    const { webdavConfig } = await chrome.storage.local.get('webdavConfig');
    if (webdavConfig && webdavConfig.autoSync) {
        // 生产环境最小周期 30s（0.5 分钟）。
        chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
    } else {
        chrome.alarms.clear(SYNC_ALARM);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    const { webdavConfig } = await chrome.storage.local.get('webdavConfig');
    if (!webdavConfig || !webdavConfig.autoSync) return;
    try {
        const result = await webdav.syncNow(webdavConfig);
        console.log('[Background] 自动同步完成:', result.message);
    } catch (e) {
        console.error('[Background] 自动同步失败:', e);
        await chrome.storage.local.set({
            syncStatus: { lastSync: Math.floor(Date.now() / 1000), lastResult: 'error', lastError: e.message || String(e) }
        });
    }
});

// SW 启动时校正 alarm 状态（alarms 本身持久，这里做防御性兜底）。
ensureSyncAlarm();

// background.js
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log('[BackGround][MessageHandler]', message.type, message)
    switch (message.type){
        case 'GET_TAB_ID': // 请求TabId
            sendResponse({ tabId: sender.tab?.id });
            return true; // 异步/安全返回
            break;
        case 'STORE_VIDEO_INFO': { // 存储视频信息。
            const {tabId, recordTime, key, bv, p, title, currentTime, duration, track} = message;
            const updatedAt = recordTime; // 创建时最后写入时间 = 记录时间
            const entry = {recordTime, updatedAt, bv, p, currentTime, title, duration, track};
            // 所有 storage 操作合并到单个 async 流程，避免"清墓碑"与"覆盖模式"
            // 并发读写 deletedBookmarks 产生竞态（后完成的 set 会覆盖先写入的墓碑）。
            (async () => {
                try {
                    // 一次性读取全量数据
                    const items = await chrome.storage.local.get(null);
                    const deleted = items.deletedBookmarks || {};

                    // 重新添加书签时清除该 key 的删除墓碑
                    delete deleted[key];

                    // 覆盖模式：同一视频只保留最新收藏的分P，其它分P记墓碑并删除（同步时不会复活）
                    // sameVideoMode 已包含在上面的 get(null) 结果中，无需二次读取
                    let otherParts = [];
                    if (items.sameVideoMode === 'overwrite') {
                        otherParts = Object.keys(items).filter(
                            k => k.startsWith('BV') && k !== key && k.split(':')[0] === bv
                        );
                        for (const k of otherParts) deleted[k] = recordTime;
                    }

                    // 统一写回：新书签 + 墓碑（一次 set，消除竞态）
                    await chrome.storage.local.set({ [key]: entry, deletedBookmarks: deleted });
                    if (otherParts.length) {
                        await chrome.storage.local.remove(otherParts);
                        console.log('[Background] 覆盖模式：移除同视频其它分P', otherParts);
                    }
                    console.log('[Background] Video information saved:', {recordTime, key, bv, p, title, currentTime, duration, track});

                    // 刷新 session 缓存（popup 优先读 session；覆盖模式删除的分P也需从缓存移除）
                    await cache.refreshSessionCache();
                } catch (e) {
                    console.error('[Background] 保存书签失败:', e);
                }
            })();
            // 设置更新专属的绿色badge
            chrome.action.setBadgeText({ text: '更新!' });
            chrome.action.setBadgeBackgroundColor({ color: 'green' });
            // 通过在N秒后设置TEXT为空来移除徽章。
            setTimeout(() => {
                chrome.action.setBadgeText({ text: '' });
            }, 3000);
            // 触发追踪
            chrome.tabs.sendMessage(tabId, { type: "TIME_TRACK" });
            break;
        }
        case 'SKIP_TO_VIDEO': { // 跳转视频页，popup.js。
            const url = message.url
            const currentTime = message.currentTime - 5;
            chrome.tabs.create({ url });
            break;
        }
        case 'NEW_VIDEO_OPENED': { // 有新视频打开
            const {key, tabId} = message;
            chrome.storage.local.get([key], (result) => {
                if (result[key]) {
                    // 触发时间跳转
                    chrome.tabs.sendMessage(tabId, { type: "JUMP_TO_TIME", currentTime: result[key].currentTime - 5});
                    // 触发追踪
                    chrome.tabs.sendMessage(tabId, { type: "TIME_TRACK" });
                }
            });
            break;
        }
        case 'UPDATE_VIDEO_PROGRESS': { // 视频进度更新
            const {key, currentTime} = message
            const updatedAt = Math.floor(Date.now() / 1000);
            // 存储层更新书签
            chrome.storage.local.get([key], (result) => {
                if (result[key]) {
                    result[key].currentTime = currentTime;
                    result[key].updatedAt = updatedAt;
                    chrome.storage.local.set({ [key]: result[key] });
                    console.log('[Background] 视频播放进度更新:', {key, currentTime});
                }
            });
            // 缓存层更新书签（缓存里可能还没有该 key——如刚创建尚未刷新缓存，需判空避免 TypeError）
            chrome.storage.session.get(["bookmarks"], (item) => {
                if (item.bookmarks && item.bookmarks[key]) {
                    item.bookmarks[key].currentTime = currentTime
                    item.bookmarks[key].updatedAt = updatedAt
                    chrome.storage.session.set({"bookmarks" : item.bookmarks})
                } else {
                    console.log('[Background] Cache Not Wrok.')
                }
            })
            break;
        }
        case 'DELETE_BOOKMARK': { // 删除书签（popup 触发），记录墓碑保证同步时不被拉回
            const { key } = message;
            const now = Math.floor(Date.now() / 1000);
            (async () => {
                // 记录删除墓碑
                const res = await chrome.storage.local.get('deletedBookmarks');
                const deleted = res.deletedBookmarks || {};
                deleted[key] = now;
                await chrome.storage.local.set({ deletedBookmarks: deleted });
                // 删除本地书签
                await chrome.storage.local.remove(key);
                // 刷新 session 缓存
                await cache.refreshSessionCache();
                sendResponse({ ok: true });
            })();
            return true;
        }
        case 'RENAME_BOOKMARK': { // 修改书签标题（popup 触发），更新 updatedAt 保证同步时按最后写入优先传播
            const { key, title } = message;
            const now = Math.floor(Date.now() / 1000);
            (async () => {
                const res = await chrome.storage.local.get(key);
                if (!res[key]) { sendResponse({ ok: false }); return; }
                res[key].title = title;
                res[key].updatedAt = now;
                await chrome.storage.local.set({ [key]: res[key] });
                await cache.refreshSessionCache();
                sendResponse({ ok: true });
            })();
            return true;
        }
        case 'SYNC_NOW': { // 手动同步（popup 触发）
            (async () => {
                const { webdavConfig } = await chrome.storage.local.get('webdavConfig');
                if (!webdavConfig || !webdavConfig.server) {
                    sendResponse({ ok: false, configured: false, message: '尚未配置 WebDAV' });
                    return;
                }
                try {
                    const result = await webdav.syncNow(webdavConfig);
                    sendResponse({ ok: true, configured: true, ...result });
                } catch (e) {
                    await chrome.storage.local.set({
                        syncStatus: { lastSync: Math.floor(Date.now() / 1000), lastResult: 'error', lastError: e.message || String(e) }
                    });
                    sendResponse({ ok: false, configured: true, message: e.message || String(e) });
                }
            })();
            return true;
        }
        case 'GET_SYNC_STATUS': { // 查询同步状态（popup 打开时）
            (async () => {
                const { webdavConfig, syncStatus } = await chrome.storage.local.get(['webdavConfig', 'syncStatus']);
                sendResponse({
                    configured: !!(webdavConfig && webdavConfig.server),
                    autoSync: !!(webdavConfig && webdavConfig.autoSync),
                    syncStatus: syncStatus || null
                });
            })();
            return true;
        }
        case 'TEST_CONNECTION': { // 选项页测试连接
            (async () => {
                const result = await webdav.testConnection(message.config);
                sendResponse(result);
            })();
            return true;
        }
        case 'CONFIG_SAVED': { // 选项页保存配置后，校正同步 alarm
            ensureSyncAlarm();
            sendResponse({ ok: true });
            return true;
        }
    }
});
