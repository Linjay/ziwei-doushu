# 当前待修复问题

2026-11-01 review。维护者要求先提交当前实现，以下问题未修复。原单元测试通过不能替代这些场景的验收。入口见 [HANDOFF](../HANDOFF.md)。

## P1：同浏览器另一标签页换账号后，旧页将 A 的历史写入 B

位置：`lib/use-chart-history.ts` 的 `flush()` / `accountRequest('/api/history', 'PUT', snapshot)`；`components/AccountProvider.tsx` 的会话刷新；`app/api/history/route.ts` 的写入校验。

已复现：A 在标签页 1 打开自己的命盘；标签页 2 退出并用已记住的 B 登录。标签页 1 的 React 状态仍是 A，但请求 Cookie 已变成 B。在旧页追问并保存，B 原本为空的历史出现 A 的私人命盘。客户端响应后检查 `owner.current` 无法阻止已发生的写入。

```powershell
npm run build
npm run repro:cross-tab
```

脚本：[cross-tab-account.mjs](../scripts/repros/cross-tab-account.mjs)。创建两个共享浏览器上下文的页面、合成资料、独立本地服务 / 数据库、假 CLI；不是两个隔离浏览器。当前输出 `oldTabStillShowsA:true`、`sessionIsNowB:true`、`bReceivesAPrivateRecord:true`、`reproduced:true`。报告在 `.codex-local/review-cross-tab-latest.json`，包含临时目录位置。

修复方向：账号相关请求显式带预期用户身份，服务端在读写前与会话核对；不一致拒绝并触发客户端清理 / 刷新。补跨标签页账号变更通知；切换时停止旧 AI 流，清理旧账号草稿和待同步队列，避免旧响应进入新账号。仅增加 BroadcastChannel 或事后检查不能独立保证隔离。

验收：同浏览器两页 A→B、B→A、退出、过期、设备恢复、飞行中的写入 / AI 请求；B 不获得 A 的记录、档案或对话，A 记录不丢失，旧页要求恢复正确账号。覆盖单盘、合盘、专业 / 通俗和后台同步。补服务端身份不符的拒绝测试，不能只测两个隔离浏览器。

## P2：修改密码后复用当前设备的旧凭据

位置：`lib/server/device-auth.ts` 的 `sessionHeaders()` 复用 `tokenOf(request)`；`app/api/account/route.ts` 改密后的 `sessionHeaders(updated, request)`。

已复现：注册后保留旧 `mingli_device` Cookie；修改密码后，只携带旧设备 Cookie、不携带原会话，向 `/api/auth/device-login` 发送 `{}`，仍返回 200。会话及绑定撤销后重建，但设备 token 未更换，复制过的旧凭据重新获得免密登录能力。

```powershell
npm run repro:device-token
```

脚本：[device-token-rotation.ts](../scripts/repros/device-token-rotation.ts)。调用实际路由、独立本地库、合成账号，不打印 Cookie / 密码。当前输出 `currentDeviceTokenRotated:false`、`oldDeviceTokenAloneLoginStatus:200`、`oldCredentialStillAuthenticates:true`；报告在 `.codex-local/review-device-token-latest.json`。

修复方向：改密路径轮换当前设备随机秘密及数据库哈希，发出新 Cookie，旧设备凭据失效。处理同设备其他已记住账号的绑定迁移，保留切换语义；不能只轮换会话 Cookie，或误删其他账号历史。

验收：旧会话和仅旧设备凭据均不能登录（401），新会话和凭据可用；其他设备撤销；当前浏览器其他账号的选择 / 移除正常；普通档案修改不误登出，退出 / 忘记设备 / 旧库迁移回归通过。

## P2：首页浏览器测试受系统“减少动态效果”影响

位置：`scripts/home-browser.test.mjs` 的初始媒体状态及 `animations-pause-persist-and-respect-reduced-motion` 检查。

本机系统返回 `prefers-reduced-motion: reduce`，页面正确显示禁用的“已遵循减少动态效果设置”；测试直接查找“暂停动画”，失败为 `Missing button 暂停动画`。`npm run test:browser` 链到这里停止，不能称整套回归通过。页面尊重系统偏好，此项缺陷在测试前置条件。

复现：启用减少动态效果的系统执行 `npm run test:home-browser`，无需真实 AI。报告在 `.codex-local/home-browser-latest.json`。

修复方向：创建页面后、首次导航前，通过 CDP `Emulation.setEmulatedMedia` 显式固定初始 `prefers-reduced-motion` 为 `no-preference`，再独立验证 `reduce` 和恢复状态；无需修改系统或移除无障碍支持。review 临时副本已验证首页 9 条完成，正式脚本未修改。

验收：系统 reduce / no-preference 两种情况下，原始 `npm run test:browser` 全链都通过（目前 41 条：移动 14 / 快速账号 7 / 首页 9 / 双模式图示 11）；reduce 时动画停止，手动暂停与刷新状态保持。按实际环境记录结果，不把临时副本结果当正式代码结果。

## 其他产品与数据缺口

- 百科仍有空占位，不等同上游商业资料库；所选运限 / 年份未完整进入 AI 上下文。
- 海外时区、夏令时及流派表单入口需完善；新排盘保留旧结果，不能原地覆盖旧解读。
- 13 维资料不等于 13 个交互主题；主界面目前六主题，后续入口和解释需单独设计。
- 多平台实体手机、安全区、横竖屏、后台恢复、弱网 / 断流、读屏和异机完整备份恢复待验收。单台手机输入发送正常的反馈不能代表全部设备。
- 下载资料和索引独立备份，混合授权内容不能直接称为可商用。规模、覆盖及过滤见 [资料检索](./资料检索.md)。
