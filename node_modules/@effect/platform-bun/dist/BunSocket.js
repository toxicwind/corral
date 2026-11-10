import { flow } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Socket from "effect/unstable/socket/Socket";
/**
 * @since 4.0.0
 */
export * from "@effect/platform-node-shared/NodeSocket";
/**
 * Provides a `Socket.WebSocketConstructor` backed by Bun's global
 * `WebSocket` implementation.
 *
 * @category layers
 * @since 4.0.0
 */
export const layerWebSocketConstructor = /*#__PURE__*/Layer.succeed(Socket.WebSocketConstructor)((url, protocols) => new globalThis.WebSocket(url, protocols));
/**
 * Creates a `Socket.Socket` layer for a WebSocket URL using Bun's global
 * `WebSocket` constructor, honoring protocol, open-timeout, and close-code
 * error options.
 *
 * @category layers
 * @since 4.0.0
 */
export const layerWebSocket = /*#__PURE__*/flow(Socket.makeWebSocket, /*#__PURE__*/Layer.effect(Socket.Socket), /*#__PURE__*/Layer.provide(layerWebSocketConstructor));
//# sourceMappingURL=BunSocket.js.map