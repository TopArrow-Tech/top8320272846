# 幕控 StagePilot 项目总览

应用 ID：stagepilot。运行时：顶箭内置 Node 24；入口：server/index.js；本机管理服务只绑定 TOPARROW_APP_PORT / 127.0.0.1，健康检查 /__health。顶箭发布编号由平台分配；应用维护版本在 server/app-info.json 统一维护，当前为 0.1.0，通过本机状态API返回并显示在左上角应用名称下方。后续每次用户可见更新递增该版本，不向 manifest.json 添加 version。

## 结构与职责

- server/index.js：本机管理 HTTP、按需局域网 HTTP、WebSocket 配对/播放控制、上传与安全边界。
- server/store.js：node:sqlite 数据库初始化、事务和设置；数据库版本记录为 1。
- server/validation.js：场景图层的几何、颜色、类型和素材归属验证。
- public/app.js：本地 React 18 主控台；使用 createElement，无编译器，无在线资源。
- public/display.js：独立浏览器显示端，避免让电视承担 React 主控台开销。
- public/styles.css：深蓝与青绿主题、窄屏布局、场景画布和显示端。
- lang/zh.json、en.json：两套集中管理的界面文案。
- public/vendor、vendor/ws：随包提供 React / ReactDOM 18.3.1 与 ws 8.18.3，包含 MIT 许可证。
- icon.png：联屏指挥专属图标，448×448，低于 200KB。
- tests/integration.test.js：启动、权限、素材、配对、WebSocket和展示恢复测试。
- scripts/package.js：跨平台白名单 ZIP 打包与图标、文件数、体积检查。

## 功能

活动创建、编辑、复制、归档与删除；逻辑屏幕管理；本地图片/视频导入与预览；多屏场景与分区图文叠加；按百分比拖动、配置图层、层序、适配、透明度和独立视频音量；场景保存、复制、排序参数与执行；局域网配对、屏幕绑定、在线状态及播放偏差；暂停、恢复、黑屏静音和停止；重启后人工恢复展示。

## 数据

所有运行数据只写 TOPARROW_DATA_DIR：db、media、tmp、logs，以及首次手动备份时创建的 backups。开发 data/ 已被 Git 排除，打包只取源程序和静态依赖，不取 data 或 .git。数据库保存 UUID 文件名，不保存开发电脑路径。上传不执行用户内容，仅接收校验过的图片和视频（单个最大 256MB）。

## 重要边界

- 仅对可信私有 IPv4 局域网开放 HTTP；不加密，需要明确勾选接受。主控永远不对局域网开放。
- 用户开启后才监听选定网卡；30 分钟无设备活动自动关闭。重启始终关闭局域网并等待人工恢复场景。
- 浏览器同步采用统一时钟、提前 3 秒起播、250ms 校正循环；不保证逐帧同步，偏差需要实机测量。
- 电视需支持 Fetch、WebSocket、HTML5 视频等现代浏览器能力。格式校验不代表编解码器兼容。推荐 H.264 MP4。
- macOS 上的本机验证不代表 Windows 或真实电视已验证，详见 testcase。

## 使用指南

应用内侧栏与右上角均提供“使用指南”，支持 #help 直达。文件版见 _doc/使用手册.md 和 _doc/User_Guide.md。

执行规则：同活动仅更新场景中配置的屏幕，其余屏幕继续原播放；每屏拥有独立时间轴。多个屏幕可配置在一个场景中统一切换。

图层 effect 保存 type 与 duration（1–120秒），默认 none；public/effects.js 共享确定性动画计算，用于编辑预览与显示端。显示端按每屏时间轴驱动滚动、淡入淡出、呼吸缩放；暂停时动画也暂停。显示端地址使用应用双语右键菜单，其他位置保留系统菜单。

输入框：public/number-input.js 提供数字解析/提交工具；public/app.js 的 NumberInput 将原始编辑文本与数值分离，处理清空、前导零、步长与范围。素材支持 MOV 容器导入，但不转码，播放能力取决于设备编解码器。

删除：server/deletion.js 提供引用影响预览、确认指纹、事务解除引用、受影响屏幕停止及恢复快照清理；界面不会自动删除用户内容，需确认。页面操作提示以反馈代次隔离，切换页面/活动清除旧提示与迟到结果。

## 归档管理

归档活动单独在“归档管理”搜索、查看清单、恢复或永久删除。活动管理与顶部选择器只列未归档活动。

## 工作数据备份

按最新确认方案提供全局手动工作数据备份；server/work-backups.js 管理数据目录 backups 内的独立文件、磁盘列表、打开目录和删除；server/backup-file.js 负责可分享文件的校验、引用映射及事务恢复。无代码备份、无定时/节点备份。恢复前保留当前工作安全备份，显示设备需重新配对。详见 work_backups_architecture.md。
