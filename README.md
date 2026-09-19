# 推箱子 BoxPusher

一个极简像素风的推箱子（类似仓库番）小游戏，单文件 HTML + PWA，无需构建工具，直接部署到 GitHub Pages 即可玩。

- 支持方向键 / WSAD / 屏幕方向键 / 触屏滑动四种操作
- 撤销、重来、慢动作（逐帧观察角色动作）
- 地板 / 墙壁 / 箱子三类外观可在游戏内「配色」面板自选，选择会保存在本地
- 可安装为主屏幕 App（standalone 模式）

## 在线试玩

部署到 GitHub Pages 后访问：`https://<你的GitHub用户名>.github.io/<仓库名>/`

## 本地运行

直接双击 `index.html` 用浏览器打开即可。如果贴图加载不出来（部分浏览器对本地 `file://` 协议下的图片请求有限制），可以在项目目录下起一个本地服务器：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 项目结构

```
index.html          游戏主文件（结构/样式/逻辑全部内嵌，图片素材外链）
manifest.json        PWA manifest
assets/
  Player/             角色12个动作帧（上下左右各3帧，行走与推箱共用同一套）
  Ground/              地板贴图，3色 × 普通/目标点两态
  Blocks/               墙壁贴图，4款配色
  Crates/                箱子贴图，5色 × 普通/已就位两态
  icons/                  PWA / 主屏幕图标
```

## 关卡格式

关卡用经典 Sokoban 文本符号表示，写在代码里的 `LEVELS` 数组中：

| 符号 | 含义 |
| --- | --- |
| `#` | 墙 |
| ` ` | 空地 |
| `.` | 目标点 |
| `$` | 箱子 |
| `*` | 箱子 + 目标点（已就位） |
| `@` | 玩家 |
| `+` | 玩家 + 目标点 |

这个格式和网上常见的免费 Sokoban 关卡库（如 Microban）兼容，方便以后直接导入更多关卡。

## 素材来源

角色、地板、墙壁、箱子贴图来自 [Kenney Sokoban Pack](https://kenney.nl)（CC0 协议），细节见 [ASSETS_LICENSE.md](./ASSETS_LICENSE.md)。

## License

代码部分见 [LICENSE](./LICENSE)（MIT）。
