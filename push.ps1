# ============================================================
# push.ps1 — رفع التعديلات على الـ Frontend والـ Backend
# الاستخدام: .\push.ps1 "وصف التعديلات"
# ============================================================
param(
    [string]$Message = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

Write-Host "`n🚀 بدء رفع التعديلات..." -ForegroundColor Cyan
Write-Host "📝 رسالة الـ commit: $Message`n" -ForegroundColor Yellow

# 1. Stage all changes
Write-Host "1️⃣  Stage all changes..." -ForegroundColor White
git add -A
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { # 1 = warnings only
    Write-Host "❌ فشل git add" -ForegroundColor Red; exit 1
}

# 2. Commit
Write-Host "2️⃣  Commit..." -ForegroundColor White
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  لا يوجد تغييرات جديدة أو فشل الـ commit" -ForegroundColor Yellow
}

# Detect git
$gitCmd = "git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
        $gitCmd = "& 'C:\Program Files\Git\cmd\git.exe'"
        $env:Path += ";C:\Program Files\Git\cmd"
    }
}

# 3. Split frontend branch (تحديث)
Write-Host "`n3️⃣  تحديث frontend-only branch..." -ForegroundColor White
git branch -D frontend-only 2>$null
git subtree split --prefix=front -b frontend-only 2>&1 | Select-Object -Last 3
Write-Host "✅ Frontend branch محدثة" -ForegroundColor Green

# 4. Split backend branch (تحديث)
Write-Host "`n4️⃣  تحديث backend-only branch..." -ForegroundColor White
git branch -D backend-only 2>$null
git subtree split --prefix=back -b backend-only 2>&1 | Select-Object -Last 3
Write-Host "✅ Backend branch محدثة" -ForegroundColor Green

# 5. Push Frontend
Write-Host "`n5️⃣  رفع Frontend على course-front..." -ForegroundColor White
git push course-front frontend-only:main --force 2>&1 | Select-Object -Last 3
Write-Host "✅ Frontend اترفع على: https://github.com/minasamir1401/course-front" -ForegroundColor Green

# 6. Push Backend
Write-Host "`n6️⃣  رفع Backend على course-back..." -ForegroundColor White
git push course-back backend-only:main --force 2>&1 | Select-Object -Last 3
Write-Host "✅ Backend اترفع على: https://github.com/minasamir1401/course-back" -ForegroundColor Green

Write-Host "`n🎉 تم رفع كل التعديلات بنجاح!`n" -ForegroundColor Cyan
