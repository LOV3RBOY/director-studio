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
        guide.buttons.firstMatch.tap()
        app.buttons["demo-pack"].tap()

        let take = app.buttons["demo-take"]
        if !take.isHittable { app.swipeUp() }
        XCTAssertTrue(take.waitForExistence(timeout: 8))
        take.tap()
        XCTAssertTrue(app.navigationBars["Take"].waitForExistence(timeout: 35))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    func testSignedInWorkspaceCanRenderAndPlayTake() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fresh-sign-in"]
        app.launch()

        let address = app.textFields["Studio server address"]
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap()
        address.typeText("http://127.0.0.1:3191")
        let email = app.textFields["Email"]
        email.tap()
        email.typeText("studio-ios@example.test")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText("fixture-password")
        app.buttons["Sign in"].tap()

        let project = app.staticTexts["iPhone fixture project"]
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        app.tabBars.buttons["Style Library"].tap()
        XCTAssertTrue(app.navigationBars["Style Library"].waitForExistence(timeout: 10), app.debugDescription)
        let style = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "style-row-")).firstMatch
        XCTAssertTrue(style.waitForExistence(timeout: 10), app.debugDescription)
        style.tap()
        XCTAssertTrue(app.navigationBars["iPhone fixture style"].waitForExistence(timeout: 10), app.debugDescription)
        let saveStyle = app.buttons["Save style"]
        reveal(saveStyle, in: app)
        XCTAssertTrue(saveStyle.isHittable, app.debugDescription)
        app.tabBars.buttons["Director"].tap()
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
