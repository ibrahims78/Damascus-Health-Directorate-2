---
name: SheetJS Node adapter
description: Node-specific setup required by the ESM SheetJS package when tests write real XLSX files.
---

The ESM build of SheetJS does not reliably auto-detect Node's filesystem implementation. Register the Node `fs` module with SheetJS before using `writeFile` or `readFile` in Node scripts.

**Why:** Without the adapter, an otherwise valid workbook fails with `cannot save file` in the Replit Node runtime, even when the destination directory is writable.

**How to apply:** Keep browser bundles on the browser APIs, but Node acceptance scripts that create or read XLSX files must call the package's filesystem adapter during startup.