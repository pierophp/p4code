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
        "create",
        Effect.fn(function* ({ params, payload }) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* items.create(params.projectId, payload.url);
        }),
      );
  }),
);
export const routes = HttpApiBuilder.layer(ItemsApi).pipe(Layer.provide(handlers));
