import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";

const PYODIDE_BASE = new URL("vendor/pyodide/", self.location.href).href;
let pyodidePromise;

function getPyodide() {
  if (!pyodidePromise) pyodidePromise = loadPyodide({ indexURL: PYODIDE_BASE });
  return pyodidePromise;
}

self.onmessage = async ({ data }) => {
  if (!data || data.type !== "run") return;

  const { id, code, input = "" } = data;

  try {
    self.postMessage({ type: "status", id, status: "loading" });
    const pyodide = await getPyodide();
    self.postMessage({ type: "status", id, status: "running" });

    pyodide.globals.set("__room310_code", code);
    pyodide.globals.set("__room310_input", input);

    const output = await pyodide.runPythonAsync(`
import ast
import builtins
import contextlib
import io
import traceback

__room310_buffer = io.StringIO()
__room310_values = iter(__room310_input.splitlines())
__room310_original_input = builtins.input

def __room310_read(prompt=""):
    print(prompt, end="")
    try:
        value = next(__room310_values)
    except StopIteration:
        raise EOFError("This program needs another input line. Add it under Input and run again.")
    print(value)
    return value

try:
    builtins.input = __room310_read
    with contextlib.redirect_stdout(__room310_buffer), contextlib.redirect_stderr(__room310_buffer):
        try:
            __room310_tree = ast.parse(__room310_code, filename="Room310 cell", mode="exec")
            if __room310_tree.body and isinstance(__room310_tree.body[-1], ast.Expr):
                __room310_last = __room310_tree.body.pop()
                exec(compile(__room310_tree, "Room310 cell", "exec"), globals())
                __room310_result = eval(compile(ast.Expression(__room310_last.value), "Room310 cell", "eval"), globals())
                if __room310_result is not None:
                    print(repr(__room310_result))
            else:
                exec(compile(__room310_tree, "Room310 cell", "exec"), globals())
        except SyntaxError as error:
            print(f"SyntaxError on line {error.lineno}: {error.msg}")
            if error.text:
                print(error.text.rstrip())
                if error.offset:
                    print(" " * (error.offset - 1) + "^")
        except BaseException as error:
            room310_frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename == "Room310 cell"]
            if room310_frames:
                print(f"Error on line {room310_frames[-1].lineno}:")
            print(f"{type(error).__name__}: {error}")
finally:
    builtins.input = __room310_original_input

__room310_buffer.getvalue()
    `);

    self.postMessage({ type: "result", id, output: String(output || "") });
  } catch (error) {
    self.postMessage({
      type: "failure",
      id,
      message: error && error.message ? error.message : String(error),
    });
  }
};
