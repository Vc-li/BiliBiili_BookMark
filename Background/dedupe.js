// dedupe.js — 书签去重（同一视频同一P只保留最新一条）
// 独立模块，供 cache.js 与 webdav.js 共用，避免循环依赖。
//
// 背景：B站打开多P视频不写 ?p 时默认就是第一P，因此"无 ?p"与"?p=1"是同一P。
// 旧版按 URL 字面生成 key，导致同一视频产生 BV:0 与 BV:1 两条重复书签。
// 这里把分P归一化（第一P 统一为 0），并对归一化后同 key 的条目只保留更新时间最新的一条。

// 归一化分P：无 ?p / ?p=1 / 非法值 都视为第一P（0）。
export function normalizePart(p){
    const n = parseInt(p, 10);
    if (!p || isNaN(n) || n <= 1) return 0;
    return n;
}

// 取一条书签的"最后写入时间"（秒）。旧数据无 updatedAt 时回退 recordTime。
function entryTime(entry){
    return entry && (entry.updatedAt || entry.recordTime) || 0;
}

// 对书签对象去重。
// 返回 { bookmarks, removedKeys }：
//   bookmarks   —— 使用归一化 key（第一P 统一为 BV:0）的干净书签对象
//   removedKeys —— 需要从存储中删除的原始 key（被合并掉的重复项 + 重命名前的旧 key）
// deleted 为可选的删除墓碑映射，若某归一化 key 的墓碑比候选条目更新，则该条目不保留。
export function dedupeBookmarks(bookmarks, deleted = {}){
    // 按归一化 key 分组
    const groups = {};
    for (const [key, entry] of Object.entries(bookmarks)) {
        const bv = (entry && entry.bv) || key.split(':')[0];
        const rawP = (entry && entry.p !== undefined) ? entry.p : key.split(':')[1];
        const canon = `${bv}:${normalizePart(rawP)}`;
        (groups[canon] = groups[canon] || []).push({ key, entry });
    }

    const cleaned = {};
    const removedKeys = [];
    for (const [canon, list] of Object.entries(groups)) {
        const pVal = normalizePart(canon.split(':')[1]);
        // 选出更新时间最新的条目
        list.sort((a, b) => entryTime(b.entry) - entryTime(a.entry));
        const winner = list[0];
        // 若该归一化 key 存在更新的删除墓碑，则不保留（删除优先）
        if (deleted[canon] && deleted[canon] > entryTime(winner.entry)) {
            for (const item of list) removedKeys.push(item.key);
            continue;
        }
        cleaned[canon] = { ...winner.entry, p: pVal };
        // 移除所有非归一化 key 的原始条目（重复项 + 重命名前的旧 key）
        for (const item of list) {
            if (item.key !== canon) removedKeys.push(item.key);
        }
    }
    return { bookmarks: cleaned, removedKeys };
}

// 对 storage.local 中的书签执行去重（幂等）。返回是否有变更。
export async function dedupeLocal(){
    const items = await chrome.storage.local.get(null);
    const bookmarks = {};
    for (const [k, v] of Object.entries(items)) {
        if (k.startsWith('BV')) bookmarks[k] = v;
    }
    const deleted = items.deletedBookmarks || {};
    const { bookmarks: cleaned, removedKeys } = dedupeBookmarks(bookmarks, deleted);

    const origKeySet = new Set(Object.keys(bookmarks));
    const changed = removedKeys.length > 0 ||
        Object.keys(cleaned).some(k => !origKeySet.has(k)); // 发生了归一化重命名
    if (!changed) return false;

    const toSet = {};
    for (const [k, v] of Object.entries(cleaned)) toSet[k] = v;
    await chrome.storage.local.set(toSet);
    if (removedKeys.length) await chrome.storage.local.remove(removedKeys);
    return true;
}
