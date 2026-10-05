import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/unstable/ai";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ThreadLaunchService from "../../../../apps/server/src/orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";
import * as ProjectStore from "../../../../apps/server/src/orchestration-v2/ProjectStore.ts";
import * as ServerConfig from "../../../../apps/server/src/config.ts";
import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import { ItemsToolkitRegistrationLive } from "./registration.ts";

const TestLayer = ItemsToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      ServerConfig.layerTest(process.cwd(), { prefix: "p4code-items-mcp-registration-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
      NodeServices.layer,
      ServerSettings.layerTest({}),
      Layer.mock(ProjectStore.ProjectStoreV2)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
    ),
  ),
);

it.live("lists the p4code Item tools in the MCP server", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const names = server.tools.map(({ tool }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "p4code_item_create",
        "p4code_item_list",
        "p4code_item_read",
        "p4code_item_link_thread",
      ]),
    );
  }).pipe(Effect.provide(TestLayer)),
);
