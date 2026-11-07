$procs = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'"
foreach ($p in $procs) {
    if ($p.CommandLine -like "*InertiaPOS*") {
        Write-Host "Killing Edge helper PID: $($p.ProcessId)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
