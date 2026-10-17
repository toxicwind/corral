import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { pipe } from "effect/Function";
import * as Function from "effect/Function";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import * as Scope from "effect/Scope";
import * as Socket from "effect/unstable/socket/Socket";
import * as SocketServer from "effect/unstable/socket/SocketServer";
import * as Net from "node:net";
import * as NodeSocket from "./NodeSocket.js";
import { NodeWS } from "./NodeSocket.js";
/**
 * Service tag for the Node `IncomingMessage` associated with the current
 * WebSocket server connection.
 *
 * @category services
 * @since 4.0.0
 */
export class IncomingMessage extends /*#__PURE__*/Context.Service()("@effect/platform-node-shared/NodeSocketServer/IncomingMessage") {}
/**
 * Creates a scoped TCP `SocketServer` from a Node `net.Server`, starts
 * listening with the supplied options, queues pending connections until `run`
 * is called, and closes the server when the scope ends.
 *
 * @category constructors
 * @since 4.0.0
 */
export const make = /*#__PURE__*/Effect.fnUntraced(function* (options) {
  const errorDeferred = Deferred.makeUnsafe();
  const pending = new Set();
  function defaultOnConnection(conn) {
    pending.add(conn);
    const remove = () => {
      pending.delete(conn);
    };
    conn.on("close", remove);
    conn.on("error", remove);
  }
  let onConnection = defaultOnConnection;
  // oxlint-disable-next-line prefer-const
  let server;
  yield* Effect.addFinalizer(() => Effect.callback(resume => {
    server?.close(() => resume(Effect.void));
  }));
  server = Net.createServer(options, conn => onConnection(conn));
  server.on("error", err => Deferred.doneUnsafe(errorDeferred, Exit.fail(err)));
  yield* Effect.callback(resume => {
    server.listen(options, () => resume(Effect.void));
  }).pipe(Effect.raceFirst(Effect.mapError(Deferred.await(errorDeferred), err => new SocketServer.SocketServerError({
    reason: new SocketServer.SocketServerOpenError({
      cause: err
    })
  }))));
  const run = Effect.fnUntraced(function* (handler) {
    const scope = yield* Scope.make();
    const services = Context.omit(Scope.Scope)(yield* Effect.context());
    const trackFiber = Fiber.runIn(scope);
    const prevOnConnection = onConnection;
    onConnection = function (conn) {
      let error;
      conn.on("error", err => {
        error = err;
      });
      pipe(NodeSocket.fromDuplex(Effect.acquireRelease(Effect.suspend(() => {
        if (error) {
          return Effect.fail(new Socket.SocketError({
            reason: new Socket.SocketOpenError({
              kind: "Unknown",
              cause: error
            })
          }));
        } else if (conn.closed) {
          return Effect.fail(new Socket.SocketError({
            reason: new Socket.SocketCloseError({
              code: 1000
            })
          }));
        }
        return Effect.succeed(conn);
      }), conn => Effect.sync(() => {
        if (conn.closed === false) {
          conn.destroySoon();
        }
      }))), Effect.flatMap(handler), Effect.catchCause(reportUnhandledError), Effect.runForkWith(Context.add(services, NodeSocket.NetSocket, conn)), trackFiber);
    };
    pending.forEach(conn => {
      conn.removeAllListeners("error");
      conn.removeAllListeners("close");
      onConnection(conn);
    });
    pending.clear();
    return yield* Effect.callback(_resume => {
      return Effect.suspend(() => {
        onConnection = prevOnConnection;
        return Scope.close(scope, Exit.void);
      });
    });
  });
  const address = server.address();
  return SocketServer.SocketServer.of({
    address: typeof address === "string" ? {
      _tag: "UnixAddress",
      path: address
    } : {
      _tag: "TcpAddress",
      hostname: address.address,
      port: address.port
    },
    run
  });
});
/**
 * Provides a TCP `SocketServer` by creating and managing a scoped Node
 * `net.Server` with the supplied server and listen options.
 *
 * @category layers
 * @since 4.0.0
 */
export const layer = /*#__PURE__*/Function.flow(make, /*#__PURE__*/Layer.effect(SocketServer.SocketServer));
/**
 * Creates a scoped WebSocket `SocketServer` backed by the `ws` package,
 * providing the WebSocket and its Node `IncomingMessage` to connection
 * handlers and closing the server when the scope ends.
 *
 * @category constructors
 * @since 4.0.0
 */
export const makeWebSocket = /*#__PURE__*/Effect.fnUntraced(function* (options) {
  const server = yield* Effect.acquireRelease(Effect.sync(() => new NodeWS.WebSocketServer(options)), server => Effect.callback(resume => {
    server.close(() => resume(Effect.void));
  }));
  const pendingConnections = new Set();
  function defaultHandler(conn, req) {
    const entry = [conn, req];
    pendingConnections.add(entry);
    conn.addEventListener("close", () => {
      pendingConnections.delete(entry);
    });
  }
  let onConnection = defaultHandler;
  server.on("connection", (conn, req) => onConnection(conn, req));
  yield* Effect.callback(resume => {
    server.once("error", error => {
      resume(Effect.fail(new SocketServer.SocketServerError({
        reason: new SocketServer.SocketServerOpenError({
          cause: error
        })
      })));
    });
    server.once("listening", () => {
      resume(Effect.void);
    });
  });
  const run = Effect.fnUntraced(function* (handler) {
    const scope = yield* Scope.make();
    const services = Context.omit(Scope.Scope)(yield* Effect.context());
    const trackFiber = Fiber.runIn(scope);
    const prevOnConnection = onConnection;
    onConnection = function (conn, req) {
      const map = new Map(services.mapUnsafe);
      map.set(IncomingMessage.key, req);
      map.set(Socket.WebSocket.key, conn);
      pipe(Socket.fromWebSocket(Effect.acquireRelease(Effect.succeed(conn), conn => Effect.sync(() => {
        conn.close();
      }))), Effect.flatMap(handler), Effect.catchCause(reportUnhandledError), Effect.runForkWith(Context.makeUnsafe(map)), trackFiber);
    };
    for (const [conn, req] of pendingConnections) {
      onConnection(conn, req);
    }
    pendingConnections.clear();
    return yield* Effect.callback(_resume => {
      return Effect.sync(() => {
        onConnection = prevOnConnection;
      });
    }).pipe(Effect.ensuring(Scope.close(scope, Exit.void)));
  });
  const address = server.address();
  return SocketServer.SocketServer.of({
    address: typeof address === "string" ? {
      _tag: "UnixAddress",
      path: address
    } : {
      _tag: "TcpAddress",
      hostname: address.address,
      port: address.port
    },
    run
  });
});
/**
 * Provides a WebSocket `SocketServer` backed by the `ws` package and managed
 * with the supplied server options.
 *
 * @category layers
 * @since 4.0.0
 */
export const layerWebSocket = /*#__PURE__*/Function.flow(makeWebSocket, /*#__PURE__*/Layer.effect(SocketServer.SocketServer));
const reportUnhandledError = cause => Effect.withFiber(fiber => {
  const unhandledLogLevel = fiber.getRef(References.UnhandledLogLevel);
  if (unhandledLogLevel) {
    return Effect.logWithLevel(unhandledLogLevel)(cause, "Unhandled error in SocketServer");
  }
  return Effect.void;
});
//# sourceMappingURL=NodeSocketServer.js.map