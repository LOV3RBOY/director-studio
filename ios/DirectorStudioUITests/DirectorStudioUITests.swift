import XCTest

final class DirectorStudioUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOfflineDemoCanOpenPackAndPlayTake() throws {
        let app = XCUIApplication()
        app.launch()

        let demo = app.buttons["Open offline demo"]
        XCTAssertTrue(demo.waitForExistence(timeout: 15))
        demo.tap()
        let sampleStyle = app.buttons["Sample style"]
        XCTAssertTrue(sampleStyle.waitForExistence(timeout: 8))
        sampleStyle.tap()
        XCTAssertTrue(app.staticTexts["Pocket of Light"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Sample Project Pack"].tap()

        let take = app.buttons["demo-take"]
        if !take.isHittable { app.swipeUp() }
        XCTAssertTrue(take.waitForExistence(timeout: 8))
        take.tap()
        XCTAssertTrue(app.navigationBars["Take"].waitForExistence(timeout: 35))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }
}
