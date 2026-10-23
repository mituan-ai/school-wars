# School Wars（校园黑帮）原程序与反编译研究包

## 来源与可追溯性

- 制作方：GameDesign（日本，伊藤太郎 / Taro Ito）
- 官方页面：https://www.gamedesign.jp/flash/sw/sw_jp.html
- 官方页面中 `embed` / `movie` 直接引用的文件：https://www.gamedesign.jp/flash/sw/sw.swf
- 此包中的原始程序：`School_Wars_original_gamedesign.swf`
- 原始文件大小：232027 字节
- SHA-256：`5994d74c67d46a96ab1f6f74926fada050b06df07d2dffd3b9fc5ff605e70e8a`
- 文件格式：压缩 Macromedia Flash SWF，版本 9；ActionScript 1/2 字节码（SWF 中使用 `DoAction` 标签）

## 包内文件

- `School_Wars_original_gamedesign.swf`：从原作者现存服务器直接取得的 SWF 程序；反编译时以此文件为准。
- `School_Wars_decompiled_AS/`：JPEXS Free Flash Decompiler 26.4.0 从 SWF 还原的 37 段 ActionScript `.as` 文件。注意：**不是原作者编辑时的原始源码**；命名、局部变量及代码结构可能不完整或有偏差。
- `School_Wars_reconstructed/School_Wars_original_gamedesign.fla`：JPEXS 根据 SWF **重建** 的 FLA。不是原作者提供的工程，兼容性与可重新编译性尚未验证。
- `School_Wars_assets/`：从 SWF 提取的图片、矢量图形、声音和文字资源。

## 核心逻辑位置

重点查看 `School_Wars_decompiled_AS/scripts/DefineSprite_862/` 目录：

1. `frame_1/DoAction.as`：地图生成、棋盘布局、四个阵营、阵营初始属性。
2. `frame_2/DoAction.as`：人员出生/分配、占地对刷新速度的影响、单位状态枚举、人数上限。
3. `frame_3/DoAction.as`：角色行动状态机、行走、站立、占地、战斗、升级、死亡、阵营淘汰。
4. `frame_4/DoAction.as`：电脑控制的阵营决策 `com_orders()`。
5. `frame_5/DoAction.as`：鼠标选中、拖拽、单位交互指令。

其他 `DefineSprite_*/.../DoAction.as` 中含地图、单位动画、界面等逻辑。

## 已从字节码中直接识别的参数

```actionscript
bsize = 16;                              // 16 x 16 大地图
spec_appear = [1500, 500, 1500, 1500]; // 四阵营刷兵累计门槛
spec_hp = [20, 10, 25, 15];             // 四阵营基础生命值
spec_punch = [4, 2, 3, 5];              // 四阵营基础攻击力
pmax = 48;                              // 全部单位槽位总数
```

脚本还限定 `player[col].people_cnt >= pmax / 4` 时不再向该阵营补兵，因此默认每个阵营最多 12 个在场单位。

## 重现反编译

使用官方 JPEXS Free Flash Decompiler（FFDec）：

https://github.com/jindrapetrik/jpexs-decompiler

使用 26.4.0 版时，命令行示例：

```bash
java -jar ffdec.jar -dumpAS2 School_Wars_original_gamedesign.swf
java -jar ffdec.jar -export script decompiled School_Wars_original_gamedesign.swf
java -jar ffdec.jar -export image,shape,sound,text assets School_Wars_original_gamedesign.swf
java -jar ffdec.jar -export fla reconstructed School_Wars_original_gamedesign.swf
```

## 另一个更早的版本

曾有独立 Windows 版《SCHOOL WARS》，2004 年已经在 Vector 网站收录；2007 年的报道确认它与 Flash 版来自同一作者。该 Windows 版的早期链接如今已失效，本包**不含其 EXE 或源代码**。

## 权利说明

游戏并非开源作品。2005 年 GameDesign 曾发布过出售《SCHOOL WARS》著作利用权的声明：
https://www.atpress.ne.jp/news/2566

本包用于研究与私下分析，不代表取得复制、二次分发或商业移植授权。发布衍生作品前应核查当前权利状态并申请所需许可。
