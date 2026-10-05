import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ItemsView } from "@p4code/web/ItemsView";
import {
  createItemDetailAtom,
  createItemLinkThreadAtom,
  createItemRefreshAtom,
  createItemThreadAtom,
  createItemUnlinkThreadAtom,
  createItemsAtoms,
  type ItemSummary,
} from "@p4code/web/items";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";

const items = createItemsAtoms(connectionAtomRuntime);
const itemDetail = createItemDetailAtom(connectionAtomRuntime);
const itemRefresh = createItemRefreshAtom(connectionAtomRuntime);
const itemThread = createItemThreadAtom(connectionAtomRuntime);
const itemLinkThread = createItemLinkThreadAtom(connectionAtomRuntime);
const itemUnlinkThread = createItemUnlinkThreadAtom(connectionAtomRuntime);
export const Route = createFileRoute("/items/$environmentId/$projectId")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ItemsPage,
});
function ItemsPage() {
  const { environmentId, projectId } = Route.useParams();
  const run = useAtomCommand(items, { reportFailure: false });
  const runDetail = useAtomCommand(itemDetail, { reportFailure: false });
  const runRefresh = useAtomCommand(itemRefresh, { reportFailure: false });
  const runStartThread = useAtomCommand(itemThread, { reportFailure: false });
  const runLinkThread = useAtomCommand(itemLinkThread, { reportFailure: false });
  const runUnlinkThread = useAtomCommand(itemUnlinkThread, { reportFailure: false });
  const navigate = useNavigate();
  const list = useCallback(async () => {
    const result = await run({
      environmentId: EnvironmentId.make(environmentId),
      input: { projectId: ProjectId.make(projectId) },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  }, [run, environmentId, projectId]);
  const create = useCallback(
    async (url: string) => {
      const result = await run({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), url },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    [run, environmentId, projectId],
  );
  const get = useCallback(
    async (item: ItemSummary) => {
      const result = await runDetail({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), itemId: item.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [runDetail, environmentId, projectId],
  );
  const refresh = useCallback(
    async (item: ItemSummary) => {
      const result = await runRefresh({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), itemId: item.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [runRefresh, environmentId, projectId],
  );
  const startThread = useCallback(
    async (item: ItemSummary) => {
      const result = await runStartThread({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), itemId: item.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [runStartThread, environmentId, projectId],
  );
  const openThread = useCallback(
    (threadId: string) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    },
    [navigate, environmentId],
  );
  const linkThread = useCallback(
    async (item: ItemSummary, threadId: string) => {
      const result = await runLinkThread({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), itemId: item.id, threadId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    [runLinkThread, environmentId, projectId],
  );
  const unlinkThread = useCallback(
    async (item: ItemSummary, threadId: string) => {
      const result = await runUnlinkThread({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), itemId: item.id, threadId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    [runUnlinkThread, environmentId, projectId],
  );
  return (
    <ItemsView
      key={`${environmentId}:${projectId}`}
      list={list}
      create={create}
      get={get}
      refresh={refresh}
      startThread={startThread}
      linkThread={linkThread}
      unlinkThread={unlinkThread}
      openThread={openThread}
    />
  );
}
