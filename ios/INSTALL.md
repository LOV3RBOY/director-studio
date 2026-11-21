# Install Out of Order Studio on an iPhone

**Requires an iPhone on iOS 17 or later and a version of Xcode that supports the iOS version on the phone.** This package contains a SwiftUI project and uses Apple system frameworks. It needs no package downloads.

1. Extract the ZIP to a new folder. Open **DirectorStudio.xcodeproj** in Xcode. If asked, choose **Trust and Open** only after confirming the ZIP came from the private Director Studio repository or build.
2. Open **Xcode → Settings → Accounts**, click **+**, and sign in with your Apple Account.
3. In the project navigator, select **DirectorStudio**. Under **Targets**, select **DirectorStudio**, then open **Signing & Capabilities**. Enable **Automatically manage signing**, select your **Team**, and set a unique bundle identifier if Xcode says the default identifier is already taken.
4. Connect your iPhone, unlock it, and choose **Trust** on the phone when prompted. In Xcode, pair the device if needed. If prompted on the iPhone, open **Settings → Privacy & Security → Developer Mode**, enable it, restart, and confirm.
5. In the Xcode toolbar, choose the **DirectorStudio** scheme and your **iPhone** as the run destination. Click **Run** (⌘R). If Xcode reports missing device support, install the required SDK or update Xcode.
6. Open **Out of Order**. Choose **Open offline demo** to open a sample Project Pack and play a synthetic take. For the connected flow, enter your authorized HTTPS Studio origin, sign in, open the Style Library, select an image or video, and verify a saved style and take playback. You need an HTTPS Studio server reachable from the phone for the connected flow. For a Debug build paired to a Mac on the same network, choose **Open local studio**. The Studio, Agents, and Library tabs share the signed-in account with the native Director tab.

Imports preserve JPEG, PNG, and WebP originals. Other Photos image formats, including HEIC, are converted to JPEG on the phone for compatible references.

A free Personal Team supports personal device testing. Its provisioning profile expires after seven days, so rebuild and reinstall when it expires. Signing stays on your Mac.

[Running an app on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) · [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) · [Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account)
