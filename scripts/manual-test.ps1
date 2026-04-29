param(
    [string]$Port,
    [int]$WebPort,
    [int]$SilenceTimeout = 600,
    [switch]$NoBuild,
    [switch]$NoBrowser,
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Read-EnvFile {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '=') {
            continue
        }

        $key, $value = $line -split '=', 2
        $values[$key.Trim()] = $value.Trim()
    }

    return $values
}

function Ensure-EnvFile {
    $envPath = Join-Path $RepoRoot ".env"
    $examplePath = Join-Path $RepoRoot ".env.example"

    if (-not (Test-Path -LiteralPath $envPath)) {
        if (-not (Test-Path -LiteralPath $examplePath)) {
            throw ".env is missing and .env.example was not found."
        }

        Copy-Item -LiteralPath $examplePath -Destination $envPath
        Write-Host "Created .env from .env.example"
    }

    $values = Read-EnvFile $envPath
    $defaults = @{
        SESSION_SECRET = "local-test-session-secret"
        BRIDGE_API_TOKEN = "local-test-bridge-token"
        ADMIN_API_TOKEN = "local-test-admin-token"
    }

    $lines = Get-Content -LiteralPath $envPath
    $changed = $false

    foreach ($key in $defaults.Keys) {
        if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
            $replacement = "$key=$($defaults[$key])"
            $matched = $false
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($lines[$i] -match "^$key=") {
                    $lines[$i] = $replacement
                    $matched = $true
                    break
                }
            }

            if (-not $matched) {
                $lines += $replacement
            }
            $changed = $true
        }
    }

    if ($changed) {
        Set-Content -LiteralPath $envPath -Value $lines
        Write-Host "Filled blank local test secrets in .env"
    }

    return Read-EnvFile $envPath
}

function Get-FirstUsbSerialPort {
    if (-not (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue)) {
        return $null
    }

    $ports = Get-PnpDevice -Class Ports -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Status -eq "OK" -and
            $_.FriendlyName -match "\(COM\d+\)" -and
            $_.FriendlyName -notmatch "Bluetooth"
        }

    foreach ($candidate in $ports) {
        if ($candidate.FriendlyName -match "(COM\d+)") {
            return $matches[1]
        }
    }

    return $null
}

function Wait-ForServiceHealth {
    param(
        [string]$ContainerName,
        [int]$TimeoutSeconds = 90
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $health = docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerName 2>$null
        if ($LASTEXITCODE -eq 0 -and ($health -eq "healthy" -or $health -eq "running")) {
            return
        }
        Start-Sleep -Seconds 3
    }

    throw "Timed out waiting for $ContainerName to become healthy."
}

$envValues = Ensure-EnvFile

if (-not $WebPort) {
    if ($envValues.ContainsKey("WEB_PORT") -and $envValues["WEB_PORT"]) {
        $WebPort = [int]$envValues["WEB_PORT"]
    } else {
        $WebPort = 3000
    }
}

if (-not $envValues.ContainsKey("BRIDGE_API_TOKEN") -or [string]::IsNullOrWhiteSpace($envValues["BRIDGE_API_TOKEN"])) {
    throw "BRIDGE_API_TOKEN is still blank in .env"
}

$env:BRIDGE_API_TOKEN = $envValues["BRIDGE_API_TOKEN"]

if (-not $SkipDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker was not found. Start Docker Desktop and make sure docker is on PATH."
    }

    if ($NoBuild) {
        docker compose up -d
    } else {
        docker compose up -d --build
    }

    Wait-ForServiceHealth "iot-demo-postgres"
    Wait-ForServiceHealth "iot-demo-web"
}

if (-not $Port) {
    $Port = Get-FirstUsbSerialPort
}

if (-not $Port) {
    Write-Host "Could not auto-detect a USB serial port."
    Write-Host "Available ports:"
    Get-PnpDevice -Class Ports | Format-Table Status, FriendlyName -AutoSize
    throw "Run again with -Port COM6, replacing COM6 with your Arduino port."
}

$endpoint = "http://localhost:$WebPort/api/movement"

if (-not $NoBrowser) {
    Start-Process "http://localhost:$WebPort"
}

Write-Host ""
Write-Host "Manual demo test is ready."
Write-Host "Dashboard: http://localhost:$WebPort"
Write-Host "Arduino port: $Port"
Write-Host "Endpoint: $endpoint"
Write-Host ""
Write-Host "Now reset the Arduino, say 'start', present the green colour token, then move the board."
Write-Host "Press Ctrl+C to stop the bridge."
Write-Host ""

python "bridge\serial_to_http.py" `
    --port $Port `
    --endpoint $endpoint `
    --verbose `
    --silence-timeout $SilenceTimeout
