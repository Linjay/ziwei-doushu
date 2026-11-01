# NAS 部署说明

本仓库提供可复用的 NAS 容器部署配置。当前提交是带已知问题的开发基线；先读 [交接](../HANDOFF.md) 与 [待修复问题](./KNOWN_ISSUES.md)。既有地址、运维记录及凭据保存在维护者私有 Homelab 项目，本次 Git 提交没有更新线上服务。

## 配置与目录

需要可运行 Node.js 24 Linux 镜像与 Codex CLI 的 Docker / Compose 环境；既有部署为 x86_64。选择 NAS 专用目录作为部署根目录，使用仓库 `compose.yaml`，将 [`runtime.env.example`](../deploy/runtime.env.example) 复制为部署根目录 `runtime.env`。

| 相对路径 | 用途 |
| --- | --- |
| `compose.yaml` | 本服务的容器配置 |
| `runtime.env` | 真实入口、模型、代理等配置，不提交 Git |
| `data/` → `/data` | 用户、档案、命盘与对话 SQLite，包含 WAL |
| `codex/` → `/home/node/.codex` | 本服务专用 CLI 配置和认证，不提交 Git 或打进镜像 |
| `knowledge/` → `/knowledge:ro` | 单独准备的原始资料、resources 和检索索引 |

默认绑定 `127.0.0.1:13100`；跨主机 / 容器的反向代理须显式设置 `MINGLI_BIND_ADDRESS` 为代理可访问的 NAS 地址，同时设置 `MINGLI_PORT`、`NEXT_PUBLIC_SITE_URL` 和 `APP_ALLOWED_ORIGINS`。后两者必须带协议及实际端口；允许来源为逗号分隔的精确站点地址。公网地址修改后要重新构建，因为它也是构建参数。代理如有需要，通过受保护的配置传入。

默认强制账号登录、检索必需、`personal` 授权模式。知识库不随克隆下载；临时开发可显式设置 `KNOWLEDGE_REQUIRED=false`，线上保留 `true` 并准备有效索引。模型变量为空时使用服务专用 CLI 配置；核对部署账号实际可用模型。

容器以 `node` 非 root 用户运行；挂载目录须能被其读写（只读索引需可读）。`runtime.env` 建议权限 0600，认证目录 0700。保持重启策略、内存上限、日志轮转、`no-new-privileges`、移除 capabilities 和健康检查。

## CLI 与资料

镜像安装固定版本 Codex CLI；隔离模板见 [`codex.config.toml.example`](../deploy/codex.config.toml.example)。只将本服务需要的认证放入持久认证目录，不复制个人全局插件、MCP、其他应用凭据或记忆。不要把 `auth.json` 或完整环境变量贴进日志。认证由账号持有者在受保护环境完成，浏览器用户不需要提供 CLI 账号。

应用通过 CLI 调用在线模型，NAS 不依赖开发电脑在线，也不运行本地 GPU 模型。站内用户共享服务端 CLI 额度。Dockerfile 将 Node 内置公共根证书写入系统证书文件，保持 TLS 校验开启。

资料布局、索引重建、约 18 GB 原件及约 11 GB 索引见 [资料检索](./资料检索.md)。只读索引与用户数据库独立。代码和混合授权数据分别遵守许可，不代表取得上游商用完整版。

## 构建与启动

在部署根目录执行；群晖可能需要本机 Docker 的显式路径和管理员权限。先核对当前版本、运行配置、挂载和备份，不能把公开默认配置覆盖到已有服务。

```sh
docker compose --env-file runtime.env config --quiet
docker compose --env-file runtime.env build app
docker compose --env-file runtime.env up -d app
docker compose --env-file runtime.env ps
docker compose --env-file runtime.env logs --tail 100 app
```

`config --quiet` 仅校验配置；完整 `config` / `inspect` 输出可能含代理凭据，不发布。`/api/health` 检查应用及必需资料索引，不能代替真实解读与账号验收。

## Lucky 转发

只更新目标域名子规则，上游为 NAS 实际监听地址及端口。保留客户端 Host、来源 IP 和协议头，关闭该子规则缓存并允许流式长连接；外部来源必须包含在 `APP_ALLOWED_ORIGINS` 中。应用处理账号认证，保持其他站点、DSM 认证、白名单、DDNS 和证书规则原样。

## 历史迁移、备份与回滚

账号库在 NAS；电脑开发库和旧浏览器缓存与它独立。迁移旧记录时，在原地址、原浏览器登录 / 恢复，导出 JSON，再在目标站登录并导入。JSON v1–v4 均可读，当前导出 v4，含单盘 / 合盘、六主题、专业 / 通俗、对话及出处。账号密码和设备凭据不在 JSON 中。文件包含出生资料，应私下保存。

每账号最多 1,000 条记录，单次导入 20 MB；每账号每小时最多 60 次 AI，服务同时两路。新单盘启动总览，恢复已有结果不自动重生成。主动切换空主题会开始解读，切回已有主题恢复缓存。

更新前保存 Compose、受保护运行配置、镜像标签和 SQLite 一致性快照。可用 SQLite `VACUUM INTO` 创建快照，不能漏掉 WAL 而只复制运行中的主库。原件清单及索引保留，更新应用无需重下全库。

回滚恢复上版镜像及配置，保留 `data/`、`codex/`、`knowledge/`，确认数据库格式兼容；不运行 `down -v` 或删除挂载。Lucky 回退仅针对该子规则，不覆盖整份旧配置。

验收至少包含健康、登录及指定记录返回、单盘 / 合盘、真实 CLI 流式及出处、刷新 / 跨浏览器恢复、JSON 下载与重导入、手机键盘 / 导航及原数据核对。用隔离临时账号，不修改已有资料；真实解读消耗在线额度。三项已知问题修复并回归后，再标记版本通过。
