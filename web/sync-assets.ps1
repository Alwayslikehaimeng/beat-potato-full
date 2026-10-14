<#
  把根目录 assets/ 里 Web 端需要的素材同步到 web/assets/。

  为什么要拷贝而不是直接引用：
  - 根 assets/ 是项目唯一真源（Plan.md 约定），PC / Android 都从那里取
  - GitHub Pages 只会发布 web/ 这一个目录，站外文件访问不到
  - 三个中文文件名（水枪/中指/土豆本豆）改成 ASCII，避免 URL 编码在 iOS 上出岔子

  素材本身没有改动，只是复制 + 改名。改完素材后重跑这个脚本即可。
#>

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot          # A:\ai\Beat Potato
$srcRoot = Join-Path $root 'assets'
$dstRoot = Join-Path $PSScriptRoot 'assets'

if (-not (Test-Path $srcRoot)) { throw "找不到素材源目录：$srcRoot" }

# 清掉旧副本，避免改了名之后留一堆孤儿文件
if (Test-Path $dstRoot) { Remove-Item $dstRoot -Recurse -Force }

# 源相对路径 -> 目标相对路径；未列出的文件一律不拷贝
$map = [ordered]@{
  # 六状态主图：state_0 就是 idle
  'potato/idle.png'          = 'potato/idle.png'
  'potato/hit_1.png'         = 'potato/hit_1.png'
  'potato/hit_2.png'         = 'potato/hit_2.png'
  'potato/hit_3.png'         = 'potato/hit_3.png'
  'potato/state/state_1.png' = 'potato/state/state_1.png'
  'potato/state/state_2.png' = 'potato/state/state_2.png'
  'potato/state/state_3.png' = 'potato/state/state_3.png'
  'potato/state/state_4.png' = 'potato/state/state_4.png'
  'potato/state/state_5.png' = 'potato/state/state_5.png'
  # 每个状态自己的受击帧（state_0_hit 就是第一版的 hit_1）
  'potato/state/state_0_hit.png' = 'potato/state/state_0_hit.png'
  'potato/state/state_1_hit.png' = 'potato/state/state_1_hit.png'
  'potato/state/state_2_hit.png' = 'potato/state/state_2_hit.png'
  'potato/state/state_3_hit.png' = 'potato/state/state_3_hit.png'
  'potato/state/state_4_hit.png' = 'potato/state/state_4_hit.png'
  'potato/state/state_5_hit.png' = 'potato/state/state_5_hit.png'
  # 被滋湿
  'potato/state/wet.png'     = 'potato/state/wet.png'
  # 两个道具素材 + 图标（中文名改 ASCII）
  'potato/水枪.png'           = 'potato/prop_squirt.png'
  'potato/中指.png'           = 'potato/prop_finger.png'
  'potato/ui/btn_squirt.png' = 'potato/ui/btn_squirt.png'
  'potato/ui/btn_finger.png' = 'potato/ui/btn_finger.png'
  # 展开图（中文名改 ASCII）
  'potato/土豆本豆.jpg'        = 'potato/flash_potato.jpg'
}

# 计数徽章 26 张（total_0~9 / today_0~9 / burst_1~4 / label_jin / label_bao）
foreach ($n in 0..9) {
  $map["potato/counter/total_$n.png"] = "potato/counter/total_$n.png"
  $map["potato/counter/today_$n.png"] = "potato/counter/today_$n.png"
}
foreach ($n in 1..4) { $map["potato/counter/burst_$n.png"] = "potato/counter/burst_$n.png" }
$map['potato/counter/label_jin.png'] = 'potato/counter/label_jin.png'
$map['potato/counter/label_bao.png'] = 'potato/counter/label_bao.png'

# 音效 15 个（4 段水声 + 暴打 + 鄙视 + 3 句专属台词 + 5 句随机台词）
$map['audio/hit.wav']         = 'audio/hit.wav'
$map['audio/despise.wav']     = 'audio/despise.wav'
foreach ($n in 1..4) { $map["audio/squirt_$n.wav"] = "audio/squirt_$n.wav" }
$map['audio/line_wet.wav']    = 'audio/line_wet.wav'
$map['audio/line_stage2.wav'] = 'audio/line_stage2.wav'
$map['audio/line_final.wav']  = 'audio/line_final.wav'
foreach ($n in 1..5) { $map["audio/line_rand$n.wav"] = "audio/line_rand$n.wav" }

$copied = 0
$bytes = 0
foreach ($from in $map.Keys) {
  $src = Join-Path $srcRoot ($from -replace '/', '\')
  if (-not (Test-Path $src)) { throw "素材缺失：assets/$from" }
  $dst = Join-Path $dstRoot ($map[$from] -replace '/', '\')
  $dir = Split-Path -Parent $dst
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Copy-Item $src $dst -Force
  $copied++
  $bytes += (Get-Item $dst).Length
}

# GitHub Pages 默认会跑 Jekyll；关掉它，静态文件原样发布
New-Item -ItemType File -Force -Path (Join-Path $dstRoot '.nojekyll') | Out-Null

'{0} 个文件已同步到 web\assets\（共 {1:N1} MB）' -f $copied, ($bytes / 1MB)
