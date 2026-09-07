param(
    [string]$Message = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

$ErrorActionPreference = "Continue"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
        $env:Path += ";C:\Program Files\Git\cmd"
    }
}

Write-Host "`n[PUSH] Starting push to 3 GitHub repositories..." -ForegroundColor Cyan
Write-Host "[PUSH] Commit message: $Message`n" -ForegroundColor Yellow

# 1. Stage all changes
Write-Host "1. Stage all changes..." -ForegroundColor White
git add -A

# 2. Commit
Write-Host "2. Commit changes..." -ForegroundColor White
git commit -m "$Message"

# 3. Split frontend branch
Write-Host "`n3. Updating frontend-only branch..." -ForegroundColor White
git branch -D frontend-only 2>$null
git subtree split --prefix=front -b frontend-only

# 4. Split backend branch
Write-Host "`n4. Updating backend-only branch..." -ForegroundColor White
git branch -D backend-only 2>$null
git subtree split --prefix=back -b backend-only

# 5. Push Frontend
Write-Host "`n5. Pushing frontend to course-front (https://github.com/minasamir1401/course-front)..." -ForegroundColor White
git push course-front frontend-only:main --force

# 6. Push Backend
Write-Host "`n6. Pushing backend to course-back (https://github.com/minasamir1401/course-back)..." -ForegroundColor White
git push course-back backend-only:main --force

# 7. Push Full Monorepo
Write-Host "`n7. Pushing full monorepo to origin (https://github.com/EduTrackPlatform/Edu-Track-Platform)..." -ForegroundColor White
git push origin main

Write-Host "`n[SUCCESS] Successfully pushed all changes to all 3 repositories!`n" -ForegroundColor Green
