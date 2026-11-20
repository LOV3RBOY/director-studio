import XCTest

final class DirectorStudioUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOfflineDemoCanOpenPackAndPlayTake() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-sign-in"]
        app.launch()

        let demo = app.buttons["open-offline-demo"]
        XCTAssertTrue(demo.waitForExistence(timeout: 15))
        demo.tap()
        let sampleStyle = app.buttons["demo-style"]
        XCTAssertTrue(sampleStyle.waitForExistence(timeout: 8))
        sampleStyle.tap()
        let guide = app.navigationBars["Sample Style"]
        XCTAssertTrue(guide.waitForExistence(timeout: 8))
        guide.buttons["BackButton"].tap()
        let pack = app.buttons["demo-pack"]
        XCTAssertTrue(pack.waitForExistence(timeout: 8), app.debugDescription)
        pack.tap()

        let take = app.buttons["demo-take"]
        if !take.isHittable { app.swipeUp() }
        XCTAssertTrue(take.waitForExistence(timeout: 8))
        take.tap()
        XCTAssertTrue(app.navigationBars["Take"].waitForExistence(timeout: 35))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    private func signedIn() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-sign-in"]
        app.launch()

        let address = app.textFields["Studio server address"]
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        let fixtureAddress = "http://127.0.0.1:3191"
        if address.value as? String != fixtureAddress {
            address.tap()
            address.typeText(fixtureAddress)
        }
        let email = app.textFields["Email"]
        email.tap()
        email.typeText("studio-ios@example.test")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText("fixture-password")
        app.buttons["Sign in"].tap()

        let director = app.tabBars.buttons["Director"]
        XCTAssertTrue(director.waitForExistence(timeout: 20))
        // iOS may offer to save the fixture password after sign-in.
        let savePassword = app.sheets["Save Password?"].buttons["Not Now"]
        if savePassword.waitForExistence(timeout: 3) {
            savePassword.tap()
            XCTAssertTrue(savePassword.waitForNonExistence(timeout: 8))
        }
        director.tap()
        XCTAssertTrue(app.navigationBars["Director"].waitForExistence(timeout: 10), app.debugDescription)
        let project = app.staticTexts["iPhone fixture project"]
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        return app
    }

    func testSignedInStyleLibraryCanOpenAGuide() throws {
        let app = signedIn()
        let library = app.buttons["open-style-library"]
        XCTAssertTrue(library.waitForExistence(timeout: 8), app.debugDescription)
        library.tap()
        XCTAssertTrue(app.navigationBars["Style Library"].waitForExistence(timeout: 10), app.debugDescription)
        let style = app.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "style-row-")).firstMatch
        XCTAssertTrue(style.waitForExistence(timeout: 10), app.debugDescription)
        let guide = app.navigationBars["iPhone fixture style"]
        if style.isHittable { style.tap() }
        if !guide.waitForExistence(timeout: 4) {
            let title = app.staticTexts["iPhone fixture style"].firstMatch
            XCTAssertTrue(title.exists, app.debugDescription)
            let window = app.windows.firstMatch
            XCTAssertTrue(window.frame.intersects(title.frame), app.debugDescription)
            window.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: title.frame.midX - window.frame.minX, dy: title.frame.midY - window.frame.minY)).tap()
        }
        XCTAssertTrue(guide.waitForExistence(timeout: 12), app.debugDescription)
        let saveStyle = app.buttons["Save style"]
        reveal(saveStyle, in: app)
        XCTAssertTrue(saveStyle.exists, app.debugDescription)
    }

    func testSignedInWorkspaceCanRenderAndPlayTake() throws {
        let app = signedIn()
        let project = app.staticTexts["iPhone fixture project"]
        project.tap()
        let pack = app.buttons["Open Project Pack"]
        XCTAssertTrue(pack.waitForExistence(timeout: 15))
        pack.tap()
        let quote = app.buttons["Review render quote"]
        reveal(quote, in: app)
        quote.tap()
        let approval = app.buttons["approve-generation"]
        XCTAssertTrue(approval.waitForExistence(timeout: 10), app.debugDescription)
        approval.tap()

        let take = app.buttons["Play take"].firstMatch
        reveal(take, in: app)
        XCTAssertTrue(take.waitForExistence(timeout: 25), app.debugDescription)
        if !take.isHittable { app.swipeUp() }
        take.tap()
        XCTAssertTrue(app.navigationBars["Take"].waitForExistence(timeout: 25))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<6 {
            if element.isHittable { return }
            app.swipeUp()
        }
    }
}
