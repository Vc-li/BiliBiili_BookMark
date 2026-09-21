document.addEventListener('DOMContentLoaded', function() {
    // 获取要展示列表的 DOM 元素
    const videoList = document.getElementById('videoList');
    const body = document.body;
    const BATCH_SIZE = 10; // 每次加载的条目数

    // 双击版本号徽章 → 打开项目主页
    document.getElementById('versionBadge').addEventListener('dblclick', () => {
        chrome.tabs.create({ url: 'https://vc-li.github.io/' });
    });
    let bookmarks = [];
    let renderedCount = 0;
    let scrollListenerAttached = false;

    // 加载并渲染书签列表。可重复调用（如同步完成后刷新）。
    function loadBookmarks() {
        videoList.innerHTML = '';
        bookmarks = [];
        renderedCount = 0;
        if (scrollListenerAttached) {
            window.removeEventListener('scroll', onScroll);
            scrollListenerAttached = false;
        }
        // 优先读 session 缓存，缺失时回退 storage.local
        chrome.storage.session.get("bookmarks", (items) => {
            if(!items || !items.bookmarks){
                chrome.storage.local.get(null, (items) => {
                    applyBookmarks(Object.entries(items));
                })
            } else {
                applyBookmarks(Object.entries(items.bookmarks));
            }
        });
    }

    function applyBookmarks(entries) {
        bookmarks = entries;
        bookmarks.sort((a, b) =>  b[1].recordTime - a[1].recordTime);
        renderBatch();
        // 当存储的书签数量大于 BATCH_SIZE 时，监听滚动事件
        if (bookmarks.length > BATCH_SIZE) {
            window.addEventListener('scroll', onScroll);
            scrollListenerAttached = true;
        }
    }

    loadBookmarks();

    // 渲染一批书签
    function renderBatch() {
        // 计算本次渲染的结束索引
        const end = Math.min(renderedCount + BATCH_SIZE, bookmarks.length);
        for (let i = renderedCount; i < end; i++) {
            
            const [key, videoItem] = bookmarks[i];
            if(!key.startsWith('BV')) continue;
            // 创建列表项
            const li = document.createElement('li');
            li.className = 'videoItem';

            //创建第一行:主题与按钮
            const firstLine = document.createElement('div');
            firstLine.className = 'firstLine';
            //创建Title元素（title 属性用于悬停显示完整标题）
            const Title = document.createElement('div');
            Title.className = "Title";
            Title.textContent = videoItem.title;
            Title.title = videoItem.title;
            // 创建按钮区域
            const buttonArea = document.createElement('div');
            buttonArea.className = "buttonArea";
            // 创建删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.className = 'itemButton del';
            deleteButton.textContent = '删除';
            deleteButton.type = 'button';
            deleteButton.addEventListener('click', () => {
                // 点击删除按钮时，通知 background 删除并记录墓碑（保证同步时不会被拉回来）
                chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARK', key }, () => {
                    li.remove();
                });
            });

            // 创建跳转按钮，本质是广播一个SKIP_TO_VIDEO类型的Message。
            // background.js捕捉后，通过得到的信息创建新tab，再向新tab的contest.js发送包含时间戳的Message。
            // 新建tab的content.js收到Message后，对Video的CurrentTime进行设置。
            const goToButton = document.createElement('button');
            goToButton.className = 'itemButton go';
            goToButton.textContent = '跳转';
            goToButton.type = 'button';
            // 监听点击事件：跳转
            let url = `https://www.bilibili.com/video/${videoItem.bv}`;
            if(videoItem.p != 0){
                url = `${url}?p=${videoItem.p}`
            }
            goToButton.addEventListener('click', () => {
                chrome.runtime.sendMessage({
                    type: 'SKIP_TO_VIDEO',
                    url,
                    currentTime: videoItem.currentTime
                });
            });
            buttonArea.append(goToButton, deleteButton)
            firstLine.append(Title, buttonArea)

            // 创建第二行:时间戳
            const secondLine = document.createElement('div');
            secondLine.className = "secondLine"
            // 创建第二行左侧元素：当前播放位置
            const LeftTimeStamp = document.createElement('span');
            const seconds = Math.floor(videoItem.currentTime % 60);
            const minutes = Math.floor(videoItem.currentTime % 3600 / 60);
            const hours = Math.floor(videoItem.currentTime / 3600);
            LeftTimeStamp.innerHTML = `${hours}:${minutes}:${seconds}`;
            // 创建第二行右侧元素：视频总时长
            const RightTimeStamp = document.createElement('span');
            const duration_seconds = Math.floor(videoItem.duration % 60);
            const duration_minutes = Math.floor(videoItem.duration % 3600 / 60);
            const duration_hours = Math.floor(videoItem.duration / 3600);
            const duartion = `${duration_hours}:${duration_minutes}:${duration_seconds}`
            RightTimeStamp.innerHTML = duartion;
            secondLine.append(LeftTimeStamp, RightTimeStamp)

            // 创建第三行：进度条
            const thirdLine = document.createElement('div');
            thirdLine.className = "thirdLine"
            // 创建进度条容器
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            // 创建进度条填充部分
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-fill';
            // 计算视频播放百分比
            const percentage = (videoItem.currentTime / videoItem.duration) * 100
            progressFill.style.width = `${percentage}%`;
            progressBar.appendChild(progressFill);
            thirdLine.appendChild(progressBar);
            // 将 BV 号和按钮添加到列表项
            li.append(firstLine, secondLine, thirdLine);

            // 将列表项添加到 ul 列表中
            videoList.appendChild(li);
        }
        renderedCount = end;
    };

    // 监听滚动事件，实现懒加载
    function onScroll() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const clientHeight = window.innerHeight;
        const scrollHeight = document.documentElement.scrollHeight;
        // 判断是否接近底部（20px阈值）
        if (scrollTop + clientHeight >= scrollHeight - 20) {
            renderBatch();
            // 如果全部加载完毕，移除监听器
            if (renderedCount >= bookmarks.length) {
                window.removeEventListener('scroll', onScroll);
            }
        }
    }

    // 为下载按钮添加点击事件监听器
    document.getElementById('downloadButtonIcon').addEventListener('click', () => {
            chrome.storage.local.get(null, (items) => {
            // 创建一个 Blob 对象，包含要下载的数据
            const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
            // 创建一个 URL 对象，用于表示 Blob 对象
            const url = URL.createObjectURL(blob);
            // 创建一个 <a> 元素，用于触发下载</a>
            const link = document.createElement('a');
            link.href = url;
            link.download = 'BBVBookmarks.json';
            link.click();
        })
    })

    // 为上传按钮添加点击事件监听器
    document.getElementById('uploadButtonIcon').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.click();

        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    chrome.storage.local.set(data, () => {
                        console.log('[Popup] 导入书签配置成功！', data);
                    });
                } catch (e) {
                    console.error("[Popup] 导入书签配置失败：JSON 文件格式不合法", e);
                }
            };
            reader.readAsText(file);
        });
    })
    // ========== WebDAV 同步 ==========
    const syncStatusEl = document.getElementById('syncStatus');
    const syncButtonIcon = document.getElementById('syncButtonIcon');

    // 设置状态行：text + 状态类（ok/err/默认灰）
    function setSyncStatus(text, state) {
        syncStatusEl.textContent = text;
        syncStatusEl.className = state || '';
    }

    // 打开时显示上次同步状态
    chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' }, (res) => {
        if (!res) return;
        if (!res.configured) {
            setSyncStatus('未配置 WebDAV 同步');
        } else if (res.syncStatus && res.syncStatus.lastSync) {
            const t = new Date(res.syncStatus.lastSync * 1000);
            const timeStr = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            if (res.syncStatus.lastResult === 'ok') {
                setSyncStatus(`上次同步：${timeStr}`, 'ok');
            } else {
                setSyncStatus(`上次同步失败：${res.syncStatus.lastError || '未知错误'}`, 'err');
            }
        } else {
            setSyncStatus('尚未同步');
        }
    });

    // 同步按钮
    syncButtonIcon.addEventListener('click', () => {
        syncButtonIcon.style.opacity = '0.5';
        setSyncStatus('正在同步…');
        chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (res) => {
            syncButtonIcon.style.opacity = '1';
            if (!res) {
                setSyncStatus('同步失败：无响应', 'err');
                return;
            }
            if (!res.configured) {
                setSyncStatus('未配置 WebDAV，正在打开设置…');
                chrome.runtime.openOptionsPage();
                return;
            }
            if (res.ok) {
                const t = new Date(Date.now());
                const timeStr = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                setSyncStatus(`同步完成：${timeStr}`, 'ok');
                // 同步可能拉取了新书签，刷新列表
                loadBookmarks();
            } else {
                setSyncStatus(`同步失败：${res.message}`, 'err');
            }
        });
    });
    // ==========

    // 设置按钮：打开 WebDAV 配置页
    document.getElementById('settingsButtonIcon').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    })
});