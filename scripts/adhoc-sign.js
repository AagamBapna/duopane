// electron-builder afterPack hook: ad-hoc sign the app bundle.
// electron-builder skips signing entirely when no identity is available,
// leaving only the Electron binary's linker-signed signature; sealing the
// whole bundle with the '-' identity keeps Gatekeeper/arm64 happy without
// requiring a Developer ID certificate.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  // For universal builds this hook also fires on the per-arch intermediates
  // (…-x64-temp / …-arm64-temp); signing those makes their non-binary files
  // differ and breaks the @electron/universal merge. Sign only the final app.
  if (context.appOutDir.endsWith('-temp')) return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
