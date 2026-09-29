<h1 align="center">🐳 鲸鱼娘 · Whale-chan</h1>

<p align="center">
  <b>一只有自己想法的桌宠。</b><br>
  她有需求、自己做决定、会用角色的口吻回嘴，你还可以把她拎起来扔出去。
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://github.com/jiaming1145/deepSeek-pet/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jiaming1145/deepSeek-pet/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/jiaming1145/deepSeek-pet?color=2f5ba8"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4">
  <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white">
  <img alt="DeepSeek V4" src="https://img.shields.io/badge/brain-DeepSeek%20V4-4D6BFE">
  <a href="https://github.com/jiaming1145/deepSeek-pet/commits/main"><img alt="last commit" src="https://img.shields.io/github/last-commit/jiaming1145/deepSeek-pet?color=555"></a>
</p>

<p align="center">
  <img src="media/hero.gif" width="720" alt="鲸鱼娘看向光标、被拎起来扔出去、抱怨一句、走回来、跳舞">
</p>

她是一张鲸鱼娘女仆的画，被拆成图层、装上骨架，住在桌面上一个可以点穿的窗口里。她不是视频，也不是 3D
模型：头发、尾巴和裙摆是弹簧，脸是可以替换的手绘部件，每一个动作都是代码在以 60 fps 摆骨头。

她和其他桌宠最大的不同，在于**为什么**动。她不靠掷骰子挑下一个动画。她有四种需求（休息、陪伴、玩耍、安全），
随着你的互动或冷落而涨落；她把能做的每件事按需求打分，选最高的那个。心情也由同一组需求推导出来，所以表情和行为
永远不会自相矛盾。可选的 [DeepSeek](https://www.deepseek.com/) 大脑在此之上给她声音和性格；没有它，她也完全能用。

## 试试她

```bash
git clone https://github.com/jiaming1145/deepSeek-pet.git
cd deepSeek-pet
pnpm install
pnpm pet
```

需要 [Node 24+](https://nodejs.org/) 和 [pnpm 10](https://pnpm.io/installation)（`npm i -g pnpm@10`）。
她在 Windows 10/11 上开发和验证；底层是 Electron 和 three.js，macOS 和 Linux 理论上可以跑，但没测过（欢迎反馈）。

**在 Mac 上**，用 `pnpm pet:mac` 代替 `pnpm pet` 启动。还是同一个她，只是补上了 macOS 需要的东西：不占程序坞图标
（她住在菜单栏的托盘图标里），聊天框里可以用 Cmd+C / Cmd+V / Cmd+A / Cmd+Z，并且她会跟着你出现在每个桌面空间和全屏
应用之上。还没有在真正的 Mac 上验证过。

| 你 | 她 |
|---|---|
| 悬停 | 看向光标；你绕到背后，她会转过身 |
| 点击 | 反应取决于你摸的是哪里（头、尾巴、裙子……） |
| 双击 | 打开聊天框（托盘里的 聊天 也可以） |
| 拖动 | 把她拎起来。她会吓一跳，吊在半空，晃她会慌 |
| 松手 | 掉下去；用力甩出去会飞，落地还要评价一句 |
| 不理她 | 她会闲逛、坐下、伸懒腰、玩尾巴，你离开时打盹 |
| `Esc` | 关掉聊天框，但不会让她退出 |

她的窗口从不抢键盘焦点，所以点她、摸她、拖她都不会打断你正在打的字；只有聊天框打开时才借用键盘。托盘图标
（Windows 右下角）里有 聊天、挥手、小睡、自动行为、一个 出戏（TIMEOUT_SIGNAL）开关和 退出。

**给她一个大脑（可选）。** 在 [platform.deepseek.com](https://platform.deepseek.com/) 申请 key，设置环境变量
`DEEPSEEK_API_KEY`，或把 key 存到 `~/.ds/deepseek.key`。之后她大约每 45 秒想一次接下来做什么，会自言自语，
也会在聊天框里回答你。key 只由 Electron 主进程读取，从不进入渲染她的页面；不设 key 时她不发任何网络请求。
发送内容的确切范围见 [SECURITY.md](SECURITY.md)。

## 她会做什么

- 🧠 **她有需求。** 四种需求，每个活动一个分数，每次选择都附一句通俗理由，写进她的日志，行为可解释。
- 🤏 **可以把她拎起来。** 真实的抓握、摆动和抛掷物理：吓一跳，尾巴吊着，举高时尾巴卷起来，晃她会慌，落地有姿势。
- 💬 **跟她说话，她会演出来。** 让她跳舞、过来、坐下或睡觉；她用角色口吻回复并写出括号里的舞台指示，身体照着演。
- 🎭 **手绘脸上的 18 种心情。** 14 种眼睛、14 种嘴、6 种眉毛加特效（脸红、眼泪、汗滴、爱心），全部来自她自己的原画；说话时有眨眼、视线和口型。
- 💃 **她跳的是一套舞**，不是来回晃：108 BPM 六个动作，有停顿有重拍。
- 🧡 **她记得你。** 初次见面的时间、相处时长、摸了几次、扔了几次、关掉她时的心情。隔一天回来，她有话说。
- 🖥️ **住在桌面上，不是窗口里。** 除了她的像素周围 14 px 以内，其余地方全部点穿（逐像素命中测试），点在她旁边会落到后面的程序上。始终置顶，不抢键盘，沿任务栏边走，知道你是否真的在电脑前。
- 🔒 **从结构上就安全。** 不装键盘钩子、不读剪贴板、不截屏；她自己的念头有速率限制，每条回复都经过校验，一次坏回复也弄不坏她。

<p align="center">
  <img src="media/chat.gif" width="880" alt="在聊天框输入请求；她用角色口吻回答并原地跳舞">
</p>

<table align="center">
  <tr>
    <td align="center" width="30%"><img src="media/dance.gif" width="300" alt="她的舞蹈"><br><sub>整套舞，她自己跳的</sub></td>
    <td align="center"><img src="media/moods.png" alt="她的八种心情：开心、害羞、撅嘴、困惑、受伤、欢快、温柔、慌张"><br><sub>十八种心情里的八种</sub></td>
  </tr>
</table>

<p align="center">
  <img src="media/carry.png" alt="拎起来：吓一跳、举低时尾巴垂下、举高时尾巴卷起、晃她时慌张、松手、落地"><br>
  <sub>拎起来：吓一跳、垂尾、卷尾、晃她会慌、松手、落地</sub>
</p>

## 她是怎么做出来的

**从一张画到一副骨架。** 她的侧面和正面各过了一遍
[See-through](https://github.com/shitagaki-lab/see-through)：把一张角色画拆成图层，并补画被遮住的部分
（远侧的手臂、脑后的头发）。一个脚本从图层的形状推出骨架，没有一根骨头是手放的。运行时每个图层粘在一根骨头上，
柔软的部分（尾巴、头发、裙子）蒙皮在一条带弹簧的骨链上，动作是以时间为参数摆骨头的小函数。走路用侧面，面对你用
正面，两者之间用一个压扁的过渡，看起来是转身而不是切画面。运行时是纯 [three.js](https://threejs.org/) 跑在
[Electron](https://www.electronjs.org/) 窗口里：没有 Live2D，没有 Spine。

**她的心。** 她能做的每件事都按需求打分：

| 需求 | 什么时候涨 | 什么时候掉 |
|---|---|---|
| 休息 | 打盹（坐着只能缓一缓） | 一直慢慢掉；走路额外消耗 |
| 陪伴 | 你点她；悬停一次只算一次，停多久都一样 | 一直掉；你在旁边时掉得慢 |
| 玩耍 | 闲逛或玩尾巴 | 一直慢慢掉 |
| 安全 | 一分钟左右悄悄恢复 | 你把她摔了或扔了 |

她累了**而且**你离开了键盘，打盹的分数才高；你刚陪她玩过就去睡会被扣分。重复上一件事会被扣分，所以她不会卡住。
选定之后她会坚持一阵，而不是抽搐式地换来换去。她的行为是对着模拟的一小时（`media/mind_hour.png` 是其中一张）
调出来的，因为迄今找到的四个调参陷阱肉眼全都看不出来，画成图却一目了然。

**她的大脑。** 语言模型只在主进程里跑。她自己的念头最多每 45 秒一次（每小时 60 次），有超时，回复必须是她
真正拥有的活动名，否则丢弃。聊天每条消息一次调用，带上最近八轮对话作为上下文。在聊天框里，模型会单独用一行机器
专用的动作声明，并把舞台指示写在括号里；能驱动身体的只有你的要求、那一行动作和那些括号，所以她正文里**说**的内容
不会误触动作。托盘里的出戏开关
是一个真正的开关，而不是要模型自己注意到的魔法字符串。

**能测的地方都有测试。** 她的心、声音、记忆、表演解析和大脑都是没有 DOM 和网络的纯 Node 模块，
`pnpm pet:test` 几秒钟跑完（258 项检查）。另有三组 Electron 测试在屏幕外加载真实页面：真实使用下的表现（指令、
聊天框、窗口该接哪些点击）、按窗口像素测量的动画（脚踩在地上，动作切换不跳帧），以及一个时钟回归测试；在
`apps/desktop` 下运行 `npx electron ../../spikes/side_rig/pet_interaction.test.cjs`（以及 `anim.test.cjs`、
`mood_impulse.test.cjs`）。所有视觉上的说法都用真实渲染器的截图证明（`--capture`、`--tour`、
`--pet --selftest`），上面的 GIF 也是这样录的（`tools/media/`）。

## 路线图

- [x] 从原画拆出的双视角切片骨架，弹簧，20 个动作，逐像素命中测试
- [x] 基于需求、可解释的心，跨次运行的记忆
- [x] 拎起、抛掷、落地物理和被抱起的动画
- [x] DeepSeek 人设、聊天框、说出来的话会驱动身体
- [x] 舞蹈套路，更丰富的脸（眨眼、视线、口型、特效）
- [ ] 沿窗口边缘攀爬，坐在你的窗口上
- [ ] 英文人设和语音作为一等选项
- [ ] 打包安装程序（不需要 Node）
- [ ] 验证 macOS 和 Linux
- [ ] 用同一条流水线做第二个角色

## 参与

欢迎 PR。[CONTRIBUTING.md](CONTRIBUTING.md) 说明了代码在哪、怎么跑检查，以及两条各花掉过一天的规则。
适合入手的地方：macOS/Linux 测试、英文台词、新动作、打包。

发现 bug？[提 issue](https://github.com/jiaming1145/deepSeek-pet/issues/new/choose)，写清她做了什么。
想提问或晒她在你桌面上的样子？去 [Discussions](https://github.com/jiaming1145/deepSeek-pet/discussions)。
安全问题走 [私密报告](https://github.com/jiaming1145/deepSeek-pet/security/advisories/new)。

如果她让你笑了一下，点个 ⭐ 能让更多人找到她。

## 仓库里还有

`apps/desktop/` 和 `packages/` 是更早的原型：Live2D 形象、流式 DeepSeek 对话、带情绪标签的 ADV 对话框和本地
SQLite 历史。它仍能构建，也在 `pnpm test` 覆盖范围内，但开发重心是上面的桌宠。运行方式：`git submodule update --init`、
`pnpm fetch-sdk`（下载 Live2D Cubism SDK，约 21 MB），然后 `pnpm dev`。

## 致谢与许可

代码采用 [MIT](LICENSE) 许可。角色及其美术属于作者，不在代码许可范围内。图层拆分来自
[See-through](https://github.com/shitagaki-lab/see-through)（Apache-2.0）。Live2D 原型使用 Live2D Inc.
拥有版权的示例数据，按其条款使用；所有第三方组件见 [NOTICE](NOTICE)。

## Star 历史

<p align="center">
  <a href="https://star-history.com/#jiaming1145/deepSeek-pet&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=jiaming1145/deepSeek-pet&type=Date&theme=dark">
      <img alt="Star history" src="https://api.star-history.com/svg?repos=jiaming1145/deepSeek-pet&type=Date" width="600">
    </picture>
  </a>
</p>
