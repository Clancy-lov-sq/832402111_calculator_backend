# =============================================================================
# capture-api-transcript.ps1
#
# Runs every endpoint of the back end against the running service and writes the
# raw request/response transcript to tools/api-transcript.txt.
#
# The transcript is the evidence behind the screenshots: it shows the exact JSON
# the front end sends and receives, the HTTP status of every answer, and the
# stable error code of every rejected request.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools/capture-api-transcript.ps1
# =============================================================================

[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:8080',
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutFile) { $OutFile = Join-Path $scriptDirectory 'api-transcript.txt' }

$lines = New-Object System.Collections.Generic.List[string]
$script:LastPayload = ''

function Add-Line([string]$text) {
  $lines.Add($text)
}

<#
  Sends one request, records the status and the body, and returns the body.
  A rejected request is recorded as well: the status comes from the exception and
  the body is read from its response stream.
#>
function Invoke-Api([string]$method, [string]$path, [string]$body) {
  Add-Line ''
  Add-Line ('-' * 78)
  Add-Line "$method $path"
  if ($body) { Add-Line "  request : $body" }

  $parameters = @{
    Uri             = "$BaseUrl$path"
    Method          = $method
    UseBasicParsing = $true
    TimeoutSec      = 15
  }
  if ($body) {
    $parameters['ContentType'] = 'application/json'
    $parameters['Body'] = $body
  }

  $status = ''
  $payload = ''
  try {
    $response = Invoke-WebRequest @parameters
    $status = [int]$response.StatusCode
    $payload = $response.Content
  } catch {
    # Invoke-WebRequest throws on 4xx/5xx in Windows PowerShell 5.1. The status is
    # still available on the exception, and that is the interesting part here.
    $webResponse = $_.Exception.Response
    if ($webResponse -ne $null) {
      $status = [int]$webResponse.StatusCode
      try {
        $stream = $webResponse.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $payload = $reader.ReadToEnd()
        $reader.Close()
      } catch {
        $payload = ''
      }
    } else {
      $status = 'no answer'
      $payload = $_.Exception.Message
    }
  }

  Add-Line "  status  : $status"
  Add-Line "  response: $payload"

  Write-Host ("  {0,-6} {1,-36} -> {2}" -f $method, $path, $status)

  $script:LastPayload = $payload
  return $payload
}

Add-Line 'API transcript of the calculator back end'
Add-Line ('=' * 78)
Add-Line "Captured : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line "Base URL : $BaseUrl"
Add-Line ''
Add-Line 'Notation: "status" is the HTTP status code, "response" is the JSON body.'
Add-Line 'The API runs in lenient mode, where a rejected expression answers HTTP 200'
Add-Line 'with "success": false so that the front end keeps a single response format;'
Add-Line 'every other rejection (unknown endpoint, missing record) keeps its 4xx status.'

Write-Host 'Capturing the API transcript' -ForegroundColor Cyan

# --- service information -----------------------------------------------------
Add-Line ''
Add-Line '### Service information'
Invoke-Api 'GET' '/api/health' '' | Out-Null
Invoke-Api 'GET' '/api/capabilities' '' | Out-Null

# --- the four required functions --------------------------------------------
Add-Line ''
Add-Line '### Function 1 and 2: basic, decimal, compound and unary calculations'
foreach ($expression in @('12+8', '20-7', '6*7', '84/12', '12.5/2', '1+2*3', '(1+2)*3', '10/2+7', '8-3*2', '-5+8', '3*-2')) {
  Invoke-Api 'POST' '/api/calculate' ('{"expression":"' + $expression + '"}') | Out-Null
}

# --- error handling ---------------------------------------------------------
Add-Line ''
Add-Line '### Exception handling: every rejected request answers with a stable error code'
foreach ($body in @(
    '{"expression":"1+*2"}',
    '{"expression":"10/(3-3)"}',
    '{"expression":"(1+2"}',
    '{"expression":"1+2;"}',
    '{"expression":""}',
    '{"expression":"sqrt(144)"}',
    '{"expression":"9**9**9"}'
  )) {
  Invoke-Api 'POST' '/api/calculate' $body | Out-Null
}

Add-Line ''
Add-Line '### Scientific mode: functions and constants'
Invoke-Api 'POST' '/api/calculate' '{"expression":"sqrt(144)+2**10/4","mode":"scientific"}' | Out-Null
Invoke-Api 'POST' '/api/calculate' '{"expression":"sin(0)+cos(0)+ln(e)","mode":"scientific"}' | Out-Null

# --- calculation history ----------------------------------------------------
Add-Line ''
Add-Line '### Function 3: calculation history read from the database'
Invoke-Api 'GET' '/api/history?limit=5' '' | Out-Null
Invoke-Api 'GET' '/api/history?keyword=sqrt' '' | Out-Null
Invoke-Api 'GET' '/api/convert/units' '' | Out-Null

# --- deletion ---------------------------------------------------------------
Add-Line ''
Add-Line '### Function 4: deleting one record by id'
Invoke-Api 'POST' '/api/calculate' '{"expression":"999-1"}' | Out-Null
$createdId = ''
try {
  $createdId = ($script:LastPayload | ConvertFrom-Json).historyId
} catch {
  $createdId = ''
}

if ($createdId) {
  Add-Line "  (the record created above has the id $createdId)"
  Invoke-Api 'DELETE' "/api/history/$createdId" '' | Out-Null
  Invoke-Api 'GET' '/api/history?keyword=999-1' '' | Out-Null
} else {
  Add-Line '  (the created record could not be identified; the deletion is skipped)'
}

# --- extended features ------------------------------------------------------
Add-Line ''
Add-Line '### Extended features: statistics, number base conversion, unit conversion'
Invoke-Api 'GET' '/api/stats?days=7' '' | Out-Null
Invoke-Api 'POST' '/api/convert/base' '{"value":255}' | Out-Null
Invoke-Api 'POST' '/api/convert/base' '{"value":"ff","fromBase":16}' | Out-Null
Invoke-Api 'POST' '/api/convert/unit' '{"value":100,"from":"km/h","to":"mph"}' | Out-Null
Invoke-Api 'POST' '/api/convert/unit' '{"value":100,"from":"\u00b0c","to":"\u00b0f"}' | Out-Null

# --- transport ---------------------------------------------------------------
Add-Line ''
Add-Line '### Transport: an unknown endpoint, and a missing history record'
Invoke-Api 'GET' '/api/does-not-exist' '' | Out-Null
Invoke-Api 'DELETE' '/api/history/999999' '' | Out-Null

Add-Line ''
Add-Line ('=' * 78)

$lines -join "`r`n" | Set-Content -Path $OutFile -Encoding UTF8
Write-Host ''
Write-Host "Transcript written to $OutFile" -ForegroundColor Green
