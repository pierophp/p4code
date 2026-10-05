import { AuthOrchestrationReadScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { ItemsApi } from "@p4code/contracts/items";
import { requireEnvironmentScope } from "../../../apps/server/src/auth/http.ts";
import * as ItemService from "./ItemService.ts";

const handlers = HttpApiBuilder.group(
  ItemsApi,
  "items",
  Effect.fnUntraced(function* (handlers) {
    const items = yield* ItemService.ItemService;
    return handlers
      .handle(
        "list",
        Effect.fn(function* ({ params }) {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* items.list(params.projectId);
        }),
      )
      .handle(
        "get",
        Effect.fn(function* ({ params }) {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* items.get(params.projectId, params.itemId);
        }),
      )
      .handle(
        "refresh",
        Effect.fn(function* ({ params }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* items.refresh(params.projectId, params.itemId);
        }),
      )
      .handle(
        "startThread",
        Effect.fn(function* ({ params }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const threadId = yield* items.startThread(params.projectId, params.itemId);
          return { threadId };
        }),
      )
      .handle(
        "linkThread",
        Effect.fn(function* ({ params, payload }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          yield* items.linkThread(params.projectId, params.itemId, payload.threadId);
          return { threadId: payload.threadId };
        }),
      )
      .handle(
        "unlinkThread",
        Effect.fn(function* ({ params }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          yield* items.unlinkThread(params.projectId, params.itemId, params.threadId);
        }),
      )
      .handle(
        "create",
        Effect.fn(function* ({ params, payload }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* items.create(params.projectId, payload.url);
        }),
      );
  }),
);
export const routes = HttpApiBuilder.layer(ItemsApi).pipe(Layer.provide(handlers));
