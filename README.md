# BiliCDNSelector

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/lsy223622/BiliCDNSelector/actions/workflows/ci.yml/badge.svg)](https://github.com/lsy223622/BiliCDNSelector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-00aeec.svg)](LICENSE)
[![Install userscript](https://img.shields.io/badge/Install-userscript-00aeec.svg)](https://raw.githubusercontent.com/lsy223622/BiliCDNSelector/main/BiliCDNSelector.user.js)

BiliCDNSelector 是一个用于 Bilibili 网页播放器的 CDN 测速与自动选择用户脚本。它会基于当前视频的有效播放地址生成一组国内官方 UPOS CDN 候选，通过小型 Range 请求实测线路表现，并将表现更好的 CDN 放到播放器的优先线路中。

本项目与哔哩哔哩（Bilibili）无隶属或官方合作关系。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 点击 [安装 BiliCDNSelector](https://raw.githubusercontent.com/lsy223622/BiliCDNSelector/main/BiliCDNSelector.user.js)。
3. 如果同时安装了其他会改写 Bilibili 播放地址的脚本，请避免同时启用多个 CDN 选择功能；已验证的搭配见下方兼容性说明。
4. 打开或刷新 Bilibili 视频页。

脚本通过 `@updateURL` 从本仓库的 `main` 分支检查更新。

## 兼容性

BiliCDNSelector 0.2.5 已针对 [Make Bilibili Great Than Ever Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before) **1.9.1** 修复 XHR 响应读取递归和首屏播放数据监听冲突。兼容验证覆盖 Chromium 页面上下文中的两种加载顺序，并已收到实际使用通过反馈。

同时使用时，请在对方脚本的菜单中保持以下两项关闭，由 BiliCDNSelector 负责 CDN 测速和线路选择：

- 「防止叔叔用 P2P CDN 省下纸钱」（`no-p2p`）
- 「多 CDN 分片并发并行下载视频」（`thread-ripper`）

其他功能可以按需开启，无需调整两个脚本的加载顺序。

## 线路如何选择

Bilibili 的 playurl API 可能只提供少量原生 CDN 线路。脚本从其中安全的普通 UPOS 签名 URL 中选取来源，只替换 hostname，生成 14 条内置国内 CDN 候选。路径、查询参数、转义和签名均保持原样。随后脚本串行测试各线路的两个 256 KiB Range，根据成功率、最慢完成时间等健康指标排序；可用的原生地址保留作为后续回退。

候选覆盖 Ali、Alib、Alio1、Cos、Cosb、Coso1、HW、HWB、HWO1、08c、08h、08ct、TF-HW 和 TF-TX。控制面板可以自动选择、使用 B站原始线路，或手动指定其中一条。自动模式按测速排名依次安排首选和回退；手动模式保留指定节点为首选，其余线路按相同排名回退。没有有效测速结果时沿用原生回退顺序。手动线路不可安全生成时，播放器保留可用的原生地址。

完整成功测速最多涉及 16 条线路（14 条预设加最多 2 条原生线路），按每条两个 256 KiB Range 计算约 8 MiB。若候选较少或命中缓存，实际传输更少。成功结果缓存 4 小时，失败结果缓存 15 分钟；当前首选线路最多每 15 分钟做一次轻量复核。测速在后台延迟启动，不阻塞初始播放。面板的「重新测速」可以强制重测当前相关线路。

## 安全与隐私

- 仅从兼容的普通 UPOS URL 生成候选；Akamai、PCDN、MCDN、IP、302 类和特殊端口线路不能作为合成来源。
- 不合成 Akamai URL。API 原样提供的 Akamai 等原生 URL 仍可作为播放回退线路。
- 所有合成线路失败时，恢复可用原生线路的主备顺序。
- 本地只保存设置、面板位置和按 hostname 汇总的健康指标，不保存完整媒体 URL、签名、cookie 或 token。
- 不发送遥测或用户网络统计数据。

脚本使用 `@grant none`，匹配 `https://www.bilibili.com/*` 和 `https://m.bilibili.com/*`。主要目标环境是桌面 Chromium 与 Tampermonkey。

## 本地开发

需要 Node.js 18 或更高版本，无运行时依赖：

```bash
npm run check
npm test
```

`BiliCDNSelector.user.js` 可直接安装；`BiliCDNSelector.test.js` 包含 URL、安全边界、测速缓存和浏览器拦截测试。贡献与漏洞报告分别见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。提交问题时请勿粘贴带签名的完整媒体 URL。

## 致谢与许可证

本项目基于 [stabruriss/bilibili-accelerator](https://github.com/stabruriss/bilibili-accelerator) 修改，其浏览器拦截、候选线路处理、测速、排序、回退和控制面板构成了本项目的基础。国内 CDN host 清单参考 [bggRGjQaUbCoE/PiliPlus](https://github.com/bggRGjQaUbCoE/PiliPlus) 的 `lib/models/common/video/cdn_type.dart`。

[MIT](LICENSE) © 2026 stabruriss, lsy223622。保留上游版权声明。
