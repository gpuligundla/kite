#!/usr/bin/env bash
# Builds Kite's Android app: a Trusted Web Activity that opens the deployed handheld launcher full screen in
# Chrome, so the mic and camera work as they do on the web. It can also be picked as the phone's home app.
#
#   scripts/build-apk.sh https://<kite-web host>      # writes dist/kite.apk
#
# Needs, in ~/.kite-android (outside the repo):
#   jdk/ (JDK 17), sdk/ (Android SDK: platform 35, build-tools 34, plus a tools -> cmdline-tools/latest link),
#   bw/ (npm install @bubblewrap/cli), and kite-release.jks with its passwords in keystore.env.
# The site must serve /.well-known/assetlinks.json naming app.kite.handheld and this key's SHA-256 fingerprint,
# or Chrome shows its address bar. Keep the keystore: an update has to be signed with the same key.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB="${1:?usage: scripts/build-apk.sh https://<kite-web host>}"
WEB="${WEB%/}"
T="$HOME/.kite-android"
OUT="$PWD/dist"
WORK="$T/twa"
export JAVA_HOME="$T/jdk" ANDROID_HOME="$T/sdk"
BT="$ANDROID_HOME/build-tools/34.0.0"
set -a; . "$T/keystore.env"; set +a

curl -fsS "$WEB/.well-known/assetlinks.json" | grep -q app.kite.handheld \
  || echo "build-apk: $WEB doesn't vouch for app.kite.handheld yet, so the app will show Chrome's address bar." >&2

echo "== generating the Android project from $WEB/manifest.webmanifest"
rm -rf "$WORK" && mkdir -p "$WORK" "$OUT"
NODE_PATH="$T/bw/node_modules" WEB="$WEB" WORK="$WORK" KEY="$T/kite-release.jks" node - <<'JS'
const { TwaManifest, TwaGenerator, ConsoleLog } = require("@bubblewrap/core");
(async () => {
  const m = await TwaManifest.fromWebManifest(`${process.env.WEB}/manifest.webmanifest`);
  Object.assign(m, {
    packageId: "app.kite.handheld",
    name: "Kite",
    launcherName: "Kite",
    startUrl: "/os?device=handheld",
    display: "fullscreen",
    orientation: "portrait",
    appVersionName: "1.0.0",
    appVersionCode: 1,
    minSdkVersion: 24, // androidbrowserhelper 2.7 needs Android 7 or later
    signingKey: { path: process.env.KEY, alias: "kite" },
  });
  await m.saveToFile(`${process.env.WORK}/twa-manifest.json`);
  await new TwaGenerator().createTwaProject(process.env.WORK, m, new ConsoleLog("generate"));
})().catch((e) => { console.error(e); process.exit(1); });
JS

# The kid-safe phone: Android may also offer Kite as the home app. It's used only if someone picks it.
python3 - "$WORK/app/src/main/AndroidManifest.xml" <<'PY'
import re, sys
path = sys.argv[1]
xml = open(path).read()
home = """<intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.HOME"/>
                <category android:name="android.intent.category.DEFAULT"/>
            </intent-filter>
            """
launcher = re.search(r'<intent-filter>\s*<action android:name="android.intent.action.MAIN"\s*/>\s*<category android:name="android.intent.category.LAUNCHER"\s*/>\s*</intent-filter>', xml)
assert launcher, "the launcher activity's intent filter moved; update build-apk.sh"
xml = xml[:launcher.start()] + home + xml[launcher.start():]
open(path, "w").write(xml)
PY

echo "== building"
(cd "$WORK" && chmod +x gradlew && ./gradlew assembleRelease --no-daemon -q)
UNSIGNED="$WORK/app/build/outputs/apk/release/app-release-unsigned.apk"
"$BT/zipalign" -f -p 4 "$UNSIGNED" "$WORK/aligned.apk"
"$BT/apksigner" sign --ks "$T/kite-release.jks" --ks-key-alias kite \
  --ks-pass env:BUBBLEWRAP_KEYSTORE_PASSWORD --key-pass env:BUBBLEWRAP_KEY_PASSWORD --out "$OUT/kite.apk" "$WORK/aligned.apk"
"$BT/apksigner" verify "$OUT/kite.apk"
echo "== $OUT/kite.apk ($(du -h "$OUT/kite.apk" | cut -f1))"
