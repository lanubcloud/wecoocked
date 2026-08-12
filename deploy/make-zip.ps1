# =============================================================================
#  Genera wecoocked.zip listo para subir por el Administrador de archivos de
#  cPanel. Desde la carpeta del proyecto:
#
#      powershell -ExecutionPolicy Bypass -File deploy\make-zip.ps1
#
#  OJO: no uses Compress-Archive. En Windows PowerShell 5.1 escribe las rutas
#  del ZIP con barra invertida ("public\css\style.css"), y al descomprimir en
#  Linux eso NO crea carpetas: crea archivos con ese nombre literal y la web
#  se queda sin CSS ni JS. Por eso aqui se construye el ZIP a mano forzando
#  barras normales.
# =============================================================================
$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$salida = Join-Path $raiz 'wecoocked.zip'
if (Test-Path $salida) { [System.IO.File]::Delete($salida) }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$sep = [char]92   # barra invertida

# Solo lo que necesita el servidor. node_modules lo genera npm install en el VPS.
$rel = New-Object System.Collections.ArrayList
foreach ($f in @('package.json', 'package-lock.json', 'README.md', 'deploy\update-cpanel.sh')) {
  [void]$rel.Add($f)
}
foreach ($f in (Get-ChildItem -Recurse -File server, public, test)) {
  [void]$rel.Add($f.FullName.Substring($raiz.Length + 1))
}

$zip = [System.IO.Compression.ZipFile]::Open($salida, 'Create')
foreach ($r in $rel) {
  $abs = Join-Path $raiz $r
  $enZip = $r.Replace($sep, '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $abs, $enZip, 'Optimal') | Out-Null
}
$zip.Dispose()

# Comprobacion: ninguna entrada puede llevar barra invertida
$zip = [System.IO.Compression.ZipFile]::OpenRead($salida)
$malas = @($zip.Entries | Where-Object { $_.FullName.Contains($sep) }).Count
$total = $zip.Entries.Count
$zip.Dispose()

if ($malas -gt 0) {
  Write-Error "El ZIP tiene $malas rutas con barra invertida: no serviria en Linux."
  exit 1
}
"OK - $salida"
"$total archivos, {0:N0} KB" -f ((Get-Item $salida).Length / 1KB)
