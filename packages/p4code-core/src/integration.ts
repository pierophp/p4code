import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ItemUnavailableError } from "@p4code/contracts/items";
import * as ServerConfig from "../../../apps/server/src/config.ts";
import * as ProjectStore from "../../../apps/server/src/orchestration-v2/ProjectStore.ts";
import { environmentAuthenticatedAuthLayer } from "../../../apps/server/src/auth/http.ts";
import * as ItemService from "./ItemService.ts";
import * as GitHubIssue from "./GitHubIssue.ts";
import { routes } from "./http.ts";
export { acquire } from "./homeLock.ts";

const projects = Layer.effect(
  ItemService.Projects,
  Effect.gen(function* () {
    const store = yield* ProjectStore.ProjectStoreV2;
    return {
      exists: (id) =>
        store.get(id).pipe(
          Effect.map(Option.isSome),
          Effect.mapError(
            () => new ItemUnavailableError({ message: "Could not read the Project." }),
          ),
        ),
    } satisfies ItemService.Projects["Service"];
  }),
);
export const routesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return routes.pipe(
      Layer.provide(
        ItemService.layer(path.join(config.stateDir, "p4code.sqlite")).pipe(
          Layer.provide(GitHubIssue.layer),
          Layer.provide(projects),
        ),
      ),
      Layer.provide(environmentAuthenticatedAuthLayer),
    );
  }),
);
