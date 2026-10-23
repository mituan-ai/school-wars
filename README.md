# 校园战争 School Wars（同人重制）

致敬 GAMEDESIGN 的 Flash 游戏《School Wars》。玩法按原版 SWF 逐函数还原，美术和音效全部重新制作。

## 运行

```bash
npm install
npm run dev        # 开发服务器，浏览器打开显示的地址
npm test           # 全部规则与模拟测试
npm run sim        # 无头跑 200 局四 AI 观战局，输出统计（可加参数：局数 最长分钟）
npm run build      # 类型检查 + 生产构建到 dist/
```

端到端冒烟测试见 [tests/e2e/smoke.js](tests/e2e/smoke.js) 文件头的说明。角色图鉴在开发服务器的 `/dev/sprites.html`。

## 文档

- [docs/01_原版机制考证.md](docs/01_原版机制考证.md)：原版规则，每条都标了证据等级和 AS 源码行号
- [docs/02_重构方案.md](docs/02_重构方案.md)：技术方案、里程碑与当前进度

## 代码结构

```
src/core/        纯逻辑，可在 Node 中无头运行；固定 18 tick/s，带种子随机数，完全确定
  constants.ts   原版全部数值（附出处）
  mapgen.ts      地图生成与开局        ← DefineSprite_862/frame_1
  spawn.ts       刷兵                  ← frame_2
  unit.ts        单位状态机、战斗、占领 ← frame_3
  ai-classic.ts  原版电脑 AI           ← frame_4
  sim.ts         主循环与玩家指令      ← frame_5
  save.ts        存档序列化
src/render/      Canvas 2D 绘制：等距地图、矢量角色、小地图、特效
src/ui/          标题、对局 HUD、菜单、存读档与设置面板
src/i18n/        中文 / English
src/audio/       WebAudio 合成音效
tests/           Vitest 测试；e2e/ 为浏览器冒烟脚本
tools/           命令行工具
```

## 原版

原版 SWF 与反编译脚本在完成考证后已删除，仓库只保留考证结论（docs/01）。本作的美术、音效和代码均为重新制作。
