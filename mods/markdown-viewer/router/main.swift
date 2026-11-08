// Markdown Router: macOS's default app for .md files, so a cmd-click on a path in a Herdr terminal
// opens it in the viewer. Background-only (never takes focus), it hands each file to ../open.sh with
// the app that was in front: Herdr's viewer when Herdr was in front, your usual app otherwise.
//   "Markdown Router" --make-default   make it the default, remembering your usual app
//   "Markdown Router" --restore        give Markdown back to your usual app
import Cocoa
import UniformTypeIdentifiers

let home = NSString(string: "~/.config/herdr-app").expandingTildeInPath
let script = home + "/mods/markdown-viewer/open.sh"
let fallbackFile = home + "/data/markdown-viewer/fallback"
let markdown = UTType("net.daringfireball.markdown")!

func savedFallback() -> String? {
  let id = (try? String(contentsOfFile: fallbackFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
  return id?.isEmpty == false ? id : nil
}

func saveFallback(_ id: String) {
  try? FileManager.default.createDirectory(atPath: (fallbackFile as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
  try? id.write(toFile: fallbackFile, atomically: true, encoding: .utf8)
}

final class Router: NSObject, NSApplicationDelegate {
  var handled = false

  func application(_ app: NSApplication, open urls: [URL]) {
    handled = true
    let front = NSWorkspace.shared.frontmostApplication
    let who = front?.bundleURL?.path ?? front?.localizedName ?? ""
    for url in urls {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: "/bin/sh")
      p.arguments = [script, url.path, who]
      try? p.run()
      p.waitUntilExit()
    }
    NSApp.terminate(nil)
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    let args = CommandLine.arguments
    if args.contains("--make-default") {
      // Remember the app it takes over from, unless that's already this router.
      if let current = NSWorkspace.shared.urlForApplication(toOpen: markdown),
         let id = Bundle(url: current)?.bundleIdentifier, id != Bundle.main.bundleIdentifier {
        saveFallback(id)
      } else if savedFallback() == nil {
        saveFallback("com.apple.TextEdit")
      }
      setDefault(Bundle.main.bundleURL)
      return
    }
    if args.contains("--restore") {
      guard let target = NSWorkspace.shared.urlForApplication(withBundleIdentifier: savedFallback() ?? "com.apple.TextEdit") else {
        print("app not found"); exit(1)
      }
      setDefault(target)
      return
    }
    // Launched without files (a double-click on the app): nothing to do.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if !self.handled { NSApp.terminate(nil) } }
  }

  func setDefault(_ target: URL) {
    NSWorkspace.shared.setDefaultApplication(at: target, toOpen: markdown) { error in
      print(error.map { "failed: \($0)" } ?? "default for Markdown: \(target.path)")
      exit(error == nil ? 0 : 1)
    }
  }
}

let app = NSApplication.shared
let router = Router()
app.delegate = router
app.setActivationPolicy(.prohibited)
app.run()
