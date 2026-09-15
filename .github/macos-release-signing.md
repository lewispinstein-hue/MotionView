# macOS Release Signing

The macOS matrix job uses the protected `macos-release` GitHub Actions
environment. Restrict it to approved release refs. This repository currently
allows only `v*` tags. Add a separate maintainer as a required reviewer when
one is available; GitHub cannot enable self-review prevention without at least
one reviewer.

Store these as **environment secrets**, never as files in the repository:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` export. |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting that `.p12`. |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity from `security find-identity -v -p codesigning`. |
| `APPLE_ID` | Apple Account email used for notarization. |
| `APPLE_PASSWORD` | Apple app-specific password, not the account password. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. |

Create the certificate secret locally without printing the result to a terminal:

```bash
openssl base64 -A -in /path/to/developer-id.p12 -out /tmp/motionview-developer-id.base64
gh secret set --env macos-release APPLE_CERTIFICATE < /tmp/motionview-developer-id.base64
rm /tmp/motionview-developer-id.base64
```

Add the remaining values interactively so they are not recorded in shell
history:

```bash
gh secret set --env macos-release APPLE_CERTIFICATE_PASSWORD
gh secret set --env macos-release APPLE_SIGNING_IDENTITY
gh secret set --env macos-release APPLE_ID
gh secret set --env macos-release APPLE_PASSWORD
gh secret set --env macos-release APPLE_TEAM_ID
```

The workflow creates a random temporary keychain for each macOS runner and
deletes it after artifact upload. It signs the bundled bridge and PROS runtime
before Tauri packages the app, then verifies the resulting app signature and
the stapled DMG ticket. Rotate the app-specific password and replace the
certificate secret whenever either credential is revoked or renewed.
