import { Item, ItemRequestError, ItemSummary, ItemUnavailableError } from "@p4code/contracts/items";
import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import * as ItemService from "../ItemService.ts";
import * as McpInvocationContext from "../../../../apps/server/src/mcp/McpInvocationContext.ts";
import * as ThreadManagement from "../../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagement.ThreadManagementService,
  ItemService.ItemService,
];

const ItemToolFailure = Schema.Union([
  OrchestratorMcpFailure,
  ItemRequestError,
  ItemUnavailableError,
]);

const CreateItemTool = Tool.make("p4code_item_create", {
  description: "Add a GitHub issue to this project's Items and capture its current snapshot.",
  parameters: Schema.Struct({
    url: Schema.String.annotate({
      description: "GitHub issue URL, such as https://github.com/owner/repo/issues/123.",
    }),
  }),
  success: Item,
  failure: ItemToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Create Item from GitHub issue")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ListItemsTool = Tool.make("p4code_item_list", {
  description: "List the GitHub issue Items saved for this project's workspace.",
  success: Schema.Array(ItemSummary),
  failure: ItemToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "List Items")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ReadItemTool = Tool.make("p4code_item_read", {
  description:
    "Read one Item's saved GitHub issue snapshot, refresh status, comments, and linked Threads.",
  parameters: Schema.Struct({ itemId: Schema.String }),
  success: Item,
  failure: ItemToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Read Item")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const LinkItemThreadTool = Tool.make("p4code_item_link_thread", {
  description: "Link an existing Thread from this project to an Item.",
  parameters: Schema.Struct({ itemId: Schema.String, threadId: Schema.String }),
  success: Schema.Struct({ threadId: ThreadId }),
  failure: ItemToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Link Thread to Item")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ItemsToolkit = Toolkit.make(
  CreateItemTool,
  ListItemsTool,
  ReadItemTool,
  LinkItemThreadTool,
);
