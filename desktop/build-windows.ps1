param([string]$Prefix = 'C:\msys64\ucrt64')
$ErrorActionPreference = 'Stop'
$Prefix = (Resolve-Path -LiteralPath $Prefix).Path
$repo = (Resolve-Path "$PSScriptRoot/..").Path
$build = Join-Path $repo '.local/native-build'
$bin = Join-Path $Prefix 'bin'
$env:PATH = "$bin;$env:PATH"
$cmake = Join-Path $bin 'cmake.exe'
& $cmake -S $PSScriptRoot -B $build -G Ninja "-DCMAKE_PREFIX_PATH=$Prefix" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE) { throw 'CMake configuration failed.' }
& $cmake --build $build --parallel 4
if ($LASTEXITCODE) { throw 'C++ build failed.' }
& "$bin/ctest.exe" --test-dir $build --output-on-failure
if ($LASTEXITCODE) { throw 'Desktop tests failed.' }

# Stage only these release binaries and their linked runtime libraries.
$stage = Join-Path $build ("package-" + [guid]::NewGuid())
$bundle = Join-Path $stage 'DailyRule'
New-Item -ItemType Directory -Path $bundle | Out-Null
Copy-Item -LiteralPath "$build/DailyRule.exe" -Destination $bundle
$qtPlugins = (& "$bin/qtpaths6.exe" --query QT_INSTALL_PLUGINS).Trim()
if ($LASTEXITCODE -or -not (Test-Path -LiteralPath $qtPlugins)) { throw 'Qt plugins were not found.' }
foreach ($plugin in 'platforms/qwindows.dll','imageformats/qjpeg.dll') {
    $destination = Join-Path $bundle $plugin
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $qtPlugins $plugin) -Destination $destination
}
@('[Paths]', 'Plugins=.') | Set-Content -Encoding ascii -LiteralPath "$bundle/qt.conf"
$pending = [Collections.Generic.Queue[string]]::new()
Get-ChildItem -LiteralPath $bundle -Recurse -File -Include '*.exe','*.dll' |
    Where-Object Extension -in '.dll','.exe' | ForEach-Object { $pending.Enqueue($_.FullName) }
while ($pending.Count -gt 0) {
    $binary = $pending.Dequeue()
    $imports = & "$bin/objdump.exe" -p $binary
    if ($LASTEXITCODE) { throw "Could not read imports for $binary." }
    foreach ($line in $imports) {
        if ($line -notmatch '^\s*DLL Name:\s*(.+?)\s*$') { continue }
        $name = $Matches[1]
        $dest = Join-Path $bundle $name
        if (Test-Path -LiteralPath $dest) { continue }
        $source = Join-Path $bin $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination $dest
            $pending.Enqueue($dest)
        } elseif ($name -notmatch '^(api|ext)-ms-' -and -not (Test-Path -LiteralPath "$env:SystemRoot/System32/$name")) {
            throw "Missing runtime DLL for ${binary}: $name"
        }
    }
}
Copy-Item -LiteralPath "$repo/LICENSE" -Destination $bundle
Copy-Item -LiteralPath "$Prefix/share/licenses" -Destination "$bundle/licenses" -Recurse
Copy-Item -LiteralPath "$PSScriptRoot/THIRD-PARTY.txt" -Destination $bundle

$release = Join-Path $repo 'release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
Copy-Item -LiteralPath $bundle -Destination $release -Recurse -Force
$zip = Join-Path $release 'DailyRule-Windows-x64.zip'
Compress-Archive -LiteralPath $bundle -DestinationPath $zip -Force
Write-Output (Join-Path $release 'DailyRule/DailyRule.exe')
Write-Output $zip
