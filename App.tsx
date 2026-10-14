import { AdyenCheckout, CardView, type Configuration } from '@adyen/react-native'
import { useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  Pressable,
  ScrollView,
  Settings,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'

// Picked with a launch argument, which iOS puts in NSUserDefaults, where Settings reads it:
// `xcrun simctl launch <udid> com.example.adyencardviewrepro -scenario strip` (see README.md).
// Without one, the app lists the scenarios to tap.
const SCENARIOS = [
  'middle',
  'strip',
  'belowFold',
  'bottomEdge',
  'scrollIntoStrip',
  'scrollIntoStripNow',
  'growIntoStrip',
  'growIntoStripThenMiddle',
] as const
type Scenario = (typeof SCENARIOS)[number]

// The long-page scenarios: the spacer above the card, where the page starts scrolled to (the card then mounts
// once the page is there), whether a spacer follows the card, and how long after the card reports its height
// the page scrolls so the card's bottom edge sits at the bottom of the screen, in the home-indicator strip
// (null: no scroll).
// - belowFold: the card mounts below the fold (y=1000) and stays there.
// - strip: the same mount, then the scroll right away. Nothing follows the card, so the scroll is scrollToEnd.
// - scrollIntoStrip: the card mounts at y=200, inside the safe area, and the scroll waits until its new frame
//   is surely on screen there.
// - scrollIntoStripNow: the same with the scroll right away, which races the card's new frame: Fabric reports
//   the height (onLayout) before the UI thread applies the frame, so the frame can land after the scroll.
// - growIntoStrip: the card mounts at y=600, inside the safe area, and its new frame there takes its bottom past
//   the bottom of the screen; then the same scroll as scrollIntoStrip.
// - growIntoStripThenMiddle: growIntoStrip, then 1.5 s later the page scrolls `further` pt on, which moves the
//   card up to the middle of the screen (y=202), wholly inside the safe area.
type Page = { above: number; start: number; below: boolean; scrollAfterMs: number | null; further?: number }
const PAGES: Partial<Record<Scenario, Page>> = {
  belowFold: { above: 1000, start: 0, below: false, scrollAfterMs: null },
  strip: { above: 1000, start: 0, below: false, scrollAfterMs: 0 },
  scrollIntoStrip: { above: 1000, start: 800, below: true, scrollAfterMs: 500 },
  scrollIntoStripNow: { above: 1000, start: 800, below: true, scrollAfterMs: 0 },
  growIntoStrip: { above: 600, start: 0, below: true, scrollAfterMs: 500 },
  growIntoStripThenMiddle: { above: 600, start: 0, below: true, scrollAfterMs: 500, further: 300 },
}

// A made-up key in the right format, never a real one: the form renders, only its network calls fail.
const config: Configuration = {
  environment: 'test',
  clientKey: 'test_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE',
  locale: 'en-US',
  returnUrl: 'adyenrepro://',
  analytics: { enabled: false },
  card: { holderNameRequired: true, showStorePaymentField: true },
}

// Mounted as on the production payment page, with Adyen's default styling, in a white container with no padding.
function Card({ onHeight }: { onHeight: (height: number) => void }) {
  return (
    <View style={styles.card} onLayout={(e) => onHeight(e.nativeEvent.layout.height)}>
      <AdyenCheckout
        config={config}
        onSubmit={(_, component) => component.hide(false)}
        onAdditionalDetails={(_, component) => component.hide(false)}
        onError={(error, component) => {
          console.log('Adyen onError', error.errorCode, error.message)
          component.hide(false)
        }}
      >
        <CardView paymentMethod={{ type: 'scheme', name: 'Cards', brands: ['mc', 'visa'] }} />
      </AdyenCheckout>
    </View>
  )
}

// Adyen's first field taking the cursor can scroll the page (UIKit keeps a focused field in view), so the
// scroll is done again once the keyboard has closed.
function LongPage({ scenario, onHeight, log }: { scenario: Scenario; onHeight: (height: number) => void; log: Log }) {
  const page = PAGES[scenario]!
  const ref = useRef<ScrollView>(null)
  const screen = useWindowDimensions().height
  const cardHeight = useRef(0)
  const scrolledFurther = useRef(false)
  const [showCard, setShowCard] = useState(page.start === 0)

  const bottomY = () => page.above + cardHeight.current - screen
  const scrollCardToBottom = () => {
    if (page.scrollAfterMs === null || cardHeight.current === 0 || scrolledFurther.current) return
    ref.current?.scrollTo({ y: bottomY(), animated: false })
    log('scrolled')
  }
  const scrollFurther = () => {
    scrolledFurther.current = true
    ref.current?.scrollTo({ y: bottomY() + page.further!, animated: false })
    log(`scrolled ${page.further} further`)
  }
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', scrollCardToBottom)
    return () => sub.remove()
  }, [])

  const onCardHeight = (height: number) => {
    onHeight(height)
    cardHeight.current = height
    if (height === 0) return
    // ponytail: a fixed 500 ms is plenty for the frame to land on this machine; raise it if a slower one still
    // shows scrollIntoStrip cut.
    if (page.scrollAfterMs) setTimeout(scrollCardToBottom, page.scrollAfterMs)
    else scrollCardToBottom()
    if (page.further) setTimeout(scrollFurther, (page.scrollAfterMs ?? 0) + 1500)
  }

  return (
    <ScrollView ref={ref} contentOffset={{ x: 0, y: page.start }} onLayout={() => setShowCard(true)}>
      <View style={{ height: page.above }} />
      {showCard && <Card onHeight={onCardHeight} />}
      {page.below && <View style={{ height: 1000 }} />}
    </ScrollView>
  )
}

type Log = (event: string) => void

function Run({ scenario }: { scenario: Scenario }) {
  const [height, setHeight] = useState(0)
  // What happened when, in ms from mount, shown under the scenario name for the screenshots.
  const [events, setEvents] = useState<string[]>([])
  const t0 = useRef(Date.now())
  const log: Log = (event) => setEvents((e) => [...e, `${event} ${Date.now() - t0.current}`])
  const onHeight = (h: number) => {
    setHeight(h)
    if (h > 0) log(`height ${h}`)
  }

  // Adyen's form puts the cursor in its first field when it appears (FormViewController.viewDidAppear), and the
  // keyboard then covers the bottom of the screen. Like a shopper tapping away, focusing and blurring a hidden
  // input once takes the cursor back and closes it.
  const hiddenInput = useRef<TextInput>(null)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      shown.remove()
      log('keyboard shown')
      hiddenInput.current?.focus()
      hiddenInput.current?.blur()
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => log('keyboard closed'))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  return (
    <View style={[styles.root, scenario === 'middle' && styles.middle, scenario === 'bottomEdge' && styles.bottomEdge]}>
      <TextInput ref={hiddenInput} style={styles.hiddenInput} />
      <Text style={styles.label}>{`${scenario} · card view height ${height}\n${events.join(' → ')}`}</Text>
      {PAGES[scenario] ? <LongPage scenario={scenario} onHeight={onHeight} log={log} /> : <Card onHeight={onHeight} />}
    </View>
  )
}

export default function App() {
  const [scenario, setScenario] = useState(() => SCENARIOS.find((s) => s === Settings.get('scenario')))
  if (scenario) return <Run scenario={scenario} />

  return (
    <View style={[styles.root, styles.middle]}>
      {SCENARIOS.map((s) => (
        <Pressable key={s} style={styles.button} onPress={() => setScenario(s)}>
          <Text style={styles.buttonText}>{s}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#d9d9d9' },
  middle: { justifyContent: 'center' },
  bottomEdge: { justifyContent: 'flex-end' },
  card: { backgroundColor: 'white' },
  label: { position: 'absolute', zIndex: 1, top: 64, left: 16, right: 16, fontSize: 13, color: '#333' },
  hiddenInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  button: { margin: 8, padding: 16, backgroundColor: 'white', alignItems: 'center' },
  buttonText: { fontSize: 17 },
})
