# game_dev · 关卡复刻流水线

这个分支只放 **`board-extract` 工具包**与它的流程文档，是从本地 `game_dev` 工作区抽出来的子树。
工作区里的原游戏截图、关卡提取产物（`refs/`）、两个原型工程（`prototypes/`）和素材库都**不在这个分支里**。

## 它做什么

把一张游戏截图变成可玩的关卡页面，并且能自动比对复刻结果：

```
截图 → 识别牌面 → 自动命名 → 还原叠放 → 出可玩页 → 截图 → 并排比对
```

针对的是"同点可叠十几张"的堆叠消除类玩法（羊了个羊那一类），核心是把**关卡排布**从截图里量出来，
而不是手工码关卡。

## 快速开始

```bash
cd tools/board-extract
npm ci
node bin/board-extract.mjs --help
```

```bash
# 只看识别质量，秒回：几张牌 / 几张可点 / 几个簇 / 牌面尺寸
node bin/board-extract.mjs check --shot board.png

# 全链：识别 → 命名 → 建模 → 可玩页 → 截图对比 → 报告
node bin/board-extract.mjs run \
  --shot board.png --out out/2026-11-21 \
  --game "游戏名" --level "每日关卡" \
  --types types.json --library library

# 模板库：学一次，下一关自动命名
node bin/board-extract.mjs learn --tiles out/detect/tiles.json --types types.json --library library
node bin/board-extract.mjs eval  --tiles out/detect/tiles.json --types types.json
```

产物落在 `--out` 目录：`level.json`（每张牌的坐标/类型/层级）、`playable/index.html`（单文件可玩页）、
`compare.png`（原图与复刻并排）、`run.json` / `run.md`（输入、参数、耗时、体检指标）。

## 从安卓手机取图

```bash
node bin/board-extract.mjs capture --out shots/phone.png      # adb screencap 写设备再 pull
node bin/board-extract.mjs run --shot shots/phone.png --out runs/x/2026-11-21
```

`capture` 依次在 PATH、WinGet 安装目录、Android SDK 里找 adb；只连一台设备时自动选中，
并打印屏幕分辨率。之所以不用 `adb exec-out screencap`，是因为 Windows 下的换行转换会把 PNG 弄坏。

安卓模拟器一样能用：Android Studio 的 AVD 直接出现在 `adb devices`，第三方模拟器先
`adb connect 127.0.0.1:<端口>`（BlueStacks/雷电 5555、MuMu 7555、夜神 62001，以设置为准）。

整屏截图不只是棋盘，用 `--crop x,y,w,h` 只把棋盘交给识别；裁剪区就是落盘的 `shot.png`，
`level.json` 的坐标全部相对它，越界会直接报错。

分辨率不同的图还要告诉它一张牌多大：`--tile 36x37`，尺寸阈值会按比例跟着走。不告诉也行——
认出的牌面与配置对不上时它会自报尺寸（`about 64x66 ... pass --tile 64x66`），照提示重跑即可。
参考截图缩到 1/2、1/3、1/4 实测：默认只认出 28 / 1 / 0 张，加 `--tile` 后三种都是 38 张、19 可点。

换游戏时配色也会不同：`check` 会打印 `palette`（占比最高的 5 种颜色 + 配置的 face/dim 覆盖多少像素），
覆盖率低于 2% 时直接给出 `colours` 提示，让你从 `palette.top` 取值写进配置，而不是只回一句「0 张牌」。

`--crop` 同时决定可玩页的缩放基准（`boardWidth` 取裁剪宽度），所以手机图只要 `--crop` + `--tile` 两个参数，
不用再手写配置；配置文件里显式写了 `boardWidth` 仍以配置为准。

遇到完全陌生的游戏，先让工具提配置：

```bash
node bin/board-extract.mjs probe --shot shots/game.png --crop 110,320,660,400 --out config.json
node bin/board-extract.mjs run   --shot shots/game.png --crop 110,320,660,400 --config config.json --out runs/x
```

`probe` 只提「格子内部确实是这个颜色、且匹配到的是亮面、单张占画面 0.3%-12%」的候选——
阴影会被排除，因为它会把 z 序反过来。提完务必看 `overlay.png` 再信它。

可玩页按手机做的：画布保持 720 宽的逻辑坐标、按视口等比缩放，按设备像素比渲染；
托盘按可用宽度反算每格尺寸，不会越出画布；点击走 `pointerdown` + `touch-action: none`，
不触发页面滚动或双击缩放；屏幕上有「撤回」按钮，与 `Z` 等价。

## 门禁

```bash
npm run ci     # 4 个冒烟测试 + 真实截图跑全链 + 不变量断言
```

其中最关键的一条：**按还原出的层级算出的"可点集合"必须等于截图里的亮面**（误放行 0、误挡 0）。
识别、整牌还原、层级判定任一环改坏，这行立刻红。

**真实截图夹具不随本分支发布**——`test/fixtures/board.png` 是一张别人的游戏画面。
没有夹具时 `npm run ci` 只跑 4 个冒烟测试并注明跳过，仍然退出 0。要复现完整门禁：
把自己的截图放到 `test/fixtures/board.png`，再按你的关卡改 `scripts/ci.mjs` 里的 `GOLDEN` 数字。

## 依赖

- Node 18+，运行时只依赖 `pngjs`
- 截屏与并排比对可选依赖本机 Chrome + `playwright-core`；没有浏览器时用 `--no-browser` 跳过，不报错

## 边界（设计取舍，不是 bug）

- 图标用 emoji 替身，不复用原美术
- 完全被压住的牌不在模型里；只露一角的牌会给出低置信度，宁可说不知道
- 不支持加密的 `.wxapkg` 解密，也不含服务器下发的关卡原始数值
- 层级在"两牌重叠且都亮或都暗"时是任意的，其余由描边判定

详细原理、实测数字与批量用法见 [`docs/关卡复刻流水线.md`](docs/关卡复刻流水线.md)，
版本变更见 [`tools/board-extract/CHANGELOG.md`](tools/board-extract/CHANGELOG.md)。
