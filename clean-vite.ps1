param(
    [Parameter(Mandatory = $true)]
    [string]$Needle
)

# Kill every process whose command line contains the given needle.
# Used by start-web.bat to remove leftover Vite instances regardless of
# which port they ended up listening on (Vite auto-increments when busy).
$ErrorActionPreference = 'SilentlyContinue'

try {
    # Exclude self: the -Needle argument itself contains the path, so this
    # powershell process matches its own needle and would kill itself.
    $selfPid = $PID
    $parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId = $selfPid").ParentProcessId
    $processes = Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.Contains($Needle) -and
            $_.ProcessId -ne $selfPid -and
            $_.ProcessId -ne $parentPid
        }

    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output ("KILLED=" + $process.ProcessId)
    }
}
catch {
    Write-Output ("CLEAN_ERROR=" + $_.Exception.Message)
}
