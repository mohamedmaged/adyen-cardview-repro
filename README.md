# Adyen React Native `CardView` on iOS: freeze and cut-off form at the bottom of the screen

A minimal Expo app that reproduces two iOS bugs in the embedded `<CardView>` of
[`@adyen/react-native`](https://github.com/Adyen/adyen-react-native) 2.12.0, which uses Adyen iOS 5.25.1. It uses
stock packages and Adyen's default styling, on iPhone 17 Pro simulators with iOS 26.0 and 26.3.

1. **Freeze.** When the `CardView` mounts at or below the bottom edge of the screen, the main thread spins at 100%
   CPU and the app never draws again. On a scrolling checkout page, that happens whenever the card form starts
   below the fold.
2. **Cut-off form.** When the `CardView` gets its height while its bottom edge reaches into the home-indicator
   area (the bottom 34pt of an iPhone 17 Pro), that overlap is hidden. The Pay button loses its bottom 10pt and its
   rounded corners. The form stays cut wherever the page scrolls it afterwards.

Both come from Adyen's form following the safe area while it is embedded in a page. A two-part patch to the Adyen
iOS pod, [`patches/Adyen@5.25.1.patch`](patches/Adyen@5.25.1.patch), fixes both: see [The fix](#the-fix).

<table>
  <tr>
    <th>Stock: the bottom of the form is cut off</th>
    <th>With the patch</th>
  </tr>
  <tr>
    <td><img src="evidence/readme/cut-stock.png" width="380" alt="Stock: the Pay button's bottom edge is cut off and square"></td>
    <td><img src="evidence/readme/cut-patched.png" width="380" alt="Patched: the whole Pay button, with rounded corners"></td>
  </tr>
</table>

These are the bottom of the screen in the `growIntoStrip` scenario on iOS 26.0. The full screenshots are
[stock](evidence/stock-ios26.0/growIntoStrip.png) and [patched](evidence/patched-ios26.0/growIntoStrip.png).
The freeze has no picture: the app never draws its first frame, so its screenshot is plain white
([`bottomEdge.png`](evidence/stock-ios26.0/bottomEdge.png)).

## Versions

| | |
|---|---|
| `@adyen/react-native` | 2.12.0, the latest release (2026-07-13) |
| Adyen iOS | 5.25.1, pinned by the `@adyen/react-native` podspec; Adyen3DS2 2.4.4 |
| React Native | 0.85.3 with the New Architecture; React 19.2.3 |
| Expo SDK | 56 (`expo` 56.0.23) |
| Xcode | 26.3 (17C529), iOS Simulator SDK 26.2 |
| Simulators | iPhone 17 Pro with iOS 26.0 (23A343), and with iOS 26.3 (23D8133) |
| Host | macOS 26.5, Node 24.15.0, npm 11.12.1, CocoaPods 1.16.2 |

No `@adyen/react-native` release uses Adyen iOS 5.26.0 (2026-10-07) yet. Its `FormViewController` lays out the form
the same way as 5.25.1, so both bugs are probably still there. Its source was read, not run.

## Reproduce

You need macOS with Xcode 26 and an iOS 26 simulator runtime, Node and CocoaPods.

```sh
git clone https://github.com/mohamedmaged/adyen-cardview-repro.git
cd adyen-cardview-repro
npm ci
npx expo prebuild -p ios      # makes ios/ and runs pod install, with stock Adyen 5.25.1

# A simulator. The numbers in this README are for an iPhone 17 Pro.
UDID=$(xcrun simctl create "Adyen Repro" "iPhone 17 Pro" com.apple.CoreSimulator.SimRuntime.iOS-26-0)
xcrun simctl boot "$UDID" && open -a Simulator

# A Release build bundles the JS: no Metro, and no rebuild between scenarios.
xcodebuild -workspace ios/AdyenRepro.xcworkspace -scheme AdyenRepro -configuration Release \
  -destination "id=$UDID" -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
xcrun simctl install "$UDID" build/DerivedData/Build/Products/Release-iphonesimulator/AdyenRepro.app

xcrun simctl launch "$UDID" com.example.adyencardviewrepro -scenario growIntoStrip   # the cut
```

Stop the app before you launch another scenario. A frozen app doesn't respond to `xcrun simctl terminate` (the
command hangs), so kill its process instead:

```sh
pkill -9 -f "$UDID/data/Containers/Bundle/Application/.*/AdyenRepro.app/AdyenRepro"
xcrun simctl launch "$UDID" com.example.adyencardviewrepro -scenario bottomEdge      # the freeze
```

Without `-scenario`, the app lists the scenarios to tap. The scenario is a launch argument rather than a deep link,
because on iOS 26 `simctl openurl` asks "Open in AdyenRepro?" every time.

`capture.sh` runs a scenario and records what happened. It stops the app, launches the scenario, waits 6 s, and
saves the evidence into `evidence/<label>/`. If the app is frozen, it then kills it.

```sh
UDID=$UDID ./capture.sh stock growIntoStrip
```

### The app

[`App.tsx`](App.tsx) is the whole app. It mounts the card the way a checkout page would:

```tsx
<AdyenCheckout config={config} onSubmit={...} onAdditionalDetails={...} onError={...}>
  <CardView paymentMethod={{ type: 'scheme', name: 'Cards', brands: ['mc', 'visa'] }} />
</AdyenCheckout>
```

```ts
const config = {
  environment: 'test',
  clientKey: 'test_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE',
  locale: 'en-US',
  returnUrl: 'adyenrepro://',
  analytics: { enabled: false },
  card: { holderNameRequired: true, showStorePaymentField: true },
}
```

The client key is made up. The form still renders; only its network calls would fail. The card sits in a white
container with no padding, on a grey page.

The app does two more things:

- **It closes the keyboard once.** Adyen's form puts the cursor in its first field when it appears, and the
  keyboard would then cover the bottom of the screen, where the Pay button has to be checked. On the first
  `keyboardDidShow`, the app focuses and blurs a hidden `TextInput`.
- **It shows a timeline** under the scenario name: when the card got its height, when the page scrolled, and the
  keyboard events, in ms from mount. You can read it in the screenshots.

### Scenarios

Positions are for the iPhone 17 Pro. Its screen is 402×874pt, and the home-indicator strip is y 840–874 (34pt).
Once the card view has its height, it is 372pt tall.

| Scenario | What it does |
|---|---|
| `middle` | Control: the card is centred (y 251–623), clear of the safe-area strips. |
| `strip` | A `ScrollView` with a 1000pt spacer, then the card, then nothing. The card mounts below the fold (y 1000). Once it has its height, the page scrolls to the end, which puts the card's bottom edge at the bottom of the screen. |
| `belowFold` | The same page without the scroll: the card mounts below the fold and stays there. |
| `bottomEdge` | The card is the last child of a `flex: 1, justifyContent: 'flex-end'` view, so it mounts 0pt tall at the bottom edge (y 874). |
| `scrollIntoStrip` | The card mounts at y 200 and gets its height there, inside the safe area. 500 ms later, the page scrolls its bottom edge to the bottom of the screen. |
| `scrollIntoStripNow` | The same, but the page scrolls as soon as the height arrives. React Native reports the height before the card's frame is applied, so the scroll races the frame. |
| `growIntoStrip` | The card mounts at y 600, inside the safe area. Its height takes its bottom past the bottom edge (y 600–972). 500 ms later, the page scrolls its bottom edge to the bottom of the screen. |
| `growIntoStripThenMiddle` | `growIntoStrip`, then the page scrolls 300pt further, which brings the card to y 202–574, wholly inside the safe area. |

## Results

Every run is a Release build, cold-launched and read 6 s after launch by `capture.sh`.

- **Freeze**: 99–100% CPU in all five readings, with the main thread inside
  `CardComponentViewProxy.attachChildViewControllerIfNeeded()`.
- **Cut**: Adyen's `UIScrollView` is 338pt for the 372pt form, so the bottom 34pt of the form are hidden.
- **OK**: 0% CPU, and the scroll view is as tall as the form.

"inset" is the bottom `safeAreaInsets` of `FormViewController.view`.

| Scenario | Stock, iOS 26.0 | Stock, iOS 26.3 | Patched, iOS 26.0 | Patched, iOS 26.3 |
|---|---|---|---|---|
| `middle` | OK (inset 0) | OK | OK | OK |
| `strip` | **Freeze** at mount: the card view is at y 1000, still 0pt tall, before any scroll; inset 34 | **Freeze** | OK: card at y 502–874, inset 34, scroll view 372 | OK |
| `belowFold` | **Freeze** at mount (y 1000, 0pt, inset 34) | **Freeze** | OK | OK |
| `bottomEdge` | **Freeze** at mount (y 874, 0pt, inset 34) | **Freeze** | OK: y 502–874, inset 34, scroll view 372 | OK |
| `scrollIntoStrip` | OK: y 502–874, inset 0, scroll view 372 | OK | OK | OK |
| `scrollIntoStripNow` | **Cut** in this run; it's a race (see below) | **Cut** in this run | OK | OK |
| `growIntoStrip` | **Cut**: y 502–874, inset 34, scroll view 338 | **Cut** | OK: inset 34, scroll view 372 | OK |
| `growIntoStripThenMiddle` | **Cut**, still, at y 202–574, wholly inside the safe area; inset still 34 | **Cut** | OK at y 202 | OK |

How to read the view numbers in the evidence: the card view and Adyen's form are both 372pt tall. Inside the card
view, `CardComponentViewProxy` holds `SecuredViewController.view`, which holds `FormViewController.view`, which
holds a `UIScrollView`, which holds the `Adyen.FormView`. When the `UIScrollView` is shorter than the `FormView`,
the form is cut by the difference. The Pay button spans y 298–348 of the form, so a 338pt scroll view hides its
bottom 10pt.

### How long the freeze lasts

In [`bottomEdge-cpu-2min.txt`](evidence/stock-ios26.0/bottomEdge-cpu-2min.txt), CPU is 98.8–100% at +10, +30,
+60 and +120 s. At +120 s, all 646 of 646 main-thread samples are inside `attachChildViewControllerIfNeeded()`. The main
thread, from [`bottomEdge-sample-excerpt.txt`](evidence/stock-ios26.0/bottomEdge-sample-excerpt.txt):

```
-[RCTMountingManager performTransaction:]
-[RCTViewComponentView mountChildComponentView:index:]
-[UIView(Internal) _didMoveFromWindow:toWindow:]
@objc CardComponentViewProxy.didMoveToWindow()
CardComponentViewProxy.attachChildViewControllerIfNeeded()    CardComponentViewProxy.swift:175
-[UIView(Hierarchy) layoutBelowIfNeeded]
CA::Layer::update_if_needed → -[UIView(CALayerDelegate) layoutSublayersOfLayer:] → -[UIView(Hierarchy) layoutSubviews]
-[UIView _updateConstraintsAsNecessaryAndApplyLayoutFromEngine] → … → -[UIView(Geometry) setBounds:]
-[UIView _updateInferredLayoutMarginsFromSuperview:]          (recursing)
```

Deeper down, 163 lines of [that sample](evidence/stock-ios26.0/bottomEdge-sample.txt) name
`_UIViewAdjustedLayoutMarginsForLayoutMargins` and 61 name `_safeAreaInsetsForFrame:inSuperview:`.

### What decides the cut

Stock, each scenario cold-launched 5 times:

| Scenario | Cut, iOS 26.0 | Cut, iOS 26.3 |
|---|---|---|
| `scrollIntoStrip`: sized inside the safe area, scrolled into the strip 500 ms later | 0/5 | 0/5 |
| `scrollIntoStripNow`: the same scroll, sent at once, so it races the card's new frame | 3/5 | 0/5 |
| `growIntoStrip`: sized while it reached past the bottom edge | 5/5 | 5/5 |

The runs are in [`repeats-stock-ios26.0.txt`](evidence/repeats-stock-ios26.0.txt) and
[`repeats-stock-ios26.3.txt`](evidence/repeats-stock-ios26.3.txt), made with:

```sh
for s in scrollIntoStrip scrollIntoStripNow growIntoStrip; do for i in 1 2 3 4 5; do
  UDID=$UDID ./capture.sh rep $s 5 > /dev/null; grep '<UIScrollView:' evidence/rep/$s-frames.txt
done; done; rm -rf evidence/rep
```

### Which part of the fix does what (iOS 26.0)

| Scenario | Part A only: scroll view pinned to `view` | Part B only: margins ignore the safe area | Both: the patch |
|---|---|---|---|
| `middle` | OK | OK | OK |
| `strip` | **Freeze** | **Cut** | OK |
| `belowFold` | **Freeze** | **Cut** | OK |
| `bottomEdge` | **Freeze** | **Cut** | OK |
| `scrollIntoStrip` | OK | OK | OK |
| `scrollIntoStripNow` | **Freeze** in this run | OK in this run (the race) | OK |
| `growIntoStrip` | **Freeze**, where stock only cut it | **Cut** | OK |
| `growIntoStripThenMiddle` | **Freeze** | **Cut** | OK |

## What goes wrong

### The cut-off form

- `FormViewController.setupLayout()` pins its scroll view inside `view.safeAreaLayoutGuide`.
- When `FormViewController.view` overlaps the home-indicator strip, its bottom safe-area inset is the overlap: up
  to 34pt here. The scroll view is then shorter than the view by that much.
- Meanwhile, the card view is sized from `preferredContentSize`, the whole 372pt form. When it embeds the form,
  `CardComponentViewProxy` turns the scroll view's scrolling off and sets its `contentInsetAdjustmentBehavior` to
  `.never` (`CardComponentViewProxy.swift:190`). So the bottom of the form is simply hidden.
- With default styling, the Pay button ends 24pt above the bottom of the form, so a 34pt cut takes its bottom
  10pt and its rounded corners.
- The inset is set when the card view's frame is applied, which is when its height arrives or changes. Scrolling
  doesn't update it:
  - a card that got its height inside the safe area and was then scrolled into the strip stayed whole
    (`scrollIntoStrip`, cut in 0 of 10 runs);
  - a card that got its height while it reached into or past the strip was cut (`growIntoStrip`, 10 of 10). So
    were `strip`, `belowFold` and `bottomEdge`, once Part B of the fix removed their freeze;
  - it stays cut when the page later scrolls it to the middle of the screen (`growIntoStripThenMiddle`: the inset
    is still 34 at y 202).

  So on a real page, anything that resizes the card while it sits low on the screen can cut it. This is inferred
  from the measurements, not from UIKit's source.

### The freeze

- Adyen's form is built to be a full-screen view controller, and its rows lay out against their layout margins:
  `FormButtonItemView` pins the Pay button inside its `layoutMarginsGuide`, the text fields use margin-relative
  stack views, and every item preserves its superview's margins.
- UIKit's default, `insetsLayoutMarginsFromSafeArea = true`, grows a view's margins by however much of the view
  overlaps the safe-area strip.
- The card view is still 0pt tall when it attaches to the window. Its height arrives later, as an event from
  `preferredContentSize`. At or below the bottom edge, Adyen's views then sit in or below the 34pt strip, so they
  get safe-area insets and their margins grow.
- `CardComponentViewProxy` then forces a layout at once: `layoutIfNeeded()` in
  `attachChildViewControllerIfNeeded()` (`CardComponentViewProxy.swift:175`), called from `didMoveToWindow`, inside
  Fabric's mount transaction on the main thread. That layout never settles.
- In [`bottomEdge-margins-while-frozen.txt`](evidence/stock-ios26.0/bottomEdge-margins-while-frozen.txt), the frozen
  app was stopped 8 times. The Pay button row's frame (76pt tall instead of 66), the form (382pt instead of 372) and
  the row's safe-area inset (10pt) never changed. But the row's bottom margin kept flipping between 18 (its 8 plus
  the 10pt inset) and 26. In a healthy run, the same row has 8pt margins and no inset.
- Each pass changes the margins, which invalidates the layout, which runs another pass. The call never returns, the
  main thread spins, and the first frame is never drawn. Why UIKit alternates between those two values is
  inferred, not traced.
- Mid-screen there is no inset, so there is no loop.

## The fix

[`patches/Adyen@5.25.1.patch`](patches/Adyen@5.25.1.patch) changes two files of the Adyen iOS pod, in two parts:

- **Part A** ([`A-scroll-view-pinned-to-view.patch`](patches/parts/A-scroll-view-pinned-to-view.patch)).
  `FormViewController.setupLayout()` pins the scroll view to `view` instead of `view.safeAreaLayoutGuide`, and sets
  `contentInsetAdjustmentBehavior = .always`. Full screen, the content inset still keeps the form clear of the safe
  area. Embedded, the card view sets `.never`, so no part of the form is lost to it.
- **Part B** ([`B-margins-ignore-safe-area.patch`](patches/parts/B-margins-ignore-safe-area.patch)).
  `insetsLayoutMarginsFromSafeArea = false` on `FormViewController.view`, on its scroll view, and on every form
  item and its subviews, from `FormView.appendItemView`.

Both parts are needed. Part B alone fixes every freeze, but not the cut. Part A alone fixes the cut but adds
freezes: once the scroll view is no longer cut short, the form's rows reach into the strip, so `growIntoStrip`,
which stock only cut, freezes.

To try it, apply it to the pod after `npx expo prebuild`, rebuild and reinstall as in [Reproduce](#reproduce),
then put the pod back to stock:

```sh
patch -p1 -d "$PWD/ios/Pods/Adyen" -i "$PWD/patches/Adyen@5.25.1.patch"
# rebuild and reinstall
patch -R -p1 -d "$PWD/ios/Pods/Adyen" -i "$PWD/patches/Adyen@5.25.1.patch"
```

Use absolute paths, because `patch -d` changes directory first. The pod's files are read-only, which `patch` copes
with. Each part can be applied on its own the same way.

In an app, a fresh `pod install` (on CI, for example) brings back the original files. So the patch has to be
applied after every install, for example from a `post_install` hook in the Podfile.

## Also noticed

- **The keyboard opens on its own.** Adyen's form takes the cursor as soon as it appears
  (`assignInitialFirstResponder` in `FormViewController.viewDidAppear`). On a device, the keyboard opens when an
  inline card view appears, even below the fold, and the page scrolls to the focused field. With the patch, in
  `belowFold`, the card moved from y 1000 to y 816 by itself.

## Not tested

- A physical device.
- Other iPhones, landscape, or a custom `AdyenAppearance`.
- Full-screen uses of `FormViewController` (Drop-in and the other components) with the patch. They rely on
  `contentInsetAdjustmentBehavior = .always` to keep the content clear of the safe area, which this repro doesn't
  exercise.

## Evidence

[`evidence/`](evidence) has one folder per build and simulator: `stock-ios26.0`, `stock-ios26.3`,
`patched-ios26.0`, `patched-ios26.3`, and `partA-ios26.0` and `partB-ios26.0` for each part of the fix alone. For
each scenario, `capture.sh` saves:

| File | What |
|---|---|
| `<scenario>.png` | A screenshot |
| `<scenario>-cpu.txt` | Five `ps -o %cpu=` readings of the app's process, a second apart |
| `<scenario>-sample-excerpt.txt` | From a 2 s `sample` of the process: the header, the main thread's call graph and the hottest frames |
| `<scenario>-views.txt` | The window's `recursiveDescription`, through lldb |
| `<scenario>-frames.txt` | The lines that matter from it: React Native's scroll view, the card view, Adyen's `UIScrollView`, `Adyen.FormView`, the Pay button row and the button |
| `<scenario>-adyen-view.txt` | The card view's frame in the window, and the `safeAreaInsets` of `FormViewController.view` |
| `build-md5.txt` | The md5 of the installed binary and JS bundle |

Also there: the 2-minute CPU readings, the one full `sample` kept, and the margins read while frozen, all in
`stock-ios26.0/bottomEdge-*`; the repeats, in `repeats-stock-*.txt`; and the crops shown above, in `readme/`.
Paths under the home folder are written as `/Users/USER`, the way `sample` writes them.

## Files

| Path | What |
|---|---|
| [`App.tsx`](App.tsx) | The app, with every scenario |
| [`capture.sh`](capture.sh) | Runs a scenario and saves the evidence |
| [`app.json`](app.json) | Expo config: the `@adyen/react-native` plugin, scheme `adyenrepro`, bundle id `com.example.adyencardviewrepro` |
| [`patches/`](patches) | The fix, and each of its parts on its own |
| [`evidence/`](evidence) | The results, by build and simulator |

`ios/` (made by `npx expo prebuild`) and `build/` are not in git.
