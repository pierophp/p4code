import * as Effect from "effect/Effect";
import { ThreadId } from "@t3tools/contracts";
import { readCaller } from "../../../../apps/server/src/mcp/threadAccess.ts";
import * as ItemService from "../ItemService.ts";
import { ItemsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const items = yield* ItemService.ItemService;
  return ItemsToolkit.of({
    p4code_item_create: (input) =>
      Effect.gen(function* () {
        const { caller } = yield* readCaller();
        return yield* items.create(caller.projectId, input.url);
      }),
    p4code_item_list: () =>
      Effect.gen(function* () {
        const { caller } = yield* readCaller();
        return yield* items.list(caller.projectId);
      }),
    p4code_item_read: (input) =>
      Effect.gen(function* () {
        const { caller } = yield* readCaller();
        return yield* items.get(caller.projectId, input.itemId);
      }),
    p4code_item_link_thread: (input) =>
      Effect.gen(function* () {
        const { caller } = yield* readCaller();
        yield* items.linkThread(caller.projectId, input.itemId, input.threadId);
        return { threadId: ThreadId.make(input.threadId) };
      }),
  });
});

export const ItemsToolkitHandlersLive = ItemsToolkit.toLayer(make);
