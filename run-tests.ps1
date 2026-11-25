<#
.SYNOPSIS
    OpenCut 全语言统一测试入口（ISTQB 测试级别 + ISO/IEC 29119 测试过程）。
.DESCRIPTION
    按层级依次执行：Web 单元/组件层（Vitest + V8 覆盖率）、API 组件层（Bun test）、
    Rust 单元/集成层（cargo test --workspace）、Node 跨语言契约层（4 个零依赖脚本）。
    每个套件输出分层日志（INFO / PASS / FAIL / ERROR），FAIL 标红；日志写入带日期时间戳的文件。
    任一套件失败以退出码 1 结束，供 CI 直接消费。
.PARAMETER SkipCoverage
    传 $true 时跳过 V8 覆盖率采集（默认采集）。
.PARAMETER Only
    仅运行指定套件名（web / api / rust / node-contracts），缺省运行全部。
.EXAMPLE
    .\run-tests.ps1
    .\run-tests.ps1 -SkipCoverage $true
    .\run-tests.ps1 -Only rust
#>
[CmdletBinding()]
param(
    [bool]$SkipCoverage = $false,
    [string]$Only = ''
)

$ErrorActionPreference = 'Continue'
$ROOT = $PSScriptRoot
$LOG_DIR = Join-Path $env:TEMP 'opencut-full-test-logs'
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }
$TIMESTAMP = Get-Date -Format 'yyyyMMdd-HHmmss'
$LOG_FILE = Join-Path $LOG_DIR "opencut-full-test-$TIMESTAMP.log"
$LOG_LINES = [System.Collections.Generic.List[string]]::new()
$PASS_SUITES = 0
$FAIL_SUITES = 0

# ANSI 颜色常量（第三方标准：ISO/IEC 29119-2 测试事件报告要求失败可辨识）。
$RED = "`e[31m"
$GREEN = "`e[32m"
$RESET = "`e[0m"

<#
.SYNOPSIS
    写分层日志：同时输出到控制台与带时间戳的日志文件。
.PARAMETER Level
    日志级别（INFO / PASS / FAIL / ERROR）。
.PARAMETER Message
    日志内容。
#>
function Write-TestLog {
    param([string]$Level, [string]$Message)
    $time = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fff')
    $line = "[$time] $($Level.PadRight(5)) $Message"
    $LOG_LINES.Add($line) | Out-Null
    if ($Level -eq 'FAIL' -or $Level -eq 'ERROR') {
        Write-Host "$RED$line$RESET"
    } elseif ($Level -eq 'PASS') {
        Write-Host "$GREEN$line$RESET"
    } else {
        Write-Host $line
    }
}

<#
.SYNOPSIS
    执行单个测试套件并捕获输出，按退出码判定 PASS/FAIL。
.PARAMETER Name
    套件名（用于日志标识）。
.PARAMETER Command
    可执行程序路径。
.PARAMETER Arguments
    参数数组。
.PARAMETER WorkingDir
    工作目录。
#>
function Invoke-TestSuite {
    param([string]$Name, [string]$Command, [string[]]$Arguments, [string]$WorkingDir)
    Write-TestLog 'INFO' "=== 开始套件：$Name ==="
    Write-TestLog 'INFO' "命令：$Command $($Arguments -join ' ')"
    Write-TestLog 'INFO' "目录：$WorkingDir"
    $outFile = "$LOG_DIR/${Name}-$TIMESTAMP.out.log"
    Push-Location $WorkingDir
    try {
        $output = & $Command @Arguments 2>&1 | Out-String
        [System.IO.File]::WriteAllText($outFile, $output, [System.Text.Encoding]::UTF8)
        $code = $LASTEXITCODE
        $summary = ($output -split "`r?`n" | Where-Object { $_ -match '(Test Files|Tests\s+\d+|test result:|汇总|pass |fail |tests \d+)' } | Select-Object -Last 8) -join ' | '
        if ($code -eq 0) {
            Write-TestLog 'PASS' "$Name 退出码 0；摘要：$summary"
            $script:PASS_SUITES += 1
        } else {
            Write-TestLog 'FAIL' "$Name 退出码 $code；摘要：$summary"
            Write-TestLog 'ERROR' "$Name 详细输出：$outFile"
            $script:FAIL_SUITES += 1
        }
    } catch {
        Write-TestLog 'ERROR' "$Name 异常：$($_.Exception.Message)"
        $script:FAIL_SUITES += 1
    } finally {
        Pop-Location
    }
    Write-TestLog 'INFO' "=== 结束套件：$Name ==="
}

Write-TestLog 'INFO' 'OpenCut 全量测试开始（ISTQB 级别 / ISO 29119 过程）'
Write-TestLog 'INFO' "工具版本：node=$(node --version) bun=$(bun --version) cargo=$(cargo --version)"

if ($Only -eq '' -or $Only -eq 'web') {
    # 用项目本地 vitest CLI（node 直调）而非 bun x：bun x 会重新解析依赖并丢失 coverage-v8。
    $vitestEntry = Join-Path $ROOT 'apps/web/node_modules/vitest/vitest.mjs'
    $webArgs = @($vitestEntry, 'run')
    if (-not $SkipCoverage) { $webArgs += '--coverage' }
    Invoke-TestSuite -Name 'web-vitest' -Command 'node' -Arguments $webArgs -WorkingDir (Join-Path $ROOT 'apps/web')
}

if ($Only -eq '' -or $Only -eq 'api') {
    Invoke-TestSuite -Name 'api-elysia' -Command 'bun' -Arguments @('test', 'src/index.test.mjs') -WorkingDir (Join-Path $ROOT 'apps/api')
}

if ($Only -eq '' -or $Only -eq 'rust') {
    Invoke-TestSuite -Name 'rust-workspace' -Command 'cargo' -Arguments @('test', '--workspace') -WorkingDir $ROOT
}

if ($Only -eq '' -or $Only -eq 'node-contracts') {
    foreach ($suite in @(
        @{ Name = 'contract-editor-api'; File = 'apps/web/src/local/editor-api.contract.test.mjs' },
        @{ Name = 'contract-local-mcp'; File = 'apps/local-mcp/server.test.mjs' },
        @{ Name = 'contract-compat'; File = 'roadmap/compat.test.cjs' },
        @{ Name = 'contract-dashboard'; File = 'roadmap/dashboard.test.cjs' }
    )) {
        Invoke-TestSuite -Name $suite.Name -Command 'node' -Arguments @((Join-Path $ROOT $suite.File)) -WorkingDir $ROOT
    }
}

Write-TestLog 'INFO' "=== 汇总：通过套件 $PASS_SUITES，失败套件 $FAIL_SUITES ==="
[System.IO.File]::WriteAllText($LOG_FILE, ($LOG_LINES -join "`r`n"), [System.Text.Encoding]::UTF8)
Write-TestLog 'INFO' "分层测试日志：$LOG_FILE"
if ($FAIL_SUITES -gt 0) { exit 1 }
exit 0
