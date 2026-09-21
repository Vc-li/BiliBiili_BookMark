document.addEventListener('DOMContentLoaded', function() {
    const serverInput = document.getElementById('server');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const pathInput = document.getElementById('path');
    const autoSyncInput = document.getElementById('autoSync');
    const testButton = document.getElementById('testButton');
    const saveButton = document.getElementById('saveButton');
    const statusEl = document.getElementById('status');
    const modeOverwrite = document.getElementById('modeOverwrite');
    const modeKeepAll = document.getElementById('modeKeepAll');
    const saveModeButton = document.getElementById('saveModeButton');
    const modeStatusEl = document.getElementById('modeStatus');

    // 载入已保存的配置
    chrome.storage.local.get(['webdavConfig', 'sameVideoMode'], (result) => {
        const c = result.webdavConfig;
        if (c) {
            serverInput.value = c.server || '';
            usernameInput.value = c.username || '';
            passwordInput.value = c.password || '';
            pathInput.value = c.path || '/bilibilimark/bookmarks.json';
            autoSyncInput.checked = !!c.autoSync;
        }
        // 书签设置：缺失时默认覆盖模式
        const mode = result.sameVideoMode || 'overwrite';
        if (mode === 'keepAll') modeKeepAll.checked = true;
        else modeOverwrite.checked = true;
    });

    // 读取当前选中的书签设置
    function readSameVideoMode() {
        return modeKeepAll.checked ? 'keepAll' : 'overwrite';
    }

    // 独立保存书签设置（不依赖 WebDAV 配置，选完模式点一下即生效）
    saveModeButton.addEventListener('click', async () => {
        const sameVideoMode = readSameVideoMode();
        try {
            await new Promise((resolve) => chrome.storage.local.set({ sameVideoMode }, resolve));
            modeStatusEl.textContent = '书签设置已保存';
            modeStatusEl.className = 'ok';
        } catch (e) {
            modeStatusEl.textContent = '保存失败：' + (e.message || e);
            modeStatusEl.className = 'err';
        }
    });

    function showStatus(text, ok) {
        statusEl.textContent = text;
        statusEl.className = ok ? 'ok' : 'err';
    }

    // 从表单读取配置
    function readForm() {
        return {
            server: serverInput.value.trim(),
            username: usernameInput.value.trim(),
            password: passwordInput.value,
            path: pathInput.value.trim() || '/bilibilimark/bookmarks.json',
            autoSync: autoSyncInput.checked
        };
    }

    // 校验并返回服务器 origin（用于申请 host 权限）
    function parseOrigin(server) {
        try {
            const url = new URL(server);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error('仅支持 http/https');
            }
            return url.origin;
        } catch (e) {
            throw new Error('服务器地址不合法：' + e.message);
        }
    }

    // 申请访问该服务器的 host 权限（MV3 跨域 fetch 必需）
    // 注意：match pattern 必须包含路径部分，裸 origin 会报 "Empty path"，需追加 /*
    function requestHostPermission(origin) {
        return new Promise((resolve, reject) => {
            chrome.permissions.request({ origins: [origin + '/*'] }, (granted) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (granted) {
                    resolve();
                } else {
                    reject(new Error('未获得访问该服务器的权限，同步将无法工作'));
                }
            });
        });
    }

    // 测试连接
    testButton.addEventListener('click', async () => {
        const config = readForm();
        if (!config.server) { showStatus('请先填写服务器地址', false); return; }
        try { parseOrigin(config.server); } catch (e) { showStatus(e.message, false); return; }
        testButton.disabled = true;
        showStatus('正在测试连接…', true);
        try {
            const result = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', config });
            showStatus(result.message, result.ok);
        } catch (e) {
            showStatus('测试失败：' + (e.message || e), false);
        } finally {
            testButton.disabled = false;
        }
    });

    // 保存配置
    saveButton.addEventListener('click', async () => {
        const config = readForm();
        const sameVideoMode = readSameVideoMode();

        // 书签设置始终保存
        await new Promise((resolve) => chrome.storage.local.set({ sameVideoMode }, resolve));

        // 未填服务器地址：只保存书签设置
        if (!config.server) {
            showStatus('书签设置已保存', true);
            return;
        }

        let origin;
        try { origin = parseOrigin(config.server); } catch (e) { showStatus(e.message, false); return; }

        saveButton.disabled = true;
        showStatus('正在保存…', true);
        try {
            await requestHostPermission(origin);
            await new Promise((resolve) => chrome.storage.local.set({ webdavConfig: config }, resolve));
            // 通知 background 校正同步 alarm
            chrome.runtime.sendMessage({ type: 'CONFIG_SAVED' });
            showStatus('保存成功' + (config.autoSync ? '，自动同步已开启' : ''), true);
        } catch (e) {
            showStatus('保存失败：' + (e.message || e), false);
        } finally {
            saveButton.disabled = false;
        }
    });
});
