# BiliBili 视频书签

一个 Chrome / Edge 浏览器扩展（Manifest V3），用来方便记录、跟踪 B 站视频播放位置并一键跳转到上次观看位置。


## 功能特性

- **一键收藏**：视频下方工具栏出现加号按钮，点击即可将当前视频加入书签，并自动追踪播放进度（每 5 秒更新一次）
- **书签管理**：popup 列表展示所有书签，支持跳转回记录位置、删除、进度条可视化
- **分P视频支持**：通过 `webNavigation` 监听 SPA 路由切换，分P视频切换 P 后按钮与书签 key 自动跟随
- **多分P收藏策略**（设置页可切换）：
  - 新收藏覆盖旧收藏：同一视频只保留最新收藏的那一条分P记录
  - 全部保留：同一视频的不同分P同时收藏、同时显示
- **标题悬停**：书签标题过长时鼠标悬停显示完整内容
- **WebDAV 同步**：
  - 手动同步 + 可选自动同步（每 30 秒拉取并合并一次）
  - 逐条"最后写入优先"合并，两边各自新增/修改/删除的书签都会保留
  - 删除墓碑机制，删除的书签同步后不会被拉回
  - 跨设备备份与转移
- **JSON 导出 / 导入**：书签可导出为 JSON 文件备份，也可重新导入
- **深色科技风 UI**：popup 与设置页统一深色渐变 + 霓虹青/粉色点缀

## 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"，选择本项目目录
4. 打开 B 站视频页即可看到工具栏中的加号按钮

## 使用说明

1. 在 B 站视频页点击工具栏的**加号按钮**收藏当前进度
2. 点击浏览器工具栏的扩展图标打开 popup，管理书签（跳转 / 删除 / 同步 / 导入导出）
3. 点击 popup 的**设置**按钮进入设置页：
   - 配置 WebDAV 服务器（地址 / 用户名 / 密码 / 远程路径 / 自动同步开关），可先"测试连接"
   - 选择同一视频多分P的收藏策略（覆盖 / 全部保留）
4. 双击 popup 左上角的版本号徽章可访问项目主页

## 技术栈

- Chrome Extension Manifest V3（ES Module Service Worker）
- `chrome.storage.local`（持久化）+ `chrome.storage.session`（读缓存）
- `chrome.alarms`（自动同步周期轮询，规避 SW 易失性）
- `chrome.webNavigation.onHistoryStateUpdated`（分P切换检测）
- WebDAV 协议（纯 `fetch` 实现：PROPFIND / GET / PUT / MKCOL，Basic 认证）
- 三层消息总线：popup ↔ background ↔ content script

## 项目结构

```
├── manifest.json            # 扩展清单
├── Background/
│   ├── background.js        # 消息中枢：收藏/删除/同步/进度更新
│   ├── webdav.js            # WebDAV 客户端 + 同步编排（合并/墓碑）
│   ├── dedupe.js            # 同一视频同一P去重（分P归一化）
│   ├── cache.js             # session 缓存构建与刷新
│   ├── p_change_tracker.js  # 分P切换监听
│   └── uuid.js
├── ContentScript/
│   ├── D_DOM.js             # 视频元素/key 解析
│   ├── C_Kit.js             # 进度追踪
│   ├── B_Content.js         # 注入加号按钮
│   └── A_MessageHandler.js  # 消息处理（跳转/追踪/切P）
├── popup.html / popup.js    # 书签列表 popup
├── options.html / options.js# 设置页（WebDAV + 书签策略）
├── content.css
└── icons/                   # 扩展图标与按钮图标
```

## 注意

- WebDAV 密码以明文形式保存在本机浏览器存储中，请仅填写专用账号

## 项目主页

<https://vc-li.github.io/>
