import * as Layer from "effect/Layer";
import { McpServer } from "effect/unstable/ai";
import * as P4code from "../integration.ts";
import { ItemsToolkitHandlersLive } from "./handlers.ts";
import { ItemsToolkit } from "./tools.ts";

export const ItemsToolkitRegistrationLive = McpServer.toolkit(ItemsToolkit).pipe(
  Layer.provide(ItemsToolkitHandlersLive),
  Layer.provide(P4code.itemServiceLayer),
);
