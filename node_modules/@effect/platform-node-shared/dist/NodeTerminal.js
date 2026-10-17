import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { badArgument } from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as RcRef from "effect/RcRef";
import * as Terminal from "effect/Terminal";
import * as readline from "node:readline";
/**
 * Creates a scoped process-backed `Terminal` using Node `readline`, enabling
 * TTY raw mode while in scope and using the supplied predicate to decide when
 * key input should end.
 *
 * @category constructors
 * @since 4.0.0
 */
export const make = /*#__PURE__*/Effect.fnUntraced(function* (shouldQuit = defaultShouldQuit) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  // Acquire readline interface with TTY setup/cleanup inside the scope
  const rlRef = yield* RcRef.make({
    acquire: Effect.acquireRelease(Effect.sync(() => {
      const rl = readline.createInterface({
        input: stdin,
        escapeCodeTimeout: 50
      });
      readline.emitKeypressEvents(stdin, rl);
      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      return rl;
    }), rl => Effect.sync(() => {
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      rl.close();
    }))
  });
  const columns = Effect.sync(() => stdout.columns ?? 0);
  const rows = Effect.sync(() => stdout.rows ?? 0);
  const readInput = Effect.gen(function* () {
    yield* RcRef.get(rlRef);
    const queue = yield* Queue.make();
    const handleKeypress = (s, k) => {
      const userInput = {
        input: Option.fromUndefinedOr(s),
        key: {
          name: k.name ?? "",
          ctrl: !!k.ctrl,
          meta: !!k.meta,
          shift: !!k.shift
        }
      };
      Queue.offerUnsafe(queue, userInput);
      if (shouldQuit(userInput)) {
        Queue.endUnsafe(queue);
      }
    };
    yield* Effect.addFinalizer(() => Effect.sync(() => stdin.off("keypress", handleKeypress)));
    stdin.on("keypress", handleKeypress);
    return queue;
  });
  const readLine = Effect.scoped(Effect.flatMap(RcRef.get(rlRef), readlineInterface => Effect.callback(resume => {
    const onLine = line => resume(Effect.succeed(line));
    readlineInterface.once("line", onLine);
    return Effect.sync(() => readlineInterface.off("line", onLine));
  })));
  const display = prompt => Effect.uninterruptible(Effect.callback(resume => {
    stdout.write(prompt, err => Predicate.isNullish(err) ? resume(Effect.void) : resume(Effect.fail(badArgument({
      module: "Terminal",
      method: "display",
      description: "Failed to write prompt to stdout",
      cause: err
    }))));
  }));
  return Terminal.make({
    columns,
    rows,
    readInput,
    readLine,
    display
  });
});
/**
 * Provides the default process-backed `Terminal` service, ending key input on
 * Ctrl+C or Ctrl+D.
 *
 * @category layers
 * @since 4.0.0
 */
export const layer = /*#__PURE__*/Layer.effect(Terminal.Terminal, /*#__PURE__*/make(defaultShouldQuit));
function defaultShouldQuit(input) {
  return input.key.ctrl && (input.key.name === "c" || input.key.name === "d");
}
//# sourceMappingURL=NodeTerminal.js.map