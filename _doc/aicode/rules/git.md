# 本地 git：优先用顶箭自带的

`AGENTS.md` 要求改完就本地提交，并且优先用顶箭自带的 git。每个任务第一次用 git 之前读这份；提交时报缺少用户名、邮箱时也读这份。

## 用哪个 git

1. **顶箭自带的 git。** 顶箭自带一份 git，平台自己在应用仓库里也只用这一份（例如给装好的应用打基线 tag）。AI 用同一份，两边跑的就是同一个 git。
2. **系统里的 `git`**：只有本机没装顶箭时才用（例如项目是从 GitHub 拿来的，用户没装顶箭）。
3. **两个都没有**：告诉用户。不要去网上下载安装 git。

Mac 上每台机器都有 `/usr/bin/git`，但没装 Xcode 命令行工具时，运行它只会弹出安装提示。`git --version` 失败或弹出这个提示，就当作没有 git，不要替用户装命令行工具。

## Windows

顶箭自带的 git（MinGit）位置是：

`<顶箭程序根>\runtime\git\cmd\git.exe`

默认安装时就是 `C:\Program Files\TopArrow\runtime\git\cmd\git.exe`。用户可以装到别的盘（例如 `D:\TopArrow`），以本机实际安装位置为准，不要写死 `C:\Program Files`。

按这个顺序找程序根目录（根下才有 `runtime\`、`tactl.exe`、`TopArrow.exe`）：

1. 环境变量 `TOPARROW_RUNTIME_DIR`（它的上一级就是程序根）。
2. 卸载注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\TopArrow` 的 `InstallLocation`；没有再看 `HKCU` 下同名键。值可能带引号，去掉即可。
3. 若顶箭正在运行：进程 `TopArrow.exe` 所在目录。
4. 以上都没有，再试默认路径 `C:\Program Files\TopArrow`。

```powershell
$root = $null
if ($env:TOPARROW_RUNTIME_DIR) { $root = Split-Path $env:TOPARROW_RUNTIME_DIR -Parent }
if (-not $root) {
  foreach ($k in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\TopArrow',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\TopArrow'
  )) {
    $loc = (Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation
    if ($loc) { $root = $loc.Trim('"'); break }
  }
}
if (-not $root) {
  $p = Get-Process TopArrow -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { $root = Split-Path $p.Path -Parent }
}
if (-not $root) { $root = 'C:\Program Files\TopArrow' }
$git = Join-Path $root 'runtime\git\cmd\git.exe'
if (Test-Path $git) { $env:Path = (Split-Path $git) + ';' + $env:Path }
git --version
```

顶箭的 git 存在时，这段只在当前终端会话里把它放到 PATH 最前面，之后直接用 `git` 就是顶箭的；不存在时，`git` 仍是系统里的。不要改系统或用户级的 PATH 环境变量。
如果你用的工具每条命令都开一个新 shell，就每次重跑这段，或者直接用完整路径调用：`& $git status`。

也可以用 `& (Join-Path $root 'tactl.exe') runtime` 自检，输出里有一行 `git  ok`。

## macOS

顶箭自带的 git 在 `<顶箭程序根>/runtime/git/bin/git`。程序根是 `TopArrow.app/Contents/Resources`，一般是 `/Applications/TopArrow.app/Contents/Resources`；用户也可能把应用挪到别处（例如 `~/Applications`）。

按这个顺序找程序根：

1. 环境变量 `TOPARROW_RUNTIME_DIR`（它的上一级就是程序根）。
2. 若顶箭正在运行：进程 `TopArrow.app/Contents/MacOS/TopArrow`（或 `TopArrowAgent`）的路径。
3. 以上都没有，再试 `/Applications/TopArrow.app` 和 `~/Applications/TopArrow.app`。

```sh
root=""
if [ -n "$TOPARROW_RUNTIME_DIR" ]; then root="$(dirname "$TOPARROW_RUNTIME_DIR")"; fi
if [ -z "$root" ]; then
  exe="$(ps -axo comm= | grep -m1 -E '/TopArrow\.app/Contents/MacOS/TopArrow(Agent)?$')"
  if [ -n "$exe" ]; then root="${exe%/MacOS/*}/Resources"; fi
fi
for app in /Applications/TopArrow.app "$HOME/Applications/TopArrow.app"; do
  if [ -z "$root" ] && [ -d "$app/Contents/Resources/runtime" ]; then root="$app/Contents/Resources"; fi
done
git_bin="$root/runtime/git/bin/git"
if [ -x "$git_bin" ]; then export PATH="$(dirname "$git_bin"):$PATH"; fi
git --version
```

和 Windows 一样，这段只改当前 shell 的 PATH。如果你用的工具每条命令都开一个新 shell，就每次重跑这段，或者直接调用 `"$git_bin"`。
自检：`"$root/../MacOS/tactl" runtime`，输出里有一行 `git`。

## 怎么用

- 跑完上面的片段后，本次任务里的 git 命令都直接用 `git`：`git status`、`git diff`、`git log -5`、`git add ...`、`git commit -m "..."`、`git init`。
- 提交一律用 `-m` 写信息，不要用会打开编辑器的命令（例如不带 `-m` 的 `commit`、`rebase -i`）。Windows 上顶箭的 git 根本没带编辑器和分页器。

## 提交身份（用户名和邮箱）

先在项目根目录看本仓库能不能取到身份：

```sh
git config user.name
git config user.email
```

两项都有值就照用，不要改。缺任意一项时，按下面的规则把两项一起补上：

- **用户名**：默认用顶箭用户名。它在顶箭用户数据目录（Windows 是 `%LOCALAPPDATA%\TopArrow\`，Mac 是 `~/Library/Application Support/TopArrow/`）下 `platform.sqlite` 的 `settings` 表里：`key = 'account.profile'` 那一行的 `value` 是 JSON，取其中的 `nickname`。
- **没有登录顶箭**（退出登录后这一行的 `value` 是空字符串；也可能没有这一行，或 `nickname` 为空），或者本机没装顶箭：用户名用 `TAU` 加 10 位随机数字，例如 `TAU2045491692`。
- **邮箱**：`用户名@users.noreply.toparrow.local`，例如 `zhangsan@users.noreply.toparrow.local`。
  用户名带中文、空格或其他不能进邮箱的字符时（只允许英文字母、数字和 `_` `-`，以及夹在中间的 `.`），`@` 前面改用 `TAU` 加顶箭用户 id（同一段 JSON 里的 `id`）。例如昵称「张三」、id 为 `1234` 时，用户名仍是 `张三`，邮箱是 `TAU1234@users.noreply.toparrow.local`。

只写进本仓库（`--local`），不要动 `--global`、`--system`。写一次就行，以后的提交沿用；随机生成的 `TAU` 名字也靠这一步留住，不要每次提交都重新生成。

`platform.sqlite` 只读打开，不要写。下面用顶箭的 Node 读它（`$root` 为上面找到的程序根，在项目根目录执行）。本机没装顶箭时不用跑脚本，直接按上面的规则用 `git config --local` 写入 `TAU` 名字和对应邮箱。

Windows（PowerShell）：

```powershell
if (-not (git config user.name) -or -not (git config user.email)) {
  $node = Join-Path $root 'runtime\node\node.exe'
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $js = @'
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');
const dataRoot = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'TopArrow')
  : path.join(process.env.LOCALAPPDATA || '', 'TopArrow');
let name = '';
let id = '';
try {
  const db = new DatabaseSync(path.join(dataRoot, 'platform.sqlite'), { readOnly: true });
  const row = db.prepare("select value from settings where key = 'account.profile'").get();
  if (row && row.value) {
    const profile = JSON.parse(row.value);
    name = String(profile.nickname || '').trim();
    id = String(profile.id ?? '').trim();
  }
} catch (e) {}
const random = 'TAU' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
if (!name) name = random;
const local = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(name) ? name : (id ? 'TAU' + id : random);
console.log(name);
console.log(local + '@users.noreply.toparrow.local');
'@
  $out = @($js | & $node -)
  git config --local user.name $out[0].Trim()
  git config --local user.email $out[1].Trim()
}
```

macOS（zsh 或 bash）：

```sh
if [ -z "$(git config user.name)" ] || [ -z "$(git config user.email)" ]; then
  out="$("$root/runtime/node/bin/node" - <<'EOF'
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');
const dataRoot = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'TopArrow')
  : path.join(process.env.LOCALAPPDATA || '', 'TopArrow');
let name = '';
let id = '';
try {
  const db = new DatabaseSync(path.join(dataRoot, 'platform.sqlite'), { readOnly: true });
  const row = db.prepare("select value from settings where key = 'account.profile'").get();
  if (row && row.value) {
    const profile = JSON.parse(row.value);
    name = String(profile.nickname || '').trim();
    id = String(profile.id ?? '').trim();
  }
} catch (e) {}
const random = 'TAU' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
if (!name) name = random;
const local = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(name) ? name : (id ? 'TAU' + id : random);
console.log(name);
console.log(local + '@users.noreply.toparrow.local');
EOF
)"
  git config --local user.name "$(printf '%s\n' "$out" | sed -n 1p)"
  git config --local user.email "$(printf '%s\n' "$out" | sed -n 2p)"
fi
```
