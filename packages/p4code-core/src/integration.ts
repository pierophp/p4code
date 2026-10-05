import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { ItemUnavailableError } from "@p4code/contracts/items";
import * as ServerConfig from "../../../apps/server/src/config.ts";
import * as ServerSettings from "../../../apps/server/src/serverSettings.ts";
import * as ThreadLaunch from "../../../apps/server/src/orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";
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
const itemThreadLauncher = Layer.effect(
  ItemService.ItemThreadLauncher,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const settingsService = yield* ServerSettings.ServerSettingsService;
    const threadLaunch = yield* ThreadLaunch.ThreadLaunchService;
    return {
      launch: (input) =>
        Effect.gen(function* () {
          const settings = resolveProjectSettings(
            yield* settingsService.getSettings,
            input.projectId,
          ).settings;
          const result = yield* threadLaunch.launch({
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
            projectId: input.projectId,
            title: input.title,
            modelSelection: settings.defaultModelSelection ?? {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
            runtimeMode: settings.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy: { type: "root" },
            createdBy: "user",
            creationSource: "web",
          });
          return result.threadId;
        }).pipe(
          Effect.mapError(() => new ItemUnavailableError({ message: "Could not start a Thread." })),
        ),
    } satisfies ItemService.ItemThreadLauncher["Service"];
  }),
);
const itemThreadReader = Layer.effect(
  ItemService.ItemThreadReader,
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    return {
      isAvailable: ({ projectId, threadId }) =>
        threads.getProjectThread({ projectId, threadId }).pipe(
          Effect.as(true),
          Effect.catchTag("ThreadManagementThreadNotFoundError", () => Effect.succeed(false)),
          Effect.mapError(() => new ItemUnavailableError({ message: "Could not read a Thread." })),
        ),
    } satisfies ItemService.ItemThreadReader["Service"];
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
          Layer.provide(itemThreadLauncher),
          Layer.provide(itemThreadReader),
          Layer.provide(projects),
        ),
      ),
      Layer.provide(environmentAuthenticatedAuthLayer),
    );
  }),
);
