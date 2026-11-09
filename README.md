# 花果山 · 个人主页

一个带后台的个人主页：前台展示代表作、成果年表和年度总结；后台可以新增、编辑、删除成果，上传图片/视频/附件，修改个人资料。

- 零依赖：只需要 Node.js 18 及以上，不用 `npm install`
- 数据存成 JSON 文件，上传的文件放在 `uploads/`，备份和迁移就是拷两个文件夹

## 本地运行

```bash
cd homepage
node server.js
```

- 主页：<http://localhost:8080>
- 后台：<http://localhost:8080/admin>

换端口：`PORT=3000 node server.js`（Windows PowerShell 用 `$env:PORT=3000; node server.js`）。

## 后台密码

- 修改：登录后台 →「设置」→「修改密码」
- 忘记密码：在服务器上运行 `node server.js --set-password 新密码`（至少 8 位），然后重启服务
- 全新部署时如果没有 `data/config.json`，首次启动会自动生成一个随机密码并打印在控制台；也可以用环境变量 `ADMIN_PASSWORD` 指定

## 日常使用

| 想做的事 | 在后台哪里 |
| --- | --- |
| 添加新成果 | 「成果」→「新增成果」，拖入图片、视频、PDF/PPT/HTML 附件 |
| 修改或删除成果 | 「成果」列表每行的「编辑」「删除」 |
| 放进首页代表作 | 编辑时勾选「放进首页『代表作』」（显示最近 6 条） |
| 暂时隐藏某条 | 编辑时取消「在主页公开」 |
| 改简介、链接、年度总结、首屏变换的词 | 「个人资料」 |
| 清理删掉成果后残留的文件 | 「设置」→「清理未使用的文件」 |

小提示：

- 图片在浏览器里自动压缩到 2000 像素以内再上传；视频请用 MP4（H.264）
- 详细介绍里空一行分段，以 `- ` 开头的行会显示成列表
- 日期可以写 `2026-11-05`、`2026-11` 或 `2026`
- 每条成果都有独立链接，形如 `https://你的域名/#a/成果ID`，可以直接分享

## 目录结构

```
homepage/
├── server.js          服务端（静态文件 + 接口 + 上传）
├── data/
│   ├── db.json        全部成果和个人资料
│   ├── config.json    密码哈希和会话密钥（勿外传，已在 .gitignore）
│   └── backups/       每次保存前的自动备份，保留最近 30 份
├── uploads/           上传的图片、视频、附件（seed/ 是初始素材）
└── public/            前端页面
    ├── index.html     主页
    ├── admin.html     后台
    ├── css/  js/
```

误删恢复：停止服务，把 `data/backups/` 里合适的那份复制为 `data/db.json`，再启动。

## 部署到 Render

仓库里已有 `render.yaml`，按 Blueprint 方式一键创建：

1. 登录 <https://dashboard.render.com>，用 GitHub 账号授权 Render 访问本仓库
2. 点 **New → Blueprint**，选择 `huaguoshan-homepage` 仓库
3. 按提示填写 `ADMIN_PASSWORD`（后台初始密码，至少 8 位），确认创建
4. 等部署完成，打开 `https://<服务名>.onrender.com`，后台是 `/admin`

之后每次 `git push` 到 `main`，Render 会自动重新部署。

**关于数据保存**：Render 服务器自带的硬盘是临时的，重新部署、重启或休眠后会还原。`render.yaml` 给服务挂了一块 1GB 持久化硬盘（`/var/data`），成果数据、上传文件和后台密码都存在上面，不会丢。

- 持久化硬盘需要付费实例（starter 起）。想用免费实例：删掉 `render.yaml` 里的 `disk` 段，把 `plan` 改成 `free`。这时线上后台的修改会在重启或休眠后丢失，只能在本地改好再 `git push`
- 硬盘第一次启动时会从仓库的 `data/db.json` 复制初始数据。上线后以线上后台为准，仓库里的 `db.json` 不会再覆盖线上数据
- 仓库自带的 `uploads/seed/` 素材直接从代码目录读取，不占硬盘空间
- 免费实例闲置 15 分钟会休眠，下次访问要等几十秒唤醒
- 国内访问 `onrender.com` 域名可能不稳定，建议在 Render 的 Settings → Custom Domains 里绑定自己的域名

## 部署到自己的服务器

需要一台能跑 Node 的服务器（云主机、轻量服务器都行）。**不能**部署到 GitHub Pages 这类纯静态托管，因为上传和编辑需要服务端。

1. 把整个 `homepage/` 目录传到服务器
2. 用 pm2 之类的进程守护启动：

   ```bash
   npm i -g pm2
   cd homepage
   TRUST_PROXY=1 PORT=8080 pm2 start server.js --name homepage
   pm2 save
   ```

3. 用 Nginx 反向代理并配 HTTPS，关键配置：

   ```nginx
   server {
       server_name example.com;
       client_max_body_size 500m;          # 默认 1m 会挡住图片和视频上传

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $host;    # 必须保留，后台会校验请求来源
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_request_buffering off;     # 大文件边传边写
       }
   }
   ```

   走反向代理时设置 `TRUST_PROXY=1`，登录限流才能拿到访客真实 IP，HTTPS 下的登录 Cookie 也会带上 Secure 标记。不经过代理、直接对外暴露时不要设置它。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址，只想本机访问可设为 `127.0.0.1` |
| `MAX_UPLOAD_MB` | `500` | 单个上传文件的大小上限 |
| `TRUST_PROXY` | 不设置 | 在 Nginx、Render 等反向代理后面时设为 `1` |
| `ADMIN_PASSWORD` | 不设置 | 仅在首次启动、还没有 `config.json` 时生效 |
| `DATA_DIR` | `./data` | 数据目录（`db.json`、`config.json`、备份），指向持久化硬盘 |
| `UPLOAD_DIR` | `./uploads` | 上传文件目录，指向持久化硬盘 |

## 安全说明

- 密码用 scrypt 加盐哈希保存；登录态是签名的 HttpOnly Cookie，7 天有效；修改密码后所有旧登录失效
- 同一 IP 连续输错 5 次密码锁定 10 分钟
- 所有写操作都要登录，并校验请求来源，防止跨站提交
- 上传只接受图片、音视频和常见文档格式；上传的 HTML（如路演页）在沙箱里运行，拿不到后台登录态
- 字体来自 `fonts.googleapis.cn`，加载失败会自动回退到系统字体，不影响使用
