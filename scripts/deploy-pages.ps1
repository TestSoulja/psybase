# Выкладка на GitHub Pages: только dist/, ветка gh-pages, без force-push.
# Не запускать без слова владельца. Требования: чистое дерево, check exit 0,
# сборка exit 0.

$ErrorActionPreference = 'Stop'
$repo = git rev-parse --show-toplevel
Set-Location $repo

function Fail($msg) {
  Write-Host "✖ $msg"
  exit 1
}

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
if ($LASTEXITCODE -eq 0) {
  Write-Host "✔ gh-pages уже совпадает с dist/ — коммит не нужен"
  Pop-Location
  git worktree remove $tmp --force
  exit 0
}

git commit -m ("site: " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
if ($LASTEXITCODE -ne 0) { Pop-Location; git worktree remove $tmp --force; Fail "коммит в gh-pages не создан" }

# Обычный push: если кто-то успел вперёд — упадёт, повторять с --force нельзя.
git push origin HEAD:gh-pages
$pushCode = $LASTEXITCODE
Pop-Location
git worktree remove $tmp --force

if ($pushCode -ne 0) { Fail "push отклонён (возможно, gh-pages ушёл вперёд); force-push запрещён — разбери вручную" }
Write-Host "✔ выложено: https://testsoulja.github.io/psybase/"
Write-Host "  на сайте нет for-app/ и черновиков (draft: true)"
