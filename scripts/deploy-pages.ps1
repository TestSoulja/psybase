# Выкладка на GitHub Pages: только dist/, ветка gh-pages, без force-push.
# Не запускать без слова владельца. По умолчанию: чистое дерево, check exit 0,
# сборка exit 0, затем три отдельные проверки — что записано, что отдаётся,
# и только после совпадения слово «выложено».
# -LiveOnly: проверить сайт по текущему dist/, ничего не публикуя.

param(
  [switch]$LiveOnly
)

$ErrorActionPreference = 'Stop'
$repo = git rev-parse --show-toplevel
Set-Location $repo
$site = 'https://testsoulja.github.io/psybase/'

function Fail($msg, $code = 1) {
  Write-Host "✖ $msg"
  exit $code
}

function DistFiles {
  $dir = Join-Path $repo 'dist'
  if (-not (Test-Path $dir)) { Fail "dist/ нет — сначала сборка: node tools/build.mjs" }
  return @(Get-ChildItem $dir -Recurse -File -Force)
}

function DistBytes($files) {
  return [int64](($files | Measure-Object Length -Sum).Sum)
}

function LiveUrl($rel) {
  $parts = $rel -split '/'
  $encoded = ($parts | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
  if ($encoded -eq 'index.html') { return $site }
  if ($encoded -like '*/index.html') { return $site + ($encoded -replace '/index\.html$', '/') }
  return $site + $encoded
}

function Check-LiveFile($file) {
  $rel = $file.FullName.Substring((Join-Path $repo 'dist').Length + 1).Replace('\', '/')
  $localSize = [int64]$file.Length
  $localHash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $tmpFile = Join-Path $env:TEMP ("psybase-live-" + [guid]::NewGuid().ToString('N'))
    try {
      $url = (LiveUrl $rel) + '?cb=' + [guid]::NewGuid().ToString('N')
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmpFile -TimeoutSec 60
      $remoteSize = [int64](Get-Item $tmpFile).Length
      $remoteHash = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash
      if ($remoteSize -eq $localSize -and $remoteHash -eq $localHash) {
        return [pscustomobject]@{ Ok = $true; Rel = $rel; Reason = '' }
      }
      $script:lastReason = "размер $remoteSize вместо $localSize" + $(if ($remoteHash -ne $localHash) { ', SHA-256 не совпал' } else { '' })
    } catch {
      $script:lastReason = $_.Exception.Message
    } finally {
      if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue }
    }
    if ($attempt -lt 10) { Start-Sleep -Seconds 30 }
  }
  return [pscustomobject]@{ Ok = $false; Rel = $rel; Reason = $script:lastReason }
}

# Живому сайту нужен TLS 1.2 и не нужен кэш от предыдущей проверки.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

if ($LiveOnly) {
  Write-Host "режим -LiveOnly: ничего не публикую, проверяю $site"
} else {
  # 1. Дерево чистое
  $dirty = git status --porcelain
  if ($dirty) { Fail "дерево не чистое: сначала закоммить или убери изменения" }

  # 2. Проверки
  npm run check
  if ($LASTEXITCODE -ne 0) { Fail "npm run check вернул $LASTEXITCODE" }

  # 3. Сборка
  node tools/build.mjs
  if ($LASTEXITCODE -ne 0) { Fail "сборка вернула $LASTEXITCODE" }
  if (-not (Test-Path (Join-Path $repo 'dist\index.html'))) { Fail "dist/index.html не создан" }

  $distFilesBefore = DistFiles
  $distBytesBefore = DistBytes $distFilesBefore
  Write-Host ("dist: файлов {0}, байт {1}" -f $distFilesBefore.Count, $distBytesBefore)

  # 4. Ветка gh-pages: только дописываем, force-push запрещён
  $tmp = Join-Path $env:TEMP ("psybase-gh-pages-" + $PID)
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  # ls-remote молчит, если ветки нет; fetch в этом случае пишет в stderr и валит Stop
  $remoteRef = git ls-remote --heads origin gh-pages
  $hasRemote = ($LASTEXITCODE -eq 0 -and "$remoteRef".Trim())
  if ($hasRemote) {
    git fetch origin gh-pages
    if ($LASTEXITCODE -ne 0) { Fail "не удалось получить origin/gh-pages" }
    git worktree add --detach $tmp origin/gh-pages
    if ($LASTEXITCODE -ne 0) { Fail "не удалось получить origin/gh-pages в worktree" }
  } else {
    Write-Host "ветки gh-pages на origin нет — создаём первую"
    git worktree add --detach $tmp HEAD
    if ($LASTEXITCODE -ne 0) { Fail "не удалось создать worktree" }
    Push-Location $tmp
    git checkout --orphan gh-pages
    git rm -rf . --quiet
    Pop-Location
  }

  # 5. Содержимое gh-pages = ровно dist/
  Push-Location $tmp
  Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
  Copy-Item (Join-Path $repo 'dist\*') -Destination $tmp -Recurse -Force
  New-Item -ItemType File -Path (Join-Path $tmp '.nojekyll') -Force | Out-Null

  git add -A
  # Сравнивать надо индекс, а не рабочее дерево: при включённом autocrlf status
  # видит CRLF↔LF как изменения, а git add нормализует их обратно в тот же blob.
  git diff --cached --quiet
  $changed = ($LASTEXITCODE -ne 0)
  if ($changed) {
    git commit -m ("site: " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    if ($LASTEXITCODE -ne 0) { Pop-Location; git worktree remove $tmp --force; Fail "коммит в gh-pages не создан" }
    # Обычный push: если кто-то успел вперёд — упадёт, повторять с --force нельзя.
    git push origin HEAD:gh-pages
    $pushCode = $LASTEXITCODE
  } else {
    $pushCode = 0
    Write-Host "✔ gh-pages уже совпадает с dist/ — коммит не нужен"
  }

  $pushedSha = ''
  $treeFiles = 0
  $treeBytes = [int64]0
  if ($pushCode -eq 0) {
    $pushedSha = (git rev-parse HEAD).Trim()
    $treeFiles = @(git ls-tree -r --name-only HEAD).Count
    foreach ($line in (git ls-tree -r -l HEAD)) {
      if ($line -match '^\S+\s+\S+\s+\S+\s+(\d+)\s') { $treeBytes += [int64]$Matches[1] }
    }
  }
  Pop-Location
  git worktree remove $tmp --force

  if ($pushCode -ne 0) { Fail "push отклонён (возможно, gh-pages ушёл вперёд); force-push запрещён — разбери вручную" }

  # (а) записано: ls-remote после push, число файлов и сумма блобов
  $remoteGh = (git ls-remote --heads origin gh-pages)
  $remoteSha = ("$remoteGh".Trim() -split '\s+')[0]
  if ($remoteSha -ne $pushedSha) {
    Fail "gh-pages на origin $remoteSha, а запушен $pushedSha"
  }
  if ($treeFiles -ne ($distFilesBefore.Count + 1)) {
    Fail "в gh-pages tree $treeFiles файлов, а в dist/ $($distFilesBefore.Count) + .nojekyll"
  }
  if ($treeBytes -ne $distBytesBefore) {
    Fail "сумма блобов gh-pages $treeBytes байт, а dist/ $distBytesBefore байт"
  }
  Write-Host ("записано: gh-pages {0}, файлов {1} (dist {2} + .nojekyll), блобов {3} байт = dist" -f $pushedSha, $treeFiles, $distFilesBefore.Count, $treeBytes)
}

# (б) отдаётся: каждый файл dist/ — размер и SHA-256, до 10 попыток по 30 с
$distFiles = DistFiles
$total = $distFiles.Count
$matched = 0
$failures = @()
for ($i = 0; $i -lt $total; $i++) {
  $result = Check-LiveFile $distFiles[$i]
  if ($result.Ok) {
    $matched++
  } else {
    $failures += ("{0} — {1}" -f $result.Rel, $result.Reason)
  }
  if (($i + 1) % 10 -eq 0 -or ($i + 1) -eq $total) {
    Write-Host ("проверено {0}/{1}" -f ($i + 1), $total)
  }
}

Write-Host ("совпало {0} из {1}" -f $matched, $total)

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Host "  - $_" }
  Write-Host "✖ сборка не подтверждена: живой сайт расходится с dist/"
  exit 2
}

if ($LiveOnly) {
  Write-Host "✔ сайт проверен, ничего не публиковалось"
} else {
  Write-Host "✔ выложено: $site"
  Write-Host "  на сайте нет for-app/ и черновиков (draft: true)"
}
