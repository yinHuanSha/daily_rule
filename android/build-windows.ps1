param(
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$Jdk = $env:JAVA_HOME,
    [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SdkRoot -or -not $Jdk) { throw 'Set ANDROID_HOME (SDK 35, build-tools 35.0.0) and JAVA_HOME (JDK 17+) or pass -SdkRoot and -Jdk.' }
$tools = Join-Path (Resolve-Path -LiteralPath $SdkRoot) 'build-tools/35.0.0'
$platform = Join-Path $SdkRoot 'platforms/android-35/android.jar'
$java = Join-Path (Resolve-Path -LiteralPath $Jdk) 'bin'
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Program)) failed ($LASTEXITCODE)." }
}
if (-not $SkipWebBuild) {
    Push-Location $root
    try { Run 'npm.cmd' @('run', 'build') } finally { Pop-Location }
}
$dist = Join-Path $root 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) { throw 'dist/index.html not found; build the web client first.' }
$work = Join-Path $root ('.local/android-build/' + [guid]::NewGuid().ToString('N'))
$classes = Join-Path $work 'classes'
$res = Join-Path $work 'res'
$dex = Join-Path $work 'dex'
foreach ($folder in $classes,$dex,"$res/drawable-nodpi") {
    $null = New-Item -ItemType Directory -Force -Path $folder
}
Copy-Item -LiteralPath "$root/public/icon-512.png" -Destination "$res/drawable-nodpi/app_icon.png"
Run "$tools/aapt2.exe" @('compile','--dir',$res,'-o',"$work/res.zip")
Run "$tools/aapt2.exe" @('link','-I',$platform,'--manifest',"$PSScriptRoot/AndroidManifest.xml",'-o',"$work/resources.apk","$work/res.zip")
$sources = @(Get-ChildItem -LiteralPath "$PSScriptRoot/src" -Recurse -Filter '*.java' -File | ForEach-Object FullName)
Run "$java/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',("$platform;$tools/core-lambda-stubs.jar"),'-d',$classes) + $sources)
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($classes, "$work/classes.jar")
Run "$java/java.exe" @('-cp',"$tools/lib/d8.jar",'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platform,'--output',$dex,"$work/classes.jar")
Copy-Item -LiteralPath "$work/resources.apk" -Destination "$work/unsigned.apk"
$archive = [IO.Compression.ZipFile]::Open("$work/unsigned.apk", [IO.Compression.ZipArchiveMode]::Update)
try {
    $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, "$dex/classes.dex", 'classes.dex')
    # Android's AssetManager requires slash-separated names, including on Windows builders.
    foreach ($file in Get-ChildItem -LiteralPath $dist -Recurse -File) {
        $relative = $file.FullName.Substring($dist.Length + 1).Replace('\', '/')
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, "assets/www/$relative")
    }
}
finally { $archive.Dispose() }
Run "$tools/zipalign.exe" @('-f','4',"$work/unsigned.apk","$work/aligned.apk")

# One signing identity per developer Windows account; upgrades reuse that key.
$private = Join-Path $env:LOCALAPPDATA 'DailyRuleSigning'
$null = New-Item -ItemType Directory -Force -Path $private
$key = Join-Path $private 'release.p12'
$secret = Join-Path $private 'release.dpapi'
if ((Test-Path -LiteralPath $key) -ne (Test-Path -LiteralPath $secret)) {
    throw "Incomplete signing identity in $private. Restore the matching key and DPAPI password file."
}
if (-not (Test-Path -LiteralPath $key)) {
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $password = [Convert]::ToBase64String($random)
    (ConvertTo-SecureString -String $password -AsPlainText -Force | ConvertFrom-SecureString) |
        Set-Content -LiteralPath $secret -Encoding ascii
} else {
    $secure = (Get-Content -LiteralPath $secret -Raw).Trim() | ConvertTo-SecureString
    $password = [Net.NetworkCredential]::new('', $secure).Password
}
$env:DAILY_RULE_APK_STORE_PASS = $password
try {
    if (-not (Test-Path -LiteralPath $key)) {
        Run "$java/keytool.exe" @('-genkeypair','-alias','daily-rule','-keystore',$key,'-storetype','PKCS12',
            '-storepass:env','DAILY_RULE_APK_STORE_PASS','-keypass:env','DAILY_RULE_APK_STORE_PASS',
            '-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Daily Rule')
    }
    $outDir = Join-Path $root 'release'
    $null = New-Item -ItemType Directory -Force -Path $outDir
    $apk = Join-Path $outDir 'DailyRule-Android.apk'
    $signer = "$tools/lib/apksigner.jar"
    Run "$java/java.exe" @('-jar',$signer,'sign','--ks',$key,'--ks-key-alias','daily-rule',
        '--ks-pass','env:DAILY_RULE_APK_STORE_PASS','--v4-signing-enabled','false','--out',"$work/signed.apk","$work/aligned.apk")
    Run "$java/java.exe" @('-jar',$signer,'verify','--verbose',"$work/signed.apk")
    $package = [IO.Compression.ZipFile]::OpenRead("$work/signed.apk")
    try {
        $index = $package.GetEntry('assets/www/index.html')
        if (-not $index) { throw 'The APK is missing the bundled start page.' }
        $reader = [IO.StreamReader]::new($index.Open())
        try { $html = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $entry = [regex]::Match($html, 'src="(?:\./|/)?(assets/[^"]+\.js)"')
        if (-not $entry.Success -or -not $package.GetEntry('assets/www/' + $entry.Groups[1].Value)) {
            throw 'The APK is missing the JavaScript entry referenced by its start page.'
        }
    } finally { $package.Dispose() }
    Copy-Item -LiteralPath "$work/signed.apk" -Destination $apk -Force
    Write-Output $apk
} finally {
    $env:DAILY_RULE_APK_STORE_PASS = $null
}
