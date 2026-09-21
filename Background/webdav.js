// webdav.js — WebDAV 客户端 + 书签同步编排
// 纯 fetch 实现，无第三方依赖。运行于 MV3 service worker（ES module）。
//
// config 结构（存于 chrome.storage.local 的 "webdavConfig"）：
//   {
//     server:   "https://dav.example.com",   // 服务器地址（origin，可带端口）
//     username: "user",
//     password: "pass",
//     path:     "/bilibilimark/bookmarks.json",    // 远程文件路径（绝对路径，以 / 开头）
//     autoSync: true                          // 是否开启自动同步
//   }
//
// 同步文件（v2 格式，含删除墓碑）：
//   {
//     "v": 2,
//     "bookmarks": { "BV1xx:2": { recordTime, updatedAt, bv, p, title, currentTime, duration, track } },
//     "deleted":   { "BV1yy:1": 1758000000 }   // key -> 删除时间戳（墓碑）
//   }
// 兼容旧版扁平格式（顶层直接是 BV 开头的 key，无 deleted）。

import * as cache from './cache.js';
import { dedupeLocal } from './dedupe.js';

// ---------- 基础工具 ----------

// UTF-8 安全的 base64（btoa 只接受 Latin1，中文账号密码会抛错）。
function base64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

// 拼接完整 URL：server + path，处理 server 末尾多余的斜杠。
function buildUrl(config, path) {
    const base = config.server.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
}

// 基础 WebDAV 请求。返回 { ok, status, headers, text }。
// 网络层错误（断网/CORS 被拦/权限缺失）会抛出带可读信息的 Error，由调用方捕获。
async function webdavRequest(config, method, path, body, extraHeaders) {
    const headers = {
        'Authorization': 'Basic ' + base64Utf8(config.username + ':' + config.password),
        ...(extraHeaders || {})
    };
    let res;
    try {
        res = await fetch(buildUrl(config, path), {
            method,
            headers,
            body: body !== undefined ? body : undefined
        });
    } catch (e) {
        // fetch 抛 TypeError: Failed to fetch 的常见原因：
        //  1) 服务器不可达（宕机/域名解析失败/超时）
        //  2) 浏览器离线
        //  3) 未授予该服务器的 host 权限（MV3 跨域 fetch 必需）
        //  4) 服务器未正确配置 CORS（WebDAV 服务端需允许扩展 origin）
        const origin = (() => { try { return new URL(config.server).origin; } catch { return config.server; } })();
        throw new Error(
            '无法连接服务器 ' + origin + '：' +
            (navigator.onLine === false
                ? '浏览器当前离线，请检查网络。'
                : '服务器不可达、未授予访问权限，或服务器未配置 CORS。' +
                  '请到 设置 页点"测试连接"确认，并在 chrome://extensions 检查该扩展是否已允许访问此网站。')
        );
    }
    const text = await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, text };
}

// 把 WebDAV 错误归一化成对用户友好的中文信息。
function describeError(status, err) {
    if (err) return '网络错误：' + (err.message || err);
    if (status === 401) return '认证失败：账号或密码错误（401）';
    if (status === 403) return '权限不足：该账号无权访问此路径（403）';
    if (status === 404) return '路径不存在（404）';
    if (status === 405) return '方法不被允许（405）';
    return '服务器返回 ' + status;
}

// ---------- 远程文件操作 ----------

// 检查远程文件是否存在。返回 { exists, lastModified }。
export async function remoteExists(config) {
    const r = await webdavRequest(config, 'PROPFIND', config.path, '', { 'Depth': '0' });
    if (r.status === 207) {
        const m = r.text.match(/<D:lastmodified>([^<]+)<\/D:lastmodified>/);
        return { exists: true, lastModified: m ? m[1] : null };
    }
    if (r.status === 404) return { exists: false, lastModified: null };
    throw new Error(describeError(r.status));
}

// 解析远程文件文本为 { bookmarks, deleted }。兼容 v2 与旧版扁平格式。
function parseRemote(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return { bookmarks: {}, deleted: {} };
    if ('bookmarks' in data) {
        return { bookmarks: data.bookmarks || {}, deleted: data.deleted || {} };
    }
    // 旧版扁平格式：顶层直接是 BV 开头的 key
    const bookmarks = {};
    for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('BV')) bookmarks[k] = v;
    }
    return { bookmarks, deleted: {} };
}

// 下载远程书签。文件不存在时返回空。
export async function remoteGet(config) {
    const r = await webdavRequest(config, 'GET', config.path);
    if (r.status === 404) return { bookmarks: {}, deleted: {} };
    if (!r.ok) throw new Error(describeError(r.status));
    try {
        return parseRemote(r.text);
    } catch (e) {
        throw new Error('远程文件不是合法的 JSON，已中止同步以避免覆盖数据');
    }
}

// 确保远程文件的父目录存在（从根逐级 MKCOL）。
async function ensureDir(config) {
    const dir = config.path.substring(0, config.path.lastIndexOf('/'));
    if (!dir || dir === '') return; // 文件在根目录，无需建目录
    const segments = dir.split('/').filter(Boolean);
    let prefix = '';
    for (const seg of segments) {
        prefix += '/' + seg;
        const r = await webdavRequest(config, 'MKCOL', prefix);
        // 201 新建成功 / 204 或 405 已存在 / 409 父目录缺失（继续建下一层即可）
        if (r.status === 201 || r.status === 204 || r.status === 405) continue;
        if (r.status === 409) continue; // 父目录缺失，循环会继续补建
        throw new Error('创建目录 ' + prefix + ' 失败：' + describeError(r.status));
    }
}

// 上传书签（v2 格式）到远程。
export async function remotePut(config, bookmarks, deleted) {
    await ensureDir(config);
    const payload = { v: 2, bookmarks, deleted };
    const r = await webdavRequest(config, 'PUT', config.path, JSON.stringify(payload, null, 2), {
        'Content-Type': 'application/json'
    });
    if (!r.ok && r.status !== 204) throw new Error('上传失败：' + describeError(r.status));
}

// ---------- 合并逻辑（含删除墓碑） ----------

// 取一条书签的"最后写入时间"（秒）。旧数据无 updatedAt 时回退 recordTime。
function entryTime(entry) {
    return entry && (entry.updatedAt || entry.recordTime) || 0;
}

// 带墓碑的逐条最后写入合并。
// 对 union 的所有 key，比较"本地条目时间 / 远端条目时间 / 本地删除时间 / 远端删除时间"，
// 最近的事件获胜：若是删除则保留墓碑（不写入 bookmarks），否则取更新的条目。
// 返回 { bookmarks, deleted }。
function mergeBookmarks(localB, remoteB, localD, remoteD) {
    const mergedB = {};
    const mergedD = {};
    const keys = new Set([
        ...Object.keys(localB), ...Object.keys(remoteB),
        ...Object.keys(localD), ...Object.keys(remoteD)
    ]);
    for (const key of keys) {
        const lb = localB[key], rb = remoteB[key];
        const ld = localD[key] || 0, rd = remoteD[key] || 0;
        const lbT = lb ? entryTime(lb) : 0;
        const rbT = rb ? entryTime(rb) : 0;
        const maxT = Math.max(lbT, rbT, ld, rd);
        if (maxT === 0) continue;
        // 删除事件最新（含与条目时间相同的平局，删除优先，避免复活）→ 保留墓碑
        if (maxT === ld || maxT === rd) {
            mergedD[key] = Math.max(ld, rd);
            continue;
        }
        // 否则取更新的条目（重新添加会因 updatedAt 更新而覆盖旧墓碑）
        mergedB[key] = lbT >= rbT ? lb : rb;
    }
    return { bookmarks: mergedB, deleted: mergedD };
}

// 从 storage.local 全量数据中筛出书签条目（BV 开头的 key）。
function pickBookmarks(items) {
    const out = {};
    for (const [k, v] of Object.entries(items)) {
        if (k.startsWith('BV')) out[k] = v;
    }
    return out;
}

// ---------- 同步主流程 ----------

// 执行一次同步。返回 { ok, message, added, removed, updated }。
// 任何异常都会抛出，由调用方（background.js）捕获并记录 syncStatus。
// syncing 守卫防止自动同步轮询与手动同步并发执行。
let syncing = false;
export async function syncNow(config) {
    if (syncing) return { ok: true, message: '同步进行中，已跳过', skipped: true };
    syncing = true;
    try {
        return await doSync(config);
    } finally {
        syncing = false;
    }
}
async function doSync(config) {
    // 0. 先对本地去重（合并同一视频同一P的重复书签），保证同步的是干净数据
    await dedupeLocal();

    // 1. 读本地书签与删除墓碑
    const localItems = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    const localBookmarks = pickBookmarks(localItems);
    const localDeleted = localItems.deletedBookmarks || {};

    // 2. 拉取远程（不存在视为空）
    const remote = await remoteGet(config);
    const remoteBookmarks = remote.bookmarks;
    const remoteDeleted = remote.deleted;

    // 3. 带墓碑合并
    const merged = mergeBookmarks(localBookmarks, remoteBookmarks, localDeleted, remoteDeleted);

    // 统计变化（用于提示）
    let added = 0, removed = 0, updated = 0;
    for (const key of Object.keys(merged.bookmarks)) {
        const inLocal = !!localBookmarks[key];
        const inRemote = !!remoteBookmarks[key];
        if (!inLocal && !inRemote) continue;
        if (inLocal && !inRemote) added++;
        else if (!inLocal && inRemote) added++;
        else if (localBookmarks[key] !== merged.bookmarks[key]) updated++;
    }
    for (const key of Object.keys(localBookmarks)) {
        if (!merged.bookmarks[key]) removed++;
    }

    // 4. 合并结果写回本地（只 set 书签键，不动 wallpaper/clientId/webdavConfig 等）
    const toSet = {};
    for (const [k, v] of Object.entries(merged.bookmarks)) toSet[k] = v;
    toSet.deletedBookmarks = merged.deleted;
    // 删除本地有、但合并后没有的书签键
    const toRemove = Object.keys(localBookmarks).filter(k => !merged.bookmarks[k]);
    await new Promise((resolve) => chrome.storage.local.set(toSet, resolve));
    if (toRemove.length) await new Promise((resolve) => chrome.storage.local.remove(toRemove, resolve));

    // 5. 刷新 session 缓存（popup 优先读 session，必须同步刷新）
    await cache.refreshSessionCache();

    // 6. 上传合并结果
    await remotePut(config, merged.bookmarks, merged.deleted);

    // 7. 记录同步状态
    const now = Math.floor(Date.now() / 1000);
    await new Promise((resolve) => chrome.storage.local.set({
        syncStatus: { lastSync: now, lastResult: 'ok' }
    }, resolve));

    return { ok: true, message: '同步完成', added, removed, updated };
}

// 测试连接：对配置发一次 PROPFIND，返回 { ok, message }。
export async function testConnection(config) {
    try {
        const r = await remoteExists(config);
        return { ok: true, message: r.exists ? '连接成功，远程文件已存在' : '连接成功，远程文件尚不存在（首次同步将创建）' };
    } catch (e) {
        return { ok: false, message: e.message || String(e) };
    }
}
