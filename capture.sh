#!/bin/sh
# Usage: UDID=<simulator udid> ./capture.sh <label> <scenario> [seconds to wait, default 6]
#
# Cold-launches the installed app on the simulator with `-scenario <scenario>`, waits, then saves
# into evidence/<label>/: a screenshot, five CPU readings a second apart, a 2 s sample of the process,
# the window's view hierarchy (lldb) with the interesting frame lines pulled out, and the md5 of the
# installed binary and JS bundle (the binary tells the stock and patched builds apart).
# Leaves the app running unless it is frozen, which it kills (simctl terminate hangs on a frozen app).
set -u
UDID=${UDID:?set UDID to the simulator id, from xcrun simctl list devices}
APP=AdyenRepro
label=$1 scenario=$2 wait=${3:-6}
cd "$(dirname "$0")" && mkdir -p "evidence/$label" && p=evidence/$label/$scenario

pid() { pgrep -f "$UDID/data/Containers/Bundle/Application/[^/]*/$APP\.app/$APP( |\$)"; }

old=$(pid) && kill -9 $old
app=$(xcrun simctl get_app_container "$UDID" com.example.adyencardviewrepro)
md5 "$app/$APP" "$app/main.jsbundle" | sed "s|$app/||" > "evidence/$label/build-md5.txt"
xcrun simctl launch "$UDID" com.example.adyencardviewrepro -scenario "$scenario" > /dev/null
sleep "$wait"
pid=$(pid) || { echo "$APP is not running"; exit 1; }

for i in 1 2 3 4 5; do ps -o %cpu= -p "$pid" | tr -d ' '; sleep 1; done > "$p-cpu.txt"
xcrun simctl io "$UDID" screenshot "$p.png" > /dev/null 2>&1
sample "$pid" 2 -file "$p-sample.txt" > /dev/null 2>&1
# The excerpt kept in git: the header, the start of the call graph (the main thread comes first), the hottest
# frames, and how many lines of the whole sample name each frame of the reported hang.
{ sed -n '1,16p' "$p-sample.txt"; awk '/^Call graph:/ { f = 1 } f' "$p-sample.txt" | head -60 | cut -c1-250
  echo '[...]'; awk '/^Sort by top of stack/ { f = 1 } f' "$p-sample.txt" | head -14
  echo '[...] Lines of the full sample that name:'
  for s in attachChildViewControllerIfNeeded _updateInferredLayoutMarginsFromSuperview \
    _UIViewAdjustedLayoutMarginsForLayoutMargins '_safeAreaInsetsForFrame:inSuperview:'; do
    echo "  $s: $(grep -c -- "$s" "$p-sample.txt")"
  done; } > "$p-sample-excerpt.txt"
xcrun lldb --batch -p "$pid" \
  -o 'expr -l objc -O -- (id)[[[[UIApplication sharedApplication] windows] firstObject] recursiveDescription]' \
  > "$p-views.txt" 2>&1
grep -E '<(RCTEnhancedScrollView|ADYCardView|CardComponentViewProxy|UIScrollView|Adyen\.FormView|Adyen\.FormButtonItemView|Adyen\.SubmitButton):' \
  "$p-views.txt" > "$p-frames.txt"
# The card view's frame in the window, and the safe-area insets of FormViewController.view, the superview of
# Adyen's scroll view (the proxy holds SecuredViewController.view, which holds it). Plain structs through
# objc_msgSend, because lldb's UIKit import chokes on CGRect here.
proxy=$(sed -n 's/.*<CardComponentViewProxy: \(0x[0-9a-f]*\);.*/\1/p' "$p-views.txt" | head -1)
scroll=$(awk '/<CardComponentViewProxy/ { f = 1 } f && /<UIScrollView: / { print; exit }' "$p-views.txt" |
  sed 's/.*<UIScrollView: \(0x[0-9a-f]*\);.*/\1/')
R='typedef struct { double x, y, width, height; } R'
I='typedef struct { double top, left, bottom, right; } I'
[ -n "$proxy" ] && [ -n "$scroll" ] && xcrun lldb --batch -p "$pid" \
  -o "expr -l objc -- $R; R b = ((R (*)(id, SEL))objc_msgSend)((id)$proxy, @selector(bounds)); ((R (*)(id, SEL, R, id))objc_msgSend)((id)$proxy, @selector(convertRect:toView:), b, (id)0)" \
  -o "expr -l objc -- $I; ((I (*)(id, SEL))objc_msgSend)((id)[(id)$scroll superview], @selector(safeAreaInsets))" \
  2>&1 | sed -n 's/^(R) \$[0-9]* = /card view frame in window: /p; s/^(I) \$[0-9]* = /FormViewController.view safeAreaInsets: /p' > "$p-adyen-view.txt"

cpu=$(tr '\n' ' ' < "$p-cpu.txt")
echo "$label/$scenario cpu%: $cpu"
case $(tail -1 "$p-cpu.txt") in [5-9]?.*|[1-9]??.*) kill -9 "$pid" && echo "frozen: killed $pid" ;; esac
