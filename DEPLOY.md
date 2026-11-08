# GitHub Pages 部署说明

> 当前线上地址：<https://liujerry-study.github.io/imperial-tombs/>
> 仓库：<https://github.com/LiuJerry-study/imperial-tombs>（Public，Pages 源：`main` 分支根目录）
>
> 后续更新：改完文件后 `git add -A && git commit -m "..." && git push`，Pages 会自动重新构建。

这个项目是**纯静态站点**：只有 HTML / CSS / JS，没有后端、没有构建步骤、没有 npm 依赖。
所以部署到 GitHub Pages 只需要「把仓库推上去 + 在设置里打开 Pages」。

仓库根目录就是站点根目录（`index.html` 在最外层），所有资源都用相对路径引用，因此放在
`https://<你的用户名>.github.io/<仓库名>/` 这种子路径下也能正常工作。

---

## 方式 A：网页建仓 + 命令行推送（不需要装任何额外工具）

1. 打开 <https://github.com/new>，仓库名填 `imperial-tombs`，可见性选 **Public**，**不要**勾选
   README / .gitignore / license（保持空仓库）。
2. 在本目录执行（把 `<你的用户名>` 换成实际用户名）：

   ```powershell
   git remote add origin https://github.com/<你的用户名>/imperial-tombs.git
   git push -u origin main
   ```

   第一次推送会弹出 GitHub 登录窗口（浏览器授权），授权一次即可。

3. 打开仓库页面 → **Settings → Pages**：
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，目录选 **/ (root)**
   - 点 **Save**
4. 等 1–2 分钟，访问 `https://<你的用户名>.github.io/imperial-tombs/`。

以后每次修改后 `git add -A && git commit -m "..." && git push`，Pages 会自动重新发布。

---

## 方式 B：GitHub CLI 一条命令（如果已经装了 `gh` 并登录）

```powershell
winget install GitHub.cli          # 未安装时先装
gh auth login                      # 浏览器授权一次
gh repo create imperial-tombs --public --source . --push
gh api -X POST repos/:owner/:repo/pages -f "source[branch]=main" -f "source[path]=/"
```

同样的地址：`https://<你的用户名>.github.io/imperial-tombs/`。

---

## 部署前自检

```powershell
node tests/geo.test.mjs        # 9 项几何/坐标测试
node tests/map.zoom.test.mjs   # 22 项地图引擎测试（缩放/瓦片/底图切换）
```

站点在 GitHub Pages 上通过 **HTTPS** 访问，高德瓦片、OpenStreetMap 都是 https 资源，
不会有混合内容问题；`localStorage`（行程、打卡）在 https 下也正常工作。

---

## 注意事项

- **底图版权**：高德瓦片只适合个人学习/旅行规划使用；如果要长期公开部署、给很多人用，
  建议换成有授权的底图服务（高德/百度/天地图等的正式 API Key）或自建瓦片。
  OpenStreetMap 数据遵循 ODbL，页面右下角已保留署名。
- **没有后端**：行程和打卡存在访问者自己的浏览器里（`localStorage`），换设备不会同步。
- **仓库里包含 `data/`**：原始 JSON/CSV 与构建脚本也一并公开，便于复核坐标来源；
  如果只想发布页面，可以只保留 `index.html`、`css/`、`js/` 三个部分。
- 想绑定自定义域名：仓库 Settings → Pages → Custom domain，再按提示加一条 CNAME 解析。
